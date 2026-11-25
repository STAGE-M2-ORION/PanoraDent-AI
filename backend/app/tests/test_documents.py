"""Base documentaire et assistant (sprint 9, lot D) : routes, worker, permissions."""
import pytest
from sqlalchemy import select

from app import worker
from app.auth_models import Journal
from app.models import Analysis, Detection, Document, EtatDetection, EtatDocument, Passage, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import indexation, storage
from app.services.vectorisation import VectoriseurFactice

from .conftest import BASE

GUIDE = """# Lésions péri-apicales

Une lésion péri-apicale est une zone radio-claire autour de l'apex de la racine.

# Seuil de confiance

Le seuil de confiance règle le nombre de propositions affichées.
""".encode()


@pytest.fixture(autouse=True)
def objets(monkeypatch):
    """Stockage objet en mémoire. Comme MinIO, il refuse d'écrire tant que le
    bucket n'a pas été créé : sur une pile neuve, un document peut être le
    premier fichier déposé."""
    memoire: dict[str, bytes] = {}
    bucket = {"cree": False}

    def put(cle, donnees, type_):
        if not bucket["cree"]:
            raise RuntimeError("NoSuchBucket")
        memoire[cle] = donnees

    monkeypatch.setattr(storage, "ensure_bucket", lambda: bucket.__setitem__("cree", True))
    monkeypatch.setattr(storage, "put", put)
    monkeypatch.setattr(storage, "get", lambda cle: memoire[cle])
    monkeypatch.setattr(storage, "delete", lambda cle: memoire.pop(cle, None))
    return memoire


def deposer(client, contenu=GUIDE, nom="guide-de-lecture.md", **champs):
    return client.post(f"{BASE}/documents", files={"fichier": (nom, contenu, "application/octet-stream")},
                       data=champs)


def vider_la_file(session_factory):
    """Fait tourner le worker jusqu'à ce que la file soit vide."""
    while worker.traiter_une(session_factory):
        pass


def actions(db, action):
    return db.scalars(select(Journal).where(Journal.action == action)).all()


# --- Dépôt ----------------------------------------------------------------------

def test_depot_en_attente_puis_indexe_par_le_worker(admin, objets, session_factory, db):
    r = deposer(admin)
    assert r.status_code == 201, r.text
    d = r.json()
    assert (d["titre"], d["format"], d["etat"], d["nb_passages"]) == ("guide de lecture", "markdown", "en_attente", 0)
    cle = db.get(Document, d["id"]).cle_stockage
    assert objets[cle] == GUIDE and "guide" not in cle   # clé tirée au hasard, jamais dérivée du nom
    assert actions(db, "document_depose")[0].details["titre"] == "guide de lecture"

    vider_la_file(session_factory)
    liste = admin.get(f"{BASE}/documents").json()
    (doc,) = liste["documents"]
    assert (doc["etat"], doc["nb_passages"], doc["modele_vecteurs"], doc["perime"]) == \
        ("indexe", 2, "factice-hachage-v1", False)
    assert liste["index"]["passages"] == 2 and liste["index"]["par_etat"]["indexe"] == 1
    assert liste["parametres"] == {"passages": 5, "seuil": 0.5}
    db.expire_all()
    assert actions(db, "document_indexe")[0].details == {"titre": "guide de lecture", "passages": 2,
                                                         "modele": "factice-hachage-v1"}


def test_depot_avec_titre(admin):
    assert deposer(admin, titre="  Guide   de lecture ").json()["titre"] == "Guide de lecture"


@pytest.mark.parametrize("nom, contenu, statut, code", [
    ("notes.txt", b"du texte", 415, "format_non_pris_en_charge"),
    ("guide.pdf", b"ceci n'est pas un pdf", 415, "format_non_pris_en_charge"),
    ("guide.md", "Lésion".encode("latin-1"), 415, "format_non_pris_en_charge"),
    ("guide.md", b"texte\x00binaire", 415, "format_non_pris_en_charge"),
    ("guide.md", b"", 422, "fichier_vide"),
])
def test_depot_refuse(admin, objets, nom, contenu, statut, code):
    r = deposer(admin, contenu, nom)
    assert (r.status_code, r.json()["code"]) == (statut, code)
    assert objets == {}


def test_meme_fichier_refuse(admin, objets):
    deposer(admin, titre="Guide")
    r = deposer(admin, nom="copie.md")
    assert r.status_code == 409 and r.json()["message"] == "Ce fichier est déjà dans la base : « Guide »."
    assert len(objets) == 1


def test_echec_d_indexation_visible_avec_son_motif(admin, session_factory):
    deposer(admin, b"# Titre seul\n", "vide.md")
    vider_la_file(session_factory)
    (doc,) = admin.get(f"{BASE}/documents").json()["documents"]
    assert doc["etat"] == "echec" and doc["erreur"] == "Le document ne contient aucun texte exploitable."


# --- Remplacement, réindexation, suppression ----------------------------------

