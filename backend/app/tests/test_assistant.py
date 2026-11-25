"""Assistant documentaire (sprint 9, lot C) : recherche, réponse sourcée, refus,
contexte anonyme et journal."""
import json

import httpx
import pytest
from sqlalchemy import select

from app.auth_models import Journal, Utilisateur
from app.errors import ApiError
from app.models import Analysis, Detection, Document, EtatDetection, StatutAnalyse
from app.services import assistant, journal_audit, redaction
from app.services.assistant import (
    ECHEC_SANS_SOURCE, REFUS_BASE_VIDE, REFUS_HORS_DOCUMENTATION, contexte_analyse, poser_question, repondre,
)
from app.services.indexation import empreinte, indexer
from app.services.recherche import rechercher
from app.services.redaction import (
    CONSIGNES, Extrait, RedacteurFactice, RedacteurOllama, RedactionImpossible, verifier,
)
from app.services.vectorisation import VectorisationImpossible, VectoriseurFactice

SEUIL = 0.2  # échelle du vectoriseur factice (hachage des mots)

GUIDE = """# Lésions péri-apicales

Une lésion péri-apicale est une zone radio-claire autour de l'apex de la racine. Elle accompagne souvent une \
atteinte de la pulpe ; l'examen clinique permet de conclure.

# Seuil de confiance

Le seuil de confiance règle le nombre de propositions affichées. Abaisser le seuil réduit les oublis mais \
augmente les fausses alertes.

# Carie profonde

La carie profonde est une atteinte qui s'étend vers la pulpe.
""".encode()


@pytest.fixture()
def base(db):
    doc = Document(titre="Guide de lecture", nom_fichier="guide.md", format="markdown",
                   cle_stockage="documents/guide", empreinte=empreinte(GUIDE), taille=len(GUIDE))
    db.add(doc)
    indexer(db, doc, GUIDE, VectoriseurFactice())
    db.commit()
    return doc


def _question(db, texte, **kw):
    kw.setdefault("vectoriseur", VectoriseurFactice())
    kw.setdefault("redacteur", RedacteurFactice())
    kw.setdefault("seuil", SEUIL)
    return repondre(db, texte, **kw)


class _Redacteur:
    """Rédacteur de test : renvoie un texte fixé, et garde ce qu'il a reçu."""
    nom = "test"

    def __init__(self, texte):
        self.texte, self.recu = texte, None

    def rediger(self, question, extraits, contexte):
        self.recu = (question, extraits, contexte)
        return self.texte


# --- Recherche ------------------------------------------------------------------

def test_recherche_classe_par_similarite_et_respecte_le_seuil(db, base):
    v = VectoriseurFactice()
    q = v.vectoriser(["Qu'est-ce qu'une lésion péri-apicale ?"])[0]
    trouves = rechercher(db, q, modele=v.nom, nombre=5, seuil=SEUIL)
    assert trouves[0].passage.section == "Lésions péri-apicales"
    assert all(t.score >= SEUIL for t in trouves)
    assert [t.score for t in trouves] == sorted((t.score for t in trouves), reverse=True)


def test_seuil_abaisse_ramene_davantage_de_passages(db, base):
    v = VectoriseurFactice()
    q = v.vectoriser(["La pulpe et la lésion péri-apicale"])[0]
    strict = rechercher(db, q, modele=v.nom, nombre=5, seuil=0.3)
    large = rechercher(db, q, modele=v.nom, nombre=5, seuil=0.0)
    assert len(large) > len(strict) >= 1


def test_nombre_de_passages_borne(db, base):
    v = VectoriseurFactice()
    q = v.vectoriser(["pulpe"])[0]
    assert len(rechercher(db, q, modele=v.nom, nombre=1, seuil=-1)) == 1


def test_passages_d_un_autre_modele_jamais_compares(db, base):
    v = VectoriseurFactice()
    q = v.vectoriser(["lésion péri-apicale"])[0]
    assert rechercher(db, q, modele="bge-m3", nombre=5, seuil=-1) == []


# --- Réponse --------------------------------------------------------------------

def test_question_couverte_reponse_sourcee(db, base):
    r = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?")
    assert r.statut == "reponse"
    assert r.texte.endswith("[1]") and "zone radio-claire" in r.texte
    (source,) = r.sources
    assert source["numero"] == 1 and source["titre"] == "Guide de lecture"
    assert source["section"] == "Lésions péri-apicales" and source["page"] is None
    assert "zone radio-claire" in source["extrait"]


