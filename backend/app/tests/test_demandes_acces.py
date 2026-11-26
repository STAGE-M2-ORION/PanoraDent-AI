"""Demandes d'accès (sprint 13, lot A) : pas d'inscription libre ; le
visiteur demande, l'administrateur accepte (et choisit le rôle) ou refuse."""
from datetime import datetime, timedelta

from sqlalchemy import select

from app import securite
from app.auth_models import Journal, Utilisateur
from app.config import settings
from app.models import DemandeAcces, Notification
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import demandes_acces

from .conftest import ADMIN_EMAIL, BASE
from .test_securite import figer_le_compteur

DEMANDE = {"nom": "Rasoanaivo Hery", "email": "Hery.Rasoa@cabinet-toliara.example.org", "profil": "Chirurgien-dentiste",
           "etablissement": "Cabinet du Port", "ville": "Toliara", "message": "Associé du Dr Rabe."}
URL = f"{BASE}/demandes-acces"
ADMIN = f"{BASE}/administration/demandes-acces"


def _role(admin, libelle):
    return next(r["id"] for r in admin.get(f"{BASE}/roles").json() if r["libelle"] == libelle)


def test_depot_public_et_administrateurs_prevenus(client, admin, connecte, db):
    connecte("dr.autre@cabinet.example.org", PRACTITIONER_ROLE)       # pas administrateur : rien
    visiteur = client.__class__(client.app, base_url="https://testserver")
    r = visiteur.post(URL, json=DEMANDE)
    assert r.status_code == 202 and "L'administrateur du cabinet l'examinera" in r.json()["message"]

    (d,) = db.scalars(select(DemandeAcces)).all()
    assert (d.email, d.statut, d.ville) == ("hery.rasoa@cabinet-toliara.example.org", "en_attente", "Toliara")
    notifs = db.scalars(select(Notification).where(Notification.type == "demande_acces")).all()
    destinataires = {db.get(Utilisateur, n.utilisateur_id).email for n in notifs}
    assert destinataires == {ADMIN_EMAIL}
    (n,) = notifs
    assert n.titre == "Demande d'accès : Rasoanaivo Hery" and n.lien == f"/admin/demandes-acces?demande={d.id}"
    assert "Cabinet du Port, Toliara" in n.message and n.courriel_statut is None        # e-mail selon sa préférence
    corps = admin.get(f"{BASE}/moi/notifications").json()
    assert corps["notifications"][0]["lien"] == n.lien


def test_meme_reponse_quoi_qu_il_arrive(client, db):
    visiteur = client.__class__(client.app, base_url="https://testserver")
    reponses = [visiteur.post(URL, json={**DEMANDE, "email": ADMIN_EMAIL}),     # compte existant
                visiteur.post(URL, json=DEMANDE), visiteur.post(URL, json=DEMANDE)]   # doublon en attente
    assert {r.status_code for r in reponses} == {202} and len({r.text for r in reponses}) == 1
    assert len(db.scalars(select(DemandeAcces)).all()) == 1
    motifs = [e.details.get("motif") for e in db.scalars(select(Journal).where(
        Journal.action == "demande_acces_recue", Journal.resultat == "refus"))]
    assert sorted(motifs) == ["compte_existant", "demande_en_attente"]


def test_champs_controles(client):
    visiteur = client.__class__(client.app, base_url="https://testserver")
    for corps in ({**DEMANDE, "email": "pas-une-adresse"}, {**DEMANDE, "nom": " "}, {**DEMANDE, "profil": "Patient"},
                  {**DEMANDE, "message": "x" * 1001}, {**DEMANDE, "role": "Administrateur"}):
        assert visiteur.post(URL, json=corps).status_code == 422, corps


def test_file_bornee(client, db, monkeypatch):
    monkeypatch.setattr(demandes_acces, "EN_ATTENTE_MAX", 1)
    visiteur = client.__class__(client.app, base_url="https://testserver")
    visiteur.post(URL, json=DEMANDE)
    assert visiteur.post(URL, json={**DEMANDE, "email": "autre@example.org"}).status_code == 202
    assert len(db.scalars(select(DemandeAcces)).all()) == 1


