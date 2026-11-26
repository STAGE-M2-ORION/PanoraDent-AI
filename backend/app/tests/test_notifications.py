"""Notifications (sprint 13, lot A) : trois événements, chacun prévenu des
siens seulement, jamais de sa propre action, jamais de donnée de santé."""
from datetime import datetime

from sqlalchemy import select

from app import worker
from app.auth_models import Utilisateur
from app.models import Analysis, Notification, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import notifications

from .conftest import BASE
from .test_analyses import _envoyer, objets  # noqa: F401  (fixture du stockage simulé)
from .test_anonymize import octets, panoramique
from .test_file_traitement import modele, reponse  # noqa: F401  (fixture du modèle simulé)

URL = f"{BASE}/moi/notifications"


def _id(db, email):
    return db.scalar(select(Utilisateur.id).where(Utilisateur.email == email))


def _importer(client, nom="RAKOTO_Jean_1961.png", note="Patient RAKOTO, douleur 36") -> str:
    r = _envoyer(client, octets(panoramique()), nom=nom, note=note)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_analyse_terminee_previent_le_deposant_seul(connecte, objets, modele, session_factory, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    voisin = connecte("dr.voisin@cabinet.example.org")
    ident = _importer(rabe)
    assert rabe.get(URL).json()["non_lues"] == 0              # rien avant le traitement
    assert worker.traiter_une(session_factory) is True

    corps = rabe.get(URL).json()
    assert corps["non_lues"] == 1 and corps["suivant"] is None
    (n,) = corps["notifications"]
    reference = db.get(Analysis, ident).reference
    assert n["type"] == "analyse_terminee" and n["analyse_id"] == ident and n["reference"] == reference
    assert n["titre"] == f"Analyse {reference} terminée" and not n["lue"]
    # Le nombre annoncé est celui des anomalies qui attendront un verdict avant la clôture.
    assert n["message"].startswith("Prête à relire : ")
    # Aucune donnée de santé : ni le nom du fichier, ni la note.
    assert "RAKOTO" not in str(corps) and "douleur" not in str(corps)
    assert voisin.get(URL).json() == {"non_lues": 0, "notifications": [], "suivant": None}


def test_analyse_echouee_previent_le_deposant(connecte, objets, modele, session_factory):
    rabe = connecte("dr.rabe@cabinet.example.org")
    _importer(rabe)
    modele["panne"] = True
    worker.traiter_une(session_factory)
    (n,) = rabe.get(URL).json()["notifications"]
    assert n["type"] == "analyse_echouee" and "relancer" in n["message"]


def test_reouverture_previent_celui_qui_avait_cloture(admin, connecte, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    a = Analysis(reference="PDX-2026-0900", image_key="k", width=1, height=1, statut=StatutAnalyse.TERMINEE,
                 cloturee_le=datetime.utcnow(), cloturee_par_id=_id(db, "dr.rabe@cabinet.example.org"))
    db.add(a)
    db.commit()
    motif = "Vérifier la 46 avec le cliché de contrôle " + "x" * 300
    assert admin.post(f"{BASE}/analyses/{a.id}/rouvrir", json={"motif": motif}).status_code == 200

    (n,) = rabe.get(URL).json()["notifications"]
    assert n["type"] == "analyse_rouverte" and n["titre"] == "Analyse PDX-2026-0900 rouverte"
    assert n["message"].startswith("Rouverte par l'administrateur. Motif : Vérifier la 46")
    assert len(n["message"]) < 260 and n["message"].endswith("…")          # motif tronqué
    # L'administrateur, auteur de la réouverture, ne reçoit rien.
    assert admin.get(URL).json()["non_lues"] == 0


def test_jamais_sa_propre_action_ni_un_compte_desactive(db, connecte):
    connecte("dr.seul@cabinet.example.org")
    moi = _id(db, "dr.seul@cabinet.example.org")
    a = Analysis(reference="PDX-2026-0901", image_key="k", width=1, height=1)
    db.add(a)
    db.flush()
    assert notifications.notifier(db, moi, "analyse_rouverte", a, auteur_id=moi) is None
    assert notifications.notifier(db, None, "analyse_terminee", a) is None
    db.get(Utilisateur, moi).actif = False
    assert notifications.notifier(db, moi, "analyse_terminee", a) is None
    db.rollback()


def test_lecture_et_pagination(connecte, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    autre = connecte("lecteur.autre@cabinet.example.org", VIEWER_ROLE)
    moi = _id(db, "dr.rabe@cabinet.example.org")
    a = Analysis(reference="PDX-2026-0902", image_key="k", width=1, height=1)
    db.add(a)
    db.flush()
    for _ in range(5):
        notifications.notifier(db, moi, "analyse_terminee", a)
    db.commit()

    page1 = rabe.get(URL, params={"limite": 3}).json()
    assert page1["non_lues"] == 5 and len(page1["notifications"]) == 3 and page1["suivant"]
    page2 = rabe.get(URL, params={"limite": 3, "avant": page1["suivant"]}).json()
    assert len(page2["notifications"]) == 2 and page2["suivant"] is None
    ids = [n["id"] for n in page1["notifications"] + page2["notifications"]]
    assert len(set(ids)) == 5                                                # ni doublon ni oubli

    premiere = ids[0]
    assert rabe.post(f"{URL}/{premiere}/lue").status_code == 204
    assert rabe.post(f"{URL}/{premiere}/lue").status_code == 204             # rejouable
    assert rabe.get(URL).json()["non_lues"] == 4
    # Celle d'un autre : 404, comme une inexistante ; et elle reste non lue.
    assert autre.post(f"{URL}/{ids[1]}/lue").status_code == 404
    assert autre.post(f"{URL}/inconnue/lue").status_code == 404
    assert rabe.post(f"{URL}/lues").json() == {"marquees": 4}
    assert rabe.get(URL).json()["non_lues"] == 0
    assert rabe.get(URL, params={"avant": "!!"}).status_code == 422


def test_session_exigee(client):
    assert client.get(URL).status_code == 401


def test_la_notification_survit_a_la_suppression_de_l_analyse(db, connecte):
    connecte("dr.rabe@cabinet.example.org", PRACTITIONER_ROLE)
    moi = _id(db, "dr.rabe@cabinet.example.org")
    a = Analysis(reference="PDX-2026-0903", image_key="k", width=1, height=1)
    db.add(a)
    db.flush()
    n = notifications.notifier(db, moi, "analyse_terminee", a)
    db.commit()
    db.delete(a)
    db.commit()
    db.expire_all()
    restante = db.get(Notification, n.id)
    assert restante is not None and restante.reference == "PDX-2026-0903"
