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


# --- Flux temps réel (lot B) ---------------------------------------------------------------

import pytest  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from app.routers import notifications as routeur  # noqa: E402
from app.services import diffusion  # noqa: E402

FLUX = "wss://testserver/api/v1/moi/notifications/flux"   # wss : les cookies Secure partent
ORIGINE = {"origin": "https://testserver"}


def _notifier(db, email, reference="PDX-2026-0950"):
    a = Analysis(reference=reference, image_key="k", width=1, height=1)
    db.add(a)
    db.flush()
    n = notifications.notifier(db, _id(db, email), "analyse_terminee", a)
    db.commit()
    return n


def test_flux_refuse_une_autre_origine(connecte):
    rabe = connecte("dr.rabe@cabinet.example.org")
    for entetes in ({}, {"origin": "https://site-malveillant.example"}, {"origin": "https://testserver.example"}):
        with pytest.raises(WebSocketDisconnect) as refus:
            with rabe.websocket_connect(FLUX, headers=entetes):
                pass
        assert refus.value.code == 1008


def test_flux_sans_session(client):
    with client.websocket_connect(FLUX, headers=ORIGINE) as ws:
        with pytest.raises(WebSocketDisconnect) as fin:
            ws.receive_json()
    assert fin.value.code == 4401


def test_flux_remet_ses_notifications_seulement(connecte, db):
    rabe = connecte("dr.rabe@cabinet.example.org")
    connecte("dr.voisin@cabinet.example.org")
    _notifier(db, "dr.rabe@cabinet.example.org", "PDX-2026-0951")         # avant connexion : comptée
    with rabe.websocket_connect(FLUX, headers=ORIGINE) as ws:
        assert ws.receive_json() == {"type": "etat", "non_lues": 1}
        _notifier(db, "dr.voisin@cabinet.example.org", "PDX-2026-0952")   # pas pour lui
        _notifier(db, "dr.rabe@cabinet.example.org", "PDX-2026-0953")
        m = ws.receive_json()
        assert m["type"] == "notification" and m["non_lues"] == 2
        assert m["notification"]["reference"] == "PDX-2026-0953"


def test_flux_ferme_quand_la_session_est_fermee(connecte, monkeypatch):
    monkeypatch.setattr(routeur, "CONTROLE_S", 0.2)
    rabe = connecte("dr.rabe@cabinet.example.org")
    with rabe.websocket_connect(FLUX, headers=ORIGINE) as ws:
        assert ws.receive_json()["type"] == "etat"
        assert rabe.post(f"{BASE}/auth/deconnexion").status_code == 204
        with pytest.raises(WebSocketDisconnect) as fin:
            while True:
                ws.receive_json()
    assert fin.value.code == 4401


def test_flux_borne_le_nombre_d_onglets(connecte, monkeypatch):
    monkeypatch.setattr(diffusion, "ONGLETS_MAX", 1)
    rabe = connecte("dr.rabe@cabinet.example.org")
    with rabe.websocket_connect(FLUX, headers=ORIGINE) as premier:
        assert premier.receive_json()["type"] == "etat"
        with rabe.websocket_connect(FLUX, headers=ORIGINE) as second:
            with pytest.raises(WebSocketDisconnect) as fin:
                second.receive_json()
        assert fin.value.code == 4429


def test_une_notification_annulee_n_est_pas_annoncee(db, connecte):
    connecte("dr.rabe@cabinet.example.org")
    remises = []
    a = Analysis(reference="PDX-2026-0954", image_key="k", width=1, height=1)
    db.add(a)
    db.flush()
    origine = diffusion.DIFFUSEUR.publier
    diffusion.DIFFUSEUR.publier = lambda u, n: remises.append(n)
    try:
        notifications.notifier(db, _id(db, "dr.rabe@cabinet.example.org"), "analyse_terminee", a)
        db.rollback()
        assert remises == []
        n = _notifier(db, "dr.rabe@cabinet.example.org", "PDX-2026-0955")
        assert remises == [n.id]
    finally:
        diffusion.DIFFUSEUR.publier = origine
