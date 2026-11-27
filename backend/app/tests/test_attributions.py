"""Analyses confiées à un lecteur (lot A).

Le lecteur ne voit que les analyses qui lui sont confiées ; les autres lui
répondent « introuvable », comme une analyse qui n'existe pas. Le déposant
(ou un administrateur) confie et retire, avant comme après la clôture.
"""
import json
from datetime import datetime

import pytest
from sqlalchemy import select

from app.auth_models import Journal, Role, Utilisateur
from app.models import Analysis, Attribution, StatutAnalyse
from app.permissions import ANALYSIS_READ_ALL, PRACTITIONER_ROLE, VIEWER_ROLE

from .conftest import BASE
from .test_analyses import _envoyer, objets  # noqa: F401
from .test_anonymize import octets, panoramique

RABE = "dr.rabe.attrib@cabinet.example.org"
CONFRERE = "dr.confrere.attrib@cabinet.example.org"
LECTEUR = "lecteur.attrib@cabinet.example.org"
AUTRE_LECTEUR = "lecteur2.attrib@cabinet.example.org"


def _id(db, email):
    return str(db.scalar(select(Utilisateur.id).where(Utilisateur.email == email)))


def _analyse(db, ref, auteur_email, *, cloturee=False):
    a = Analysis(reference=ref, image_key=f"images/{ref}.png", width=10, height=10, statut=StatutAnalyse.TERMINEE,
                 model_version="v1", inference_mode="real",
                 utilisateur_id=db.scalar(select(Utilisateur.id).where(Utilisateur.email == auteur_email)))
    if cloturee:
        a.cloturee_le = datetime.utcnow()
    db.add(a)
    db.commit()
    return a.id


@pytest.fixture()
def cabinet(connecte, db):
    c = {"rabe": connecte(RABE), "confrere": connecte(CONFRERE),
         "lecteur": connecte(LECTEUR, VIEWER_ROLE), "lecteur2": connecte(AUTRE_LECTEUR, VIEWER_ROLE)}
    c["a1"] = _analyse(db, "PDX-2026-0901", RABE)
    c["a2"] = _analyse(db, "PDX-2026-0902", RABE, cloturee=True)
    c["a3"] = _analyse(db, "PDX-2026-0903", CONFRERE)
    return c


def _confier(client, analysis_id, *emails_ids):
    return client.put(f"{BASE}/analyses/{analysis_id}/lecteurs", json={"lecteurs": list(emails_ids)})


# --- Ce que voit le lecteur -----------------------------------------------------------------

LECTURES = ("", "/statut", "/image", "/historique")


def test_le_lecteur_ne_voit_rien_tant_que_rien_ne_lui_est_confie(cabinet, monkeypatch):
    from app.routers import analyses as analyses_router
    monkeypatch.setattr(analyses_router.storage, "presigned_url", lambda cle: f"/storage/{cle}")
    lecteur = cabinet["lecteur"]
    assert lecteur.get(f"{BASE}/analyses").json() == []
    assert lecteur.get(f"{BASE}/historique").json()["total"] == 0
    for suite in LECTURES:
        r = lecteur.get(f"{BASE}/analyses/{cabinet['a1']}{suite}")
        # Même réponse qu'une analyse inexistante : il n'apprend pas qu'elle existe.
        inconnue = lecteur.get(f"{BASE}/analyses/n-existe-pas{suite}")
        assert (r.status_code, r.json()) == (inconnue.status_code, inconnue.json()) == (
            404, {"code": "introuvable", "message": "Analyse introuvable."} | {k: v for k, v in r.json().items()
                                                                              if k not in ("code", "message")}), suite


def test_le_lecteur_voit_ce_qui_lui_est_confie_et_rien_d_autre(cabinet, db, monkeypatch):
    from app.routers import analyses as analyses_router
    monkeypatch.setattr(analyses_router.storage, "presigned_url", lambda cle: f"/storage/{cle}")
    assert _confier(cabinet["rabe"], cabinet["a1"], _id(db, LECTEUR)).status_code == 200
    lecteur = cabinet["lecteur"]
    assert [a["reference"] for a in lecteur.get(f"{BASE}/analyses").json()] == ["PDX-2026-0901"]
    h = lecteur.get(f"{BASE}/historique").json()
    assert [e["reference"] for e in h["elements"]] == ["PDX-2026-0901"]
    csv = lecteur.get(f"{BASE}/historique.csv").content.decode("utf-8")
    assert "PDX-2026-0901" in csv and "PDX-2026-0902" not in csv and "PDX-2026-0903" not in csv
    for suite in LECTURES:
        assert lecteur.get(f"{BASE}/analyses/{cabinet['a1']}{suite}").status_code == 200, suite
        assert lecteur.get(f"{BASE}/analyses/{cabinet['a3']}{suite}").status_code == 404, suite
    # L'autre lecteur ne voit toujours rien.
    assert cabinet["lecteur2"].get(f"{BASE}/analyses/{cabinet['a1']}").status_code == 404
    # Tableau de bord : ses analyses confiées seulement.
    ind = lecteur.get(f"{BASE}/tableau-de-bord/activite").json()
    assert ind["portee"] == "cabinet" and ind["analyses"]["a_relire"] == 1 and ind["analyses"]["cloturees"] == 0


