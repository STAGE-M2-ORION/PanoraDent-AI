"""Tableau de bord d'administration et comptes (sprint 11, lot E) : indicateurs
agrégés, export de la liste des comptes, renvoi groupé des liens."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import journal
from app.auth_models import Journal, Utilisateur
from app.models import Analysis, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE

from .conftest import BASE


def _connexion(db, resultat, jours=0):
    db.add(Journal(action="connexion", resultat=resultat, details={},
                   horodatage=datetime.now(timezone.utc) - timedelta(days=jours, minutes=1)))


def test_indicateurs_agreges(admin, creer_compte, compte_mdp, db):
    creer_compte("dr.jamais@cabinet.example.org", PRACTITIONER_ROLE)       # jamais connecté
    compte_mdp("lecteur.actif@cabinet.example.org", role=VIEWER_ROLE)
    desactive = compte_mdp("dr.parti@cabinet.example.org")
    desactive.actif = False
    maintenant = datetime.utcnow()
    for i in range(3):
        db.add(Analysis(reference=f"PDX-2026-16{i:02d}", image_key="k", width=1, height=1,
                        statut=StatutAnalyse.EN_FILE if i == 0 else StatutAnalyse.TERMINEE, created_at=maintenant))
    for _ in range(2):
        _connexion(db, journal.REFUS)
    _connexion(db, journal.SUCCES, jours=10)                                # semaine précédente
    db.commit()

    ind = admin.get(f"{BASE}/administration/indicateurs").json()
    comptes = ind["comptes"]
    # L'administrateur de départ, plus les trois comptes créés ici.
    assert (comptes["total"], comptes["actifs"], comptes["desactives"]) == (4, 3, 1)
    assert comptes["jamais_connectes"] >= 2        # le praticien créé, le lecteur sans connexion enregistrée
    roles = {r["role"]: r for r in comptes["par_role"]}
    assert roles["Praticien"] == {"role": "Praticien", "total": 2, "actifs": 1}
    assert roles["Lecteur"]["total"] == 1
    assert ind["analyses"] == {"ce_mois": 3, "mois_precedent": 0, "en_attente": 1}
    c = ind["connexions"]
    assert c["semaine"] >= 1                       # la connexion de l'administrateur à l'instant
    assert (c["echecs_semaine"], c["semaine_precedente"]) == (2, 1)
    mois = ind["nouveaux_comptes_par_mois"]
    assert len(mois) == 12 and mois[-1] == {"mois": maintenant.strftime("%Y-%m"), "comptes": 4}


def test_indicateurs_reserves_a_l_administration(connecte):
    for role in (PRACTITIONER_ROLE, VIEWER_ROLE):
        c = connecte(f"{role.lower()}.indic@cabinet.example.org", role)
        assert c.get(f"{BASE}/administration/indicateurs").status_code == 403


def test_export_de_la_liste_des_comptes_journalise(admin, creer_compte, db):
    creer_compte("dr.export@cabinet.example.org", PRACTITIONER_ROLE)
    r = admin.get(f"{BASE}/utilisateurs.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"].startswith('attachment; filename="comptes-')
    texte = r.content.decode("utf-8-sig")
    lignes = texte.strip().split("\r\n")
    assert lignes[0] == "Nom;Prénom;Adresse e-mail;Rôle;État;Modes de connexion;Créé le (UTC);Dernière connexion (UTC)"
    assert any("dr.export@cabinet.example.org;Praticien;Actif;" in l and l.endswith(";Jamais") for l in lignes)
    assert "$2" not in texte and "mot_de_passe" not in texte          # aucune empreinte
    (entree,) = db.scalars(select(Journal).where(Journal.action == "export_comptes")).all()
    assert entree.details == {"lignes": 2}


def test_renvoi_groupe_des_liens(admin, creer_compte, compte_mdp, boite, db):
    creer_compte("dr.un@cabinet.example.org", PRACTITIONER_ROLE)
    creer_compte("dr.deux@cabinet.example.org", PRACTITIONER_ROLE)
    compte_mdp("dr.active@cabinet.example.org")                           # a déjà son mot de passe
    creer_compte("dr.inactif@cabinet.example.org", PRACTITIONER_ROLE)
    db.scalars(select(Utilisateur).where(Utilisateur.email == "dr.inactif@cabinet.example.org")).one().actif = False
    db.commit()
    boite.clear()

    r = admin.post(f"{BASE}/utilisateurs/renvoyer-liens")
    assert r.status_code == 200
    assert r.json() == {"envoyes": 2, "comptes": ["dr.deux@cabinet.example.org", "dr.un@cabinet.example.org"]}
    assert sorted(m.destinataire for m in boite) == ["dr.deux@cabinet.example.org", "dr.un@cabinet.example.org"]
    renvois = db.scalars(select(Journal).where(Journal.action == "renvoi_lien")).all()
    assert len(renvois) == 2 and all(e.details == {"groupe": True} for e in renvois)

    # Un compte qui s'est connecté depuis sort de la liste.
    un = db.scalars(select(Utilisateur).where(Utilisateur.email == "dr.un@cabinet.example.org")).one()
    un.derniere_connexion = datetime.now(timezone.utc)
    db.commit()
    assert admin.post(f"{BASE}/utilisateurs/renvoyer-liens").json()["comptes"] == ["dr.deux@cabinet.example.org"]


def test_renvoi_groupe_reserve_a_l_administration(connecte):
    praticien = connecte("dr.renvoi@cabinet.example.org", PRACTITIONER_ROLE)
    assert praticien.post(f"{BASE}/utilisateurs/renvoyer-liens").status_code == 403
    assert praticien.get(f"{BASE}/utilisateurs.csv").status_code == 403