def test_remplacer_le_fichier(admin, objets, session_factory, db):
    d = deposer(admin, titre="Guide").json()
    vider_la_file(session_factory)
    ancienne = db.get(Document, d["id"]).cle_stockage

    nouveau = b"# Guide\n\nVersion revue du guide de lecture."
    r = admin.put(f"{BASE}/documents/{d['id']}/fichier", files={"fichier": ("guide-v2.md", nouveau, "text/markdown")})
    assert r.status_code == 200, r.text
    assert (r.json()["titre"], r.json()["nom_fichier"], r.json()["etat"]) == ("Guide", "guide-v2.md", "en_attente")
    assert ancienne not in objets and nouveau in objets.values()

    vider_la_file(session_factory)
    db.expire_all()
    assert [p.texte for p in db.get(Document, d["id"]).passages] == ["Version revue du guide de lecture."]
    assert actions(db, "document_remplace")[0].details["titre"] == "Guide"


def test_remplacer_par_le_fichier_d_un_autre_document_refuse(admin):
    deposer(admin, titre="Premier")
    autre = deposer(admin, b"# Autre\n\nAutre texte.", "autre.md").json()
    r = admin.put(f"{BASE}/documents/{autre['id']}/fichier", files={"fichier": ("x.md", GUIDE, "text/markdown")})
    assert r.status_code == 409


def test_pas_de_remplacement_pendant_l_indexation(admin, db):
    d = deposer(admin).json()
    db.get(Document, d["id"]).etat = EtatDocument.EN_COURS
    db.commit()
    r = admin.put(f"{BASE}/documents/{d['id']}/fichier", files={"fichier": ("x.md", b"# X\n\ny", "text/markdown")})
    assert (r.status_code, r.json()["code"]) == (409, "indexation_en_cours")


def test_reindexer_un_document(admin, session_factory, db):
    d = deposer(admin).json()
    vider_la_file(session_factory)
    r = admin.post(f"{BASE}/documents/{d['id']}/reindexation")
    assert r.json()["etat"] == "en_attente"
    assert len(actions(db, "document_reindexation")) == 1
    vider_la_file(session_factory)
    assert admin.get(f"{BASE}/documents").json()["documents"][0]["etat"] == "indexe"


def test_reindexer_les_perimes_et_les_echecs(admin, session_factory, db):
    a = deposer(admin, titre="A").json()
    deposer(admin, b"# B\n\nTexte B.", "b.md")
    deposer(admin, b"# C seul\n", "c.md")   # échouera : aucun texte
    vider_la_file(session_factory)
    # A a été indexé par un autre modèle de vectorisation : il est périmé.
    doc = db.get(Document, a["id"])
    doc.modele_vecteurs = "bge-m3"
    db.commit()
    assert [x["perime"] for x in admin.get(f"{BASE}/documents").json()["documents"] if x["titre"] == "A"] == [True]

    assert admin.post(f"{BASE}/documents/reindexation").json() == {"documents": 2}
    etats = {x["titre"]: x["etat"] for x in admin.get(f"{BASE}/documents").json()["documents"]}
    assert etats == {"A": "en_attente", "b": "indexe", "c": "en_attente"}


def test_supprimer_un_document(admin, objets, session_factory, db):
    d = deposer(admin).json()
    vider_la_file(session_factory)
    assert admin.delete(f"{BASE}/documents/{d['id']}").status_code == 204
    db.expire_all()
    assert db.get(Document, d["id"]) is None and db.query(Passage).count() == 0 and objets == {}
    assert actions(db, "document_supprime")[0].details == {"titre": "guide de lecture"}
    assert admin.delete(f"{BASE}/documents/{d['id']}").status_code == 404


# --- Worker ---------------------------------------------------------------------

def test_les_analyses_passent_avant_les_documents(admin, session_factory, db, monkeypatch):
    deposer(admin)
    db.add(Analysis(reference="PDX-2026-0900", image_key="images/a.png", width=10, height=10,
                    statut=StatutAnalyse.EN_FILE))
    db.commit()
    traitees = []
    monkeypatch.setattr(worker, "traiter", lambda s, a: traitees.append(a.reference))
    assert worker.traiter_une(session_factory) and traitees == ["PDX-2026-0900"]
    db.expire_all()
    assert db.scalars(select(Document)).one().etat == EtatDocument.EN_ATTENTE


def test_document_interrompu_repris_au_demarrage(admin, db):
    d = deposer(admin).json()
    db.get(Document, d["id"]).etat = EtatDocument.EN_COURS
    db.commit()
    assert indexation.reprendre_les_documents_interrompus(db) == 1
    assert db.get(Document, d["id"]).etat == EtatDocument.EN_ATTENTE


def test_fichier_disparu_du_stockage(admin, objets, session_factory):
    deposer(admin)
    objets.clear()
    vider_la_file(session_factory)
    doc = admin.get(f"{BASE}/documents").json()["documents"][0]
    assert (doc["etat"], doc["erreur"]) == ("echec", "Le fichier est introuvable dans le stockage.")


# --- Questions ------------------------------------------------------------------