def test_praticiens_et_administrateur_voient_tout(cabinet, admin):
    for c in (cabinet["rabe"], cabinet["confrere"], admin):
        assert len(c.get(f"{BASE}/analyses").json()) == 3
        assert c.get(f"{BASE}/analyses/{cabinet['a3']}").status_code == 200


def test_role_personnalise_sans_lecture_de_tout_restreint_avec_tout_voit(admin, nouveau_client, cabinet, db):
    from .conftest import connexion, erreur
    for libelle, perms in (("Secrétaire", ["analysis:read"]), ("Assistant", ["analysis:read", ANALYSIS_READ_ALL])):
        r = admin.post(f"{BASE}/roles", json={"libelle": libelle, "permissions": perms})
        assert r.status_code == 201, r.text
        email = f"{libelle.lower()}.attrib@cabinet.example.org"
        assert admin.post(f"{BASE}/utilisateurs", json={"email": email, "role_id": r.json()["id"]}).status_code == 201
        c = nouveau_client()
        assert erreur(connexion(c, email)) is None
        assert len(c.get(f"{BASE}/analyses").json()) == (0 if libelle == "Secrétaire" else 3)
    # La secrétaire est attribuable (elle lit sans tout voir) ; l'assistant, non.
    noms = {lec["email"] for lec in cabinet["rabe"].get(f"{BASE}/lecteurs").json()}
    assert noms == {LECTEUR, AUTRE_LECTEUR, "secrétaire.attrib@cabinet.example.org"}


def test_le_role_lecteur_ne_lit_pas_tout(db):
    lecteur = db.scalar(select(Role).where(Role.libelle == VIEWER_ROLE))
    praticien = db.scalar(select(Role).where(Role.libelle == PRACTITIONER_ROLE))
    assert ANALYSIS_READ_ALL not in lecteur.permission_codes
    assert ANALYSIS_READ_ALL in praticien.permission_codes


# --- Confier et retirer -----------------------------------------------------------------------

def test_le_deposant_confie_a_plusieurs_lecteurs_puis_retire(cabinet, db):
    rabe, l1, l2 = cabinet["rabe"], _id(db, LECTEUR), _id(db, AUTRE_LECTEUR)
    r = _confier(rabe, cabinet["a1"], l1, l2)
    assert r.status_code == 200, r.text
    assert {lec["id"] for lec in r.json()["lecteurs"]} == {l1, l2} and r.json()["modifiable"] is True
    assert cabinet["lecteur2"].get(f"{BASE}/analyses/{cabinet['a1']}").status_code == 200

    r = _confier(rabe, cabinet["a1"], l1)                       # retire le second
    assert [lec["id"] for lec in r.json()["lecteurs"]] == [l1]
    assert cabinet["lecteur2"].get(f"{BASE}/analyses/{cabinet['a1']}").status_code == 404
    assert _confier(rabe, cabinet["a1"], l1).status_code == 200   # inchangé : rien de journalisé

    lignes = db.scalars(select(Journal).where(Journal.action == "attribution_analyse")
                        .order_by(Journal.horodatage)).all()
    assert len(lignes) == 2 and all(e.cible == f"analyse:{cabinet['a1']}" for e in lignes)
    assert lignes[0].details["reference"] == "PDX-2026-0901" and len(lignes[0].details["ajoutes"]) == 2
    assert lignes[1].details["ajoutes"] == [] and len(lignes[1].details["retires"]) == 1
    # La fiche d'historique de l'analyse montre l'événement.
    fiche = rabe.get(f"{BASE}/analyses/{cabinet['a1']}/historique").json()
    assert "Lecteurs de l'analyse modifiés" in json.dumps(fiche, ensure_ascii=False)


def test_confier_apres_la_cloture(cabinet, db):
    assert _confier(cabinet["rabe"], cabinet["a2"], _id(db, LECTEUR)).status_code == 200
    assert cabinet["lecteur"].get(f"{BASE}/analyses/{cabinet['a2']}").json()["reference"] == "PDX-2026-0902"


