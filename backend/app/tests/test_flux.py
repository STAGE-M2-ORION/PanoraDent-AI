"""Réponse au fil de l'eau et arrêt (sprint 10, lot B).

Le point qui ferme le lot : un flux interrompu libère la ressource CÔTÉ
SERVEUR. Couper l'affichage ne suffit pas, la rédaction doit s'arrêter ; sinon
chaque clic sur « Arrêter » laisserait le modèle écrire pour rien.
"""
import asyncio
import json

import httpx
import pytest
from sqlalchemy import select

from app.auth_models import Journal, Utilisateur
from app.main import app
from app.models import Analysis, Detection, Document, EtatDetection, Message, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE
from app.services import assistant, conversations
from app.services.assistant import ECHEC_SANS_SOURCE, INTERROMPUE, REFUS_HORS_DOCUMENTATION
from app.services.indexation import empreinte, indexer
from app.services.redaction import Extrait, RedacteurOllama, RedactionImpossible
from app.services.vectorisation import VectoriseurFactice

from .conftest import BASE

GUIDE = """# Lésions péri-apicales

Une lésion péri-apicale est une zone radio-claire autour de l'apex de la racine. Elle accompagne souvent une \
atteinte de la pulpe.
""".encode()
QUESTION = "Qu'est-ce qu'une lésion péri-apicale ?"


@pytest.fixture()
def analyse(db):
    doc = Document(titre="Guide", nom_fichier="guide.md", format="markdown", cle_stockage="documents/g",
                   empreinte=empreinte(GUIDE), taille=len(GUIDE))
    db.add(doc)
    indexer(db, doc, GUIDE, VectoriseurFactice())
    assistant.parametres(db).seuil = 0.2
    a = Analysis(reference="PDX-2026-1100", image_key="images/f.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="v1")
    a.detections = [Detection(label="periapical_lesion", fdi=36, confidence=0.7, x=0.1, y=0.1, w=0.1, h=0.1,
                              model_version="v1", etat=EtatDetection.VALIDEE)]
    db.add(a)
    db.commit()
    return a


@pytest.fixture()
def praticien(connecte):
    return connecte("dr.flux@cabinet.example.org", PRACTITIONER_ROLE)


def evenements(corps: str) -> list[tuple[str, dict]]:
    sortie = []
    for bloc in corps.strip().split("\n\n"):
        lignes = dict(l.split(": ", 1) for l in bloc.splitlines())
        sortie.append((lignes["event"], json.loads(lignes["data"])))
    return sortie


class Lent:
    """Rédacteur de test : un mot toutes les 50 ms, et il sait s'il a été arrêté."""
    nom = "lent"

    def __init__(self, mots=40, texte=None):
        self.texte = texte or " ".join(["Une zone radio-claire [1]."] * mots)
        self.livres, self.ferme, self.termine = 0, False, False

    def rediger(self, *a):
        return self.texte

    async def flux(self, *a):
        try:
            for mot in self.texte.split(" "):
                await asyncio.sleep(0.05)
                self.livres += 1
                yield mot + " "
            self.termine = True
        finally:
            self.ferme = True


# --- Par HTTP ---------------------------------------------------------------------

def test_reponse_au_fil_de_l_eau_puis_verifiee_et_enregistree(praticien, analyse):
    r = praticien.post(f"{BASE}/analyses/{analyse.id}/conversation/flux", json={"question": QUESTION})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["x-accel-buffering"] == "no" and r.headers["cache-control"] == "no-cache"
    ev = evenements(r.text)
    assert ev[0] == ("debut", {"passages": 1})
    fragments = [d["texte"] for g, d in ev if g == "fragment"]
    assert len(fragments) > 3                      # livrée par morceaux
    genre, fin = ev[-1]
    assert genre == "fin" and fin["reponse"]["statut"] == "reponse"
    assert "".join(fragments).strip() == fin["reponse"]["texte"]
    assert fin["reponse"]["sources"][0]["titre"] == "Guide" and "diagnostic" in fin["avertissement"]
    assert fin["question"]["texte"] == QUESTION
    fil = praticien.get(f"{BASE}/analyses/{analyse.id}/conversation").json()["messages"]
    assert [m["id"] for m in fil] == [fin["question"]["id"], fin["reponse"]["id"]]


def test_refus_sans_brouillon(praticien, analyse):
    r = praticien.post(f"{BASE}/analyses/{analyse.id}/conversation/flux",
                       json={"question": "Comment traiter une fracture du fémur ?"})
    (genre, fin), = evenements(r.text)
    assert genre == "fin" and (fin["reponse"]["statut"], fin["reponse"]["texte"]) == ("refus", REFUS_HORS_DOCUMENTATION)


def test_brouillon_non_source_retire_et_jamais_enregistre(praticien, analyse, db, monkeypatch):
    monkeypatch.setattr(assistant, "redacteur_courant", lambda: Lent(texte="Elle se traite par antibiotiques."))
    ev = evenements(praticien.post(f"{BASE}/analyses/{analyse.id}/conversation/flux",
                                   json={"question": QUESTION}).text)
    assert "antibiotiques" in "".join(d["texte"] for g, d in ev if g == "fragment")   # le brouillon est passé…
    fin = ev[-1][1]["reponse"]
    assert (fin["statut"], fin["texte"]) == ("echec", ECHEC_SANS_SOURCE)              # … puis retiré
    assert not any("antibiotiques" in m.texte for m in db.scalars(select(Message)))   # et jamais gardé


def test_refus_avant_l_ouverture_du_flux(praticien, analyse):
    r = praticien.post(f"{BASE}/analyses/{analyse.id}/conversation/flux", json={"question": "a"})
    assert (r.status_code, r.headers["content-type"], r.json()["code"]) == (422, "application/json",
                                                                              "question_invalide")


# --- Arrêt : la ressource est libérée côté serveur -------------------------------

def _cookies(client) -> str:
    return "; ".join(f"{k}={v}" for k, v in client.cookies.items())


def test_navigateur_qui_coupe_le_flux_arrete_la_redaction(praticien, analyse, db, monkeypatch):
    """Au niveau ASGI : le client envoie `http.disconnect` après le premier
    fragment, comme un navigateur dont on a cliqué « Arrêter »."""
    lent = Lent()
    monkeypatch.setattr(assistant, "redacteur_courant", lambda: lent)
    corps = json.dumps({"question": QUESTION}).encode()
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "https",
        "path": f"/api/v1/analyses/{analyse.id}/conversation/flux", "raw_path": b"", "query_string": b"",
        "root_path": "", "server": ("testserver", 443), "client": ("10.0.0.9", 50000),
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"),
                    (b"content-length", str(len(corps)).encode()), (b"cookie", _cookies(praticien).encode())],
    }

    async def scenario():
        premier_fragment = asyncio.Event()
        envoye = {"corps": False}

        async def receive():
            if not envoye["corps"]:
                envoye["corps"] = True
                return {"type": "http.request", "body": corps, "more_body": False}
            await premier_fragment.wait()
            return {"type": "http.disconnect"}

        statuts = []

        async def send(message):
            if message["type"] == "http.response.start":
                statuts.append(message["status"])
            if message["type"] == "http.response.body" and b"event: fragment" in message.get("body", b""):
                premier_fragment.set()

        await asyncio.wait_for(app(scope, receive, send), timeout=10)
        return statuts

    assert asyncio.run(scenario()) == [200]
    # La rédaction s'est arrêtée bien avant la fin (40 mots), et son flux a été fermé.
    assert lent.ferme and not lent.termine and lent.livres < 10
    # Le fil garde la question et une réponse « interrompue », sans le brouillon.
    db.expire_all()
    messages = db.scalars(select(Message).order_by(Message.rang)).all()
    assert [(m.role, m.statut, m.texte) for m in messages] == [
        ("question", None, QUESTION), ("reponse", "interrompue", INTERROMPUE)]
    entree = db.scalars(select(Journal).where(Journal.action == "question_assistant")).one()
    assert entree.details["statut"] == "interrompue"