@pytest.fixture()
def base_prete(admin, session_factory):
    d = deposer(admin).json()
    vider_la_file(session_factory)
    # Échelle du vectoriseur factice (hachage des mots) : seuil de 0,2.
    assert admin.put(f"{BASE}/assistant/parametres", json={"passages": 5, "seuil": 0.2}).status_code == 200
    return d


def test_le_praticien_pose_une_question_et_ouvre_la_source(connecte, base_prete, db):
    praticien = connecte("dr.question@cabinet.example.org", PRACTITIONER_ROLE)
    r = praticien.post(f"{BASE}/assistant/questions", json={"question": "Qu'est-ce qu'une lésion péri-apicale ?"})
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["statut"] == "reponse" and corps["texte"].endswith("[1]")
    assert "diagnostic" in corps["avertissement"]
    (source,) = corps["sources"]
    assert (source["titre"], source["section"]) == ("guide de lecture", "Lésions péri-apicales")

    f = praticien.get(f"{BASE}/documents/{source['document_id']}/fichier")
    assert f.status_code == 200 and f.content == GUIDE
    assert f.headers["content-type"].startswith("text/markdown")
    assert f.headers["x-content-type-options"] == "nosniff"


def test_question_hors_documentation(connecte, base_prete):
    praticien = connecte("dr.hors@cabinet.example.org", PRACTITIONER_ROLE)
    r = praticien.post(f"{BASE}/assistant/questions", json={"question": "Comment traiter une fracture du fémur ?"})
    assert r.json()["statut"] == "refus" and r.json()["sources"] == []


def test_question_depuis_une_analyse(admin, base_prete, db):
    a = Analysis(reference="PDX-2026-0901", image_key="images/q.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="v1")
    a.detections = [Detection(label="periapical_lesion", fdi=36, confidence=0.7, x=0.1, y=0.1, w=0.1, h=0.1,
                              model_version="v1", etat=EtatDetection.VALIDEE)]
    db.add(a)
    db.commit()
    r = admin.post(f"{BASE}/assistant/questions",
                   json={"question": "Qu'est-ce qu'une lésion péri-apicale ?", "analyse_id": a.id})
    assert r.json()["statut"] == "reponse"
    assert actions(db, "question_assistant")[-1].cible == f"analyse:{a.id}"
    r = admin.post(f"{BASE}/assistant/questions", json={"question": "Une question ?", "analyse_id": "inconnue"})
    assert r.status_code == 404


def test_question_invalide(admin):
    r = admin.post(f"{BASE}/assistant/questions", json={"question": "  "})
    assert (r.status_code, r.json()["code"]) == (422, "question_invalide")


def test_les_reglages_gouvernent_la_recherche(admin, base_prete, db):
    question = {"question": "Qu'est-ce qu'une lésion péri-apicale ?"}
    assert admin.post(f"{BASE}/assistant/questions", json=question).json()["statut"] == "reponse"
    r = admin.put(f"{BASE}/assistant/parametres", json={"passages": 3, "seuil": 0.99})
    assert r.json()["passages"] == 3 and r.json()["seuil"] == 0.99 and r.json()["maj_par_nom"]
    assert admin.post(f"{BASE}/assistant/questions", json=question).json()["statut"] == "refus"
    entrees = actions(db, "assistant_parametres")
    assert [e.details for e in entrees] == [{"passages": 5, "seuil": 0.2}, {"passages": 3, "seuil": 0.99}]


@pytest.mark.parametrize("corps", [{"passages": 0, "seuil": 0.5}, {"passages": 11, "seuil": 0.5},
                                   {"passages": 5, "seuil": 1.5}, {"passages": 5, "seuil": -0.1}])
def test_reglages_hors_bornes(admin, corps):
    assert admin.put(f"{BASE}/assistant/parametres", json=corps).status_code == 422


# --- Permissions ----------------------------------------------------------------

def test_le_praticien_ne_gere_pas_la_base(connecte, admin):
    d = deposer(admin).json()
    praticien = connecte("dr.base@cabinet.example.org", PRACTITIONER_ROLE)
    for methode, url in [("GET", "/documents"), ("POST", "/documents/reindexation"),
                         ("POST", f"/documents/{d['id']}/reindexation"), ("DELETE", f"/documents/{d['id']}"),
                         ("GET", "/assistant/parametres"), ("PUT", "/assistant/parametres")]:
        r = praticien.request(methode, f"{BASE}{url}", json={"passages": 5, "seuil": 0.5})
        assert r.status_code == 403, (methode, url)
    assert deposer(praticien, b"# X\n\ny", "x.md").status_code == 403


def test_le_lecteur_ne_pose_pas_de_question_ni_n_ouvre_les_sources(connecte, admin):
    d = deposer(admin).json()
    lecteur = connecte("lecteur.doc@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.post(f"{BASE}/assistant/questions", json={"question": "Une question ?"}).status_code == 403
    assert lecteur.get(f"{BASE}/documents/{d['id']}/fichier").status_code == 403


def test_sans_session(client):
    assert client.post(f"{BASE}/assistant/questions", json={"question": "Une question ?"}).status_code == 401
    assert client.get(f"{BASE}/documents").status_code == 401