def test_question_hors_documentation_refus_sans_appel_au_modele(db, base):
    redacteur = _Redacteur("Lima [1]")
    r = _question(db, "Comment traiter une fracture du fémur ?", redacteur=redacteur)
    assert (r.statut, r.texte, r.sources) == ("refus", REFUS_HORS_DOCUMENTATION, [])
    assert redacteur.recu is None  # rien n'est inventé : le modèle n'est même pas sollicité


def test_base_vide_ou_perimee_refus(db):
    assert _question(db, "Qu'est-ce qu'une lésion péri-apicale ?").texte == REFUS_BASE_VIDE


def test_le_modele_qui_ne_sait_pas_donne_un_refus(db, base):
    r = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?", redacteur=_Redacteur("JE NE SAIS PAS"))
    assert (r.statut, r.texte) == ("refus", REFUS_HORS_DOCUMENTATION)


@pytest.mark.parametrize("texte, motif", [
    ("Une lésion péri-apicale est une zone sombre.", "réponse sans source"),
    ("Une zone radio-claire [1].\nElle se traite par antibiotiques.", "affirmation sans source"),
    ("Une zone radio-claire [7].", "citation d'un passage inexistant"),
])
def test_reponse_sans_source_valide_est_un_echec_non_affiche(db, base, texte, motif):
    r = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?", redacteur=_Redacteur(texte))
    assert (r.statut, r.texte, r.motif, r.sources) == ("echec", ECHEC_SANS_SOURCE, motif, [])


def test_seules_les_sources_citees_sont_renvoyees(db, base):
    r = _question(db, "La pulpe, la lésion péri-apicale et la carie profonde",
                  redacteur=_Redacteur("Première affirmation [2]. Seconde [2][1]."), seuil=0.0)
    assert r.statut == "reponse" and [s["numero"] for s in r.sources] == [1, 2]


def test_service_indisponible_echec_explicite(db, base):
    class Panne:
        nom = "factice-hachage-v1"

        def vectoriser(self, textes):
            raise VectorisationImpossible("Le service de vectorisation (Ollama) ne répond pas.")

    r = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?", vectoriseur=Panne())
    assert r.statut == "echec" and "ne répond pas" in r.texte

    class Muet:
        nom = "x"

        def rediger(self, *a):
            raise RedactionImpossible("le modèle de langage (Ollama) ne répond pas")

    r = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?", redacteur=Muet())
    assert r.statut == "echec" and r.texte == "L'assistant est indisponible : le modèle de langage (Ollama) ne répond pas."


def test_verifier():
    assert verifier("", 2).statut == "refus"
    assert verifier("Je ne sais pas.", 2).statut == "refus"
    assert verifier("A [1]. B [2].", 2).citees == (1, 2)
    assert verifier("Voici ce que dit la documentation :\nA [1].", 1).statut == "reponse"


# --- Contexte anonyme -----------------------------------------------------------

def _analyse(db) -> Analysis:
    praticien = db.scalars(select(Utilisateur)).first()
    praticien.nom, praticien.prenom = "Rakotobe", "Hanta"
    a = Analysis(reference="PDX-2026-0777", image_key="images/secret-patient.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="dentex-2026.11", inference_mode="real",
                 note="Mme Rasoa, contrôle annuel", conclusion="Conclusion confidentielle du praticien",
                 utilisateur_id=praticien.id)
    dent = Detection(label="tooth", fdi=36, confidence=0.99, x=0.1, y=0.1, w=0.2, h=0.2, model_version="v")
    a.detections = [
        dent,
        Detection(label="periapical_lesion", fdi=36, confidence=0.58, x=0.1, y=0.2, w=0.05, h=0.05,
                  model_version="v", etat=EtatDetection.VALIDEE),
        Detection(label="caries", fdi=17, confidence=0.91, x=0.5, y=0.1, w=0.05, h=0.05,
                  model_version="v", etat=EtatDetection.REJETEE),
        Detection(label="deep_caries", fdi=46, confidence=None, x=0.6, y=0.6, w=0.05, h=0.05,
                  model_version="v", source="praticien", etat=EtatDetection.VALIDEE),
    ]
    db.add(a)
    db.commit()
    return a


def test_contexte_anonyme_par_construction(db):
    contexte = contexte_analyse(_analyse(db))
    assert set(contexte) == {"modele", "anomalies"}
    assert contexte["modele"] == "dentex-2026.11"
    # Ni dent, ni détection rejetée : les seules anomalies retenues.
    assert contexte["anomalies"] == [
        {"type": "lésion péri-apicale", "dent": 36, "confiance": 58, "origine": "proposée par le modèle"},
        {"type": "carie profonde", "dent": 46, "confiance": None, "origine": "ajoutée par le praticien"},
    ]