@pytest.mark.parametrize("maniere", ["fermeture", "annulation"])
def test_generateur_coupe_ferme_le_flux_du_modele(session_factory, analyse, db, maniere):
    """Au niveau du service : fermer le générateur (`aclose`) ou annuler la
    tâche qui le lit referme le flux du modèle."""
    lent = Lent()
    auteur_id = db.scalars(select(Utilisateur)).first().id

    async def scenario():
        flux = conversations.repondre_en_flux(session_factory, analyse.id, auteur_id, QUESTION, redacteur=lent,
                                              vectoriseur=VectoriseurFactice())
        if maniere == "fermeture":
            async for genre, _ in flux:
                if genre == "fragment":
                    break
            await flux.aclose()
        else:
            vu = asyncio.Event()

            async def lire():
                async for genre, _ in flux:
                    if genre == "fragment":
                        vu.set()

            tache = asyncio.create_task(lire())
            await vu.wait()
            tache.cancel()
            with pytest.raises(asyncio.CancelledError):
                await tache

    asyncio.run(scenario())
    assert lent.ferme and not lent.termine
    with session_factory() as db:
        assert [m.statut for m in db.scalars(select(Message).order_by(Message.rang))] == [None, "interrompue"]


# --- Ollama en flux ---------------------------------------------------------------

def _ollama(lignes, statut=200):
    def handler(request):
        corps = json.loads(request.content)
        assert corps["stream"] is True
        return httpx.Response(statut, content="".join(json.dumps(l) + "\n" for l in lignes).encode())
    return httpx.MockTransport(handler)


async def _lire(flux):
    return [f async for f in flux]


EXTRAITS = [Extrait(1, "Guide", None, None, "Texte.")]


def test_ollama_en_flux_fragments_jusqu_a_done():
    transport = _ollama([{"message": {"content": "Une zone "}, "done": False},
                         {"message": {"content": "radio-claire [1]."}, "done": False},
                         {"message": {"content": ""}, "done": True},
                         {"message": {"content": "ignoré"}, "done": False}])
    r = RedacteurOllama("http://ollama:11434", "qwen2.5:3b", transport=transport)
    assert asyncio.run(_lire(r.flux("Q ?", EXTRAITS, None))) == ["Une zone ", "radio-claire [1]."]


@pytest.mark.parametrize("statut, motif", [(404, "n'est pas installé"), (500, "HTTP 500")])
def test_ollama_en_flux_refus(statut, motif):
    r = RedacteurOllama("http://ollama:11434", "qwen2.5:3b", transport=_ollama([], statut))
    with pytest.raises(RedactionImpossible, match=motif):
        asyncio.run(_lire(r.flux("Q ?", EXTRAITS, None)))


def test_ollama_absent_en_flux():
    def panne(request):
        raise httpx.ConnectError("refus")
    r = RedacteurOllama("http://ollama:11434", "qwen2.5:3b", transport=httpx.MockTransport(panne))
    with pytest.raises(RedactionImpossible, match="ne répond pas"):
        asyncio.run(_lire(r.flux("Q ?", EXTRAITS, None)))