def test_seuls_le_deposant_et_l_administrateur_confient(cabinet, admin, db):
    l1 = _id(db, LECTEUR)
    r = _confier(cabinet["confrere"], cabinet["a1"], l1)
    assert r.status_code == 403 and r.json()["code"] == "acces_refuse"
    assert cabinet["confrere"].get(f"{BASE}/analyses/{cabinet['a1']}/lecteurs").json()["modifiable"] is False
    assert _confier(cabinet["lecteur"], cabinet["a1"], l1).status_code == 403     # pas analysis:create
    assert cabinet["lecteur"].get(f"{BASE}/analyses/{cabinet['a1']}/lecteurs").status_code == 403
    assert _confier(admin, cabinet["a1"], l1).status_code == 200


@pytest.mark.parametrize("cible", ["praticien", "inconnu", "inactif", "mal_forme"])
def test_on_ne_confie_qu_a_un_lecteur_actif(cabinet, db, cible):
    ids = {"praticien": _id(db, CONFRERE), "inconnu": "00000000-0000-0000-0000-000000000000",
           "mal_forme": "pas-un-uuid"}
    if cible == "inactif":
        u = db.scalar(select(Utilisateur).where(Utilisateur.email == AUTRE_LECTEUR))
        u.actif = False
        db.commit()
        ids["inactif"] = str(u.id)
    r = _confier(cabinet["rabe"], cabinet["a1"], _id(db, LECTEUR), ids[cible])
    assert r.status_code == 422 and r.json()["code"] == "lecteur_invalide"
    assert db.scalars(select(Attribution)).all() == []                  # rien d'écrit


def test_liste_des_lecteurs_attribuables(cabinet, db):
    r = cabinet["rabe"].get(f"{BASE}/lecteurs")
    assert r.status_code == 200
    assert {lec["email"] for lec in r.json()} == {LECTEUR, AUTRE_LECTEUR}
    assert cabinet["lecteur"].get(f"{BASE}/lecteurs").status_code == 403


def test_suppression_de_l_analyse_retire_ses_attributions(cabinet, db, monkeypatch):
    from app.routers import analyses as analyses_router
    monkeypatch.setattr(analyses_router.storage, "delete", lambda cle: None)
    _confier(cabinet["rabe"], cabinet["a1"], _id(db, LECTEUR))
    assert cabinet["rabe"].delete(f"{BASE}/analyses/{cabinet['a1']}").status_code == 204
    db.expire_all()
    assert db.scalars(select(Attribution)).all() == []


# --- À l'import -------------------------------------------------------------------------------

def test_confier_des_l_import(connecte, db, objets):  # noqa: F811
    rabe = connecte(RABE)
    connecte(LECTEUR, VIEWER_ROLE)
    r = _envoyer(rabe, octets(panoramique()), lecteurs=json.dumps([_id(db, LECTEUR)]))
    assert r.status_code == 201, r.text
    assert [lec["email"] for lec in rabe.get(f"{BASE}/analyses/{r.json()['id']}/lecteurs").json()["lecteurs"]] == [LECTEUR]


@pytest.mark.parametrize("valeur", ["pas du json", '{"a": 1}', '["00000000-0000-0000-0000-000000000000"]'])
def test_import_refuse_avant_tout_stockage_si_lecteur_invalide(connecte, db, objets, valeur):  # noqa: F811
    rabe = connecte(RABE)
    r = _envoyer(rabe, octets(panoramique()), lecteurs=valeur)
    assert r.status_code == 422 and r.json()["code"] == "lecteur_invalide"
    assert objets == {} and db.scalars(select(Analysis)).all() == []


def test_import_sans_lecteur_inchange(connecte, db, objets):  # noqa: F811
    rabe = connecte(RABE)
    r = _envoyer(rabe, octets(panoramique()))
    assert r.status_code == 201
    assert rabe.get(f"{BASE}/analyses/{r.json()['id']}/lecteurs").json()["lecteurs"] == []


# --- Rejeu : l'origine reste invisible si elle n'est pas confiée ----------------------------

def test_comparaison_d_un_rejeu_confie_sans_son_origine(cabinet, db):
    rejeu = Analysis(reference="PDX-2026-0904", image_key="images/r.png", width=10, height=10,
                     statut=StatutAnalyse.TERMINEE, origine_id=cabinet["a1"], model_version="v2", inference_mode="real")
    db.add(rejeu)
    db.commit()
    db.add(Attribution(analysis_id=rejeu.id, lecteur_id=db.scalar(select(Utilisateur.id).where(Utilisateur.email == LECTEUR))))
    db.commit()
    r = cabinet["lecteur"].get(f"{BASE}/analyses/{rejeu.id}/comparaison")
    assert r.status_code == 404 and "PDX-2026-0901" not in r.text
