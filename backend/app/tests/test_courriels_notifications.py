"""E-mails de notification (sprint 13, lot C) : deux types seulement, selon
les préférences, après un délai de grâce, sans rafale, sans donnée de santé."""
from datetime import datetime, timedelta

from sqlalchemy import select

from app.auth_models import Journal, Utilisateur
from app.models import Analysis, Notification
from app.services import courriel, courriels_notifications as envoi, notifications

T0 = datetime(2026, 11, 26, 10, 0, 0)
EMAIL = "dr.courriel@cabinet.example.org"


def _praticien(compte_mdp, db, **preferences):
    u = compte_mdp(EMAIL)
    u.prenom = "Hery"
    u.preferences = preferences
    db.commit()
    return u


def _notif(db, u, type_, reference, minutes=0, motif=None):
    a = Analysis(reference=reference, image_key="k", width=1, height=1, note="RAKOTO Jean, douleur 36")
    db.add(a)
    db.flush()
    n = notifications.notifier(db, u.id, type_, a, motif=motif)
    n.cree_le = T0 + timedelta(minutes=minutes)
    db.commit()
    return n


def _statuts(db):
    db.expire_all()
    return {n.reference: n.courriel_statut for n in db.scalars(select(Notification))}


def test_echec_par_courriel_apres_le_delai_de_grace(compte_mdp, db, boite):
    u = _praticien(compte_mdp, db)
    _notif(db, u, "analyse_echouee", "PDX-2026-0100")
    _notif(db, u, "analyse_terminee", "PDX-2026-0101")          # jamais par e-mail
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=1)) == 0      # grâce de 2 min
    assert boite == []
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=3)) == 1
    (m,) = boite
    assert m.destinataire == EMAIL and m.sujet == "Analyse PDX-2026-0100 échouée"
    assert "Bonjour Hery" in m.texte and "/analyse?id=" in m.texte and "Profil › Préférences" in m.texte
    assert "RAKOTO" not in m.texte + m.html and "douleur" not in m.texte + m.html
    assert _statuts(db) == {"PDX-2026-0100": "envoye", "PDX-2026-0101": "sans_objet"}
    # Une seule fois.
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=30)) == 0 and len(boite) == 1
    (entree,) = db.scalars(select(Journal).where(Journal.action == "notifications_envoyees")).all()
    assert entree.details == {"nombre": 1, "references": ["PDX-2026-0100"]}


def test_lue_dans_l_application_pendant_la_grace_pas_de_courriel(compte_mdp, db, boite):
    u = _praticien(compte_mdp, db)
    n = _notif(db, u, "analyse_rouverte", "PDX-2026-0102", motif="Revoir la 46")
    notifications.marquer_lue(db, u.id, n.id)
    db.commit()
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=5)) == 0 and boite == []
    assert _statuts(db) == {"PDX-2026-0102": "lue_avant"}


def test_pas_de_rafale_les_suivantes_partent_ensemble(compte_mdp, db, boite):
    u = _praticien(compte_mdp, db)
    _notif(db, u, "analyse_echouee", "PDX-2026-0110")
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=3)) == 1
    _notif(db, u, "analyse_echouee", "PDX-2026-0111", minutes=3)
    _notif(db, u, "analyse_rouverte", "PDX-2026-0112", minutes=4, motif="Compléter")
    # 5 min après le premier e-mail seulement.
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=7)) == 0
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=8, seconds=1)) == 1
    assert len(boite) == 2
    groupe = boite[1]
    assert groupe.sujet == "PanoraDent AI : 2 notifications"
    assert "PDX-2026-0111" in groupe.texte and "PDX-2026-0112" in groupe.texte and "Motif : Compléter" in groupe.texte
    assert groupe.texte.count("/tableau-de-bord") == 1


def test_selon_les_preferences(compte_mdp, db, boite):
    u = _praticien(compte_mdp, db, courriel_analyse_rouverte=False)
    _notif(db, u, "analyse_rouverte", "PDX-2026-0120", motif="x" * 10)
    _notif(db, u, "analyse_echouee", "PDX-2026-0121")
    envoi.envoyer_en_attente(db, T0 + timedelta(minutes=3))
    assert [m.sujet for m in boite] == ["Analyse PDX-2026-0121 échouée"]
    assert _statuts(db)["PDX-2026-0120"] == "refuse"


def test_compte_desactive_ne_recoit_rien(compte_mdp, db, boite):
    u = _praticien(compte_mdp, db)
    _notif(db, u, "analyse_echouee", "PDX-2026-0130")
    db.get(Utilisateur, u.id).actif = False
    db.commit()
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=3)) == 0 and boite == []
    assert _statuts(db) == {"PDX-2026-0130": "sans_objet"}


def test_echec_d_envoi_journalise_sans_nouvel_essai(compte_mdp, db, boite, monkeypatch):
    u = _praticien(compte_mdp, db)
    _notif(db, u, "analyse_echouee", "PDX-2026-0140")

    def panne(message, lever=False):
        raise ConnectionError("SMTP injoignable")

    monkeypatch.setattr(courriel, "envoyer", panne)
    assert envoi.envoyer_en_attente(db, T0 + timedelta(minutes=3)) == 0
    assert _statuts(db) == {"PDX-2026-0140": "echec"}
    (entree,) = db.scalars(select(Journal).where(Journal.action == "notifications_envoyees")).all()
    assert entree.resultat == "echec"