def test_accepter_cree_le_compte_avec_le_role_choisi(client, admin, db, boite):
    client.__class__(client.app, base_url="https://testserver").post(URL, json=DEMANDE)
    liste = admin.get(ADMIN).json()
    assert liste["en_attente"] == 1
    (d,) = liste["demandes"]
    r = admin.post(f"{ADMIN}/{d['id']}/accepter",
                   json={"role_id": _role(admin, VIEWER_ROLE), "modes_connexion": ["mot_de_passe"],
                         "nom": "Rasoanaivo", "prenom": "Hery"})
    assert r.status_code == 201, r.text
    u = r.json()["utilisateur"]
    assert (u["email"], u["role"]["libelle"], u["nom"], u["prenom"]) == (
        "hery.rasoa@cabinet-toliara.example.org", VIEWER_ROLE, "Rasoanaivo", "Hery")
    assert r.json()["demande"]["statut"] == "acceptee"
    (m,) = boite                                                             # le lien de première connexion habituel
    assert m.destinataire == "hery.rasoa@cabinet-toliara.example.org" and "premiere-connexion?jeton=" in m.texte
    # Décision prise : la notification des administrateurs passe lue ; demande close.
    assert admin.get(f"{BASE}/moi/notifications").json()["non_lues"] == 0
    assert admin.post(f"{ADMIN}/{d['id']}/refuser", json={}).json()["code"] == "demande_deja_traitee"
    actions = {e.action for e in db.scalars(select(Journal))}
    assert {"demande_acces_acceptee", "creation_compte"} <= actions


def test_refuser_avec_motif(client, admin, db, boite):
    client.__class__(client.app, base_url="https://testserver").post(URL, json=DEMANDE)
    (d,) = admin.get(ADMIN).json()["demandes"]
    r = admin.post(f"{ADMIN}/{d['id']}/refuser", json={"motif": "Hors du cabinet"})
    assert r.status_code == 200 and r.json()["demande"]["statut"] == "refusee"
    (m,) = boite
    assert m.sujet == "Votre demande d'accès à PanoraDent AI" and "Motif indiqué : Hors du cabinet" in m.texte
    assert db.scalar(select(Utilisateur).where(Utilisateur.email == d["email"])) is None
    assert admin.get(ADMIN, params={"statut": "refusee"}).json()["demandes"][0]["motif_refus"] == "Hors du cabinet"
    assert admin.get(ADMIN, params={"statut": "autre"}).status_code == 422


def test_reserve_aux_administrateurs(client, connecte):
    praticien = connecte("dr.demande@cabinet.example.org", PRACTITIONER_ROLE)
    assert praticien.get(ADMIN).status_code == 403
    assert praticien.post(f"{ADMIN}/x/accepter", json={"role_id": "00000000-0000-0000-0000-000000000000"}).status_code == 403
    anonyme = client.__class__(client.app, base_url="https://testserver")   # `client` est connecté (administrateur)
    assert anonyme.get(ADMIN).status_code == 401


def test_purge_a_90_jours(client, admin, db):
    client.__class__(client.app, base_url="https://testserver").post(URL, json=DEMANDE)
    (d,) = admin.get(ADMIN).json()["demandes"]
    admin.post(f"{ADMIN}/{d['id']}/refuser", json={})
    client.__class__(client.app, base_url="https://testserver").post(URL, json={**DEMANDE, "email": "b@example.org"})
    assert demandes_acces.purger(db, datetime.utcnow() + timedelta(days=89)) == 0
    assert demandes_acces.purger(db, datetime.utcnow() + timedelta(days=91)) == 1
    restantes = db.scalars(select(DemandeAcces)).all()
    assert [x.statut for x in restantes] == ["en_attente"]                   # jamais une demande en attente
    assert db.scalar(select(Journal).where(Journal.action == "demandes_acces_purgees")).details["supprimees"] == 1


def test_depot_limite_par_poste(client, monkeypatch):
    securite.COMPTEUR.vider()
    figer_le_compteur(monkeypatch)                    # même minute pour les trois demandes
    monkeypatch.setattr(settings, "limite_oubli_minute", 2)
    visiteur = client.__class__(client.app, base_url="https://testserver")
    codes = [visiteur.post(URL, json={**DEMANDE, "email": f"x{i}@example.org"}).status_code for i in range(3)]
    securite.COMPTEUR.vider()
    assert codes == [202, 202, 429]