def test_charge_envoyee_a_ollama_sans_donnee_identifiante(db, base, monkeypatch):
    a = _analyse(db)
    envoyes = []

    def faux_post(url, json, timeout):
        envoyes.append((url, json))
        return httpx.Response(200, json={"message": {"content": "Zone radio-claire autour de l'apex [1]."}})

    monkeypatch.setattr(redaction.httpx, "post", faux_post)
    r = _question(db, "Que signifie la lésion sur la 36 ?", analyse=a,
                  redacteur=RedacteurOllama("http://ollama:11434", "qwen2.5:3b"), seuil=0.0)
    assert r.statut == "reponse"

    (url, charge), = envoyes
    assert url == "http://ollama:11434/api/chat"
    # Champ par champ : rien d'autre que le modèle, les deux messages et les options.
    assert set(charge) == {"model", "messages", "stream", "options"}
    assert charge["model"] == "qwen2.5:3b" and charge["stream"] is False
    assert [m["role"] for m in charge["messages"]] == ["system", "user"]
    assert charge["messages"][0]["content"] == CONSIGNES
    texte = json.dumps(charge, ensure_ascii=False)
    praticien = db.get(Utilisateur, a.utilisateur_id)
    for secret in (a.reference, a.id, a.image_key, "Rasoa", "Conclusion confidentielle", praticien.email,
                   praticien.nom, praticien.prenom, str(a.created_at.date())):
        assert not secret or secret not in texte, secret
    # Ce qui y figure : les anomalies retenues, la version du modèle, la question.
    assert "lésion péri-apicale (dent 36, confiance 58 %, proposée par le modèle)" in texte
    assert "dentex-2026.11" in texte and "Question : Que signifie la lésion sur la 36 ?" in texte


def test_passages_remis_au_modele_numerotes_avec_leur_provenance():
    message = redaction.message("Q ?", [Extrait(1, "Guide", "Seuils", 3, "Texte.")], None)
    assert "[1] (Guide — Seuils — page 3)\nTexte." in message
    assert "Contexte" not in message


# --- Question posée et journal --------------------------------------------------

def test_question_journalisee_avec_reponse_et_sources(db, base):
    a = _analyse(db)
    admin = db.scalars(select(Utilisateur)).first()
    r = poser_question(db, "  Qu'est-ce qu'une   lésion péri-apicale ? ", utilisateur_id=admin.id, analyse=a,
                       vectoriseur=VectoriseurFactice(), redacteur=RedacteurFactice(), seuil=SEUIL)
    assert r.statut == "reponse"
    entree = db.scalars(select(Journal).where(Journal.action == "question_assistant")).one()
    assert entree.resultat == "succes" and entree.cible == f"analyse:{a.id}"
    assert entree.details["question"] == "Qu'est-ce qu'une lésion péri-apicale ?"
    assert entree.details["statut"] == "reponse" and entree.details["reponse"] == r.texte
    assert entree.details["sources"] == [{"numero": 1, "document_id": base.id, "titre": "Guide de lecture",
                                          "section": "Lésions péri-apicales", "page": None,
                                          "passage_id": r.sources[0]["passage_id"]}]
    assert journal_audit._precision("question_assistant", entree.details) == \
        "« Qu'est-ce qu'une lésion péri-apicale ? » · réponse · 1 source"


def test_refus_et_echec_journalises(db, base):
    admin = db.scalars(select(Utilisateur)).first()
    poser_question(db, "Comment traiter une fracture du fémur ?", utilisateur_id=admin.id,
                   vectoriseur=VectoriseurFactice(), redacteur=RedacteurFactice(), seuil=SEUIL)
    poser_question(db, "Qu'est-ce qu'une lésion péri-apicale ?", utilisateur_id=admin.id,
                   vectoriseur=VectoriseurFactice(), redacteur=_Redacteur("Sans source."), seuil=SEUIL)
    refus, echec = db.scalars(select(Journal).where(Journal.action == "question_assistant")
                              .order_by(Journal.horodatage)).all()
    assert (refus.resultat, refus.details["statut"], refus.cible) == ("succes", "refus", None)
    assert (echec.resultat, echec.details["statut"], echec.details["motif"]) == ("echec", "echec", "réponse sans source")


@pytest.mark.parametrize("question", ["", "  a ", "x" * 1001])
def test_question_hors_bornes_refusee(db, question):
    with pytest.raises(ApiError) as e:
        poser_question(db, question, utilisateur_id=None)
    assert e.value.status == 422 and e.value.code == "question_invalide"


def test_avertissement_toujours_joint(db, base):
    corps = _question(db, "Qu'est-ce qu'une lésion péri-apicale ?").en_json()
    assert corps["avertissement"] == assistant.AVERTISSEMENT and "diagnostic" in corps["avertissement"]
