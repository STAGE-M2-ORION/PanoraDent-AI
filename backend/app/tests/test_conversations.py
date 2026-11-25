"""Fil de l'assistant par analyse et par auteur (sprint 10, lot A)."""
import pytest
from sqlalchemy import select

from app.auth_models import Journal
from app.models import Analysis, Conversation, Detection, Document, EtatDetection, Message, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import assistant, conversations
from app.services.assistant import ECHEC_SANS_SOURCE, REFUS_HORS_DOCUMENTATION
from app.services.indexation import empreinte, indexer
from app.services.vectorisation import VectoriseurFactice

from .conftest import BASE

GUIDE = """# Lésions péri-apicales

Une lésion péri-apicale est une zone radio-claire autour de l'apex de la racine.

# Indice de confiance

L'indice de confiance exprime la certitude du modèle sur sa proposition.
""".encode()

QUESTION = "Qu'est-ce qu'une lésion péri-apicale ?"


@pytest.fixture()
def analyse(db):
    doc = Document(titre="Guide", nom_fichier="guide.md", format="markdown", cle_stockage="documents/g",
                   empreinte=empreinte(GUIDE), taille=len(GUIDE))
    db.add(doc)
    indexer(db, doc, GUIDE, VectoriseurFactice())
    assistant.parametres(db).seuil = 0.2   # échelle du vectoriseur factice
    a = Analysis(reference="PDX-2026-1000", image_key="images/c.png", width=10, height=10,
                 statut=StatutAnalyse.TERMINEE, model_version="v1")
    a.detections = [
        Detection(label="tooth", fdi=36, confidence=0.99, x=0.1, y=0.1, w=0.2, h=0.2, model_version="v1"),
        Detection(label="periapical_lesion", fdi=36, confidence=0.58, x=0.1, y=0.2, w=0.05, h=0.05,
                  model_version="v1", etat=EtatDetection.VALIDEE),
        Detection(label="deep_caries", fdi=46, confidence=None, x=0.6, y=0.6, w=0.05, h=0.05,
                  model_version="v1", source="praticien", etat=EtatDetection.VALIDEE),
        Detection(label="caries", fdi=17, confidence=0.9, x=0.5, y=0.1, w=0.05, h=0.05,
                  model_version="v1", etat=EtatDetection.REJETEE),
    ]
    db.add(a)
    db.commit()
    return a


def url(a, suite=""):
    return f"{BASE}/analyses/{a.id}/conversation{suite}"


def poser(client, a, question=QUESTION):
    return client.post(url(a, "/messages"), json={"question": question})


def test_fil_vide_avec_suggestions_tirees_des_anomalies_retenues(connecte, analyse):
    praticien = connecte("dr.fil@cabinet.example.org", PRACTITIONER_ROLE)
    r = praticien.get(url(analyse))
    assert r.status_code == 200
    corps = r.json()
    assert corps["messages"] == [] and corps["lecture_seule"] is False
    assert "diagnostic" in corps["avertissement"]
    # La carie rejetée n'inspire aucune suggestion ; la lésion la plus sûre, avec sa dent, vient en tête.
    assert corps["suggestions"] == [
        "Comment lire la lésion péri-apicale signalée sur la dent 36 ?",
        "Que signifie une lésion péri-apicale sur une panoramique ?",
        "Que signifie une carie profonde sur une panoramique ?",
        "Comment interpréter l’indice de confiance ?",
    ]


def test_suggestions_sans_anomalie():
    a = Analysis(reference="PDX-X", image_key="k", width=1, height=1, model_version="v1")
    a.detections = []
    assert conversations.suggestions(a) == ["Comment lire une radiographie panoramique ?",
                                            "Comment interpréter l’indice de confiance ?"]


def test_le_fil_garde_questions_et_reponses_et_se_reprend_intact(connecte, nouveau_client, analyse):
    praticien = connecte("dr.reprise@cabinet.example.org", PRACTITIONER_ROLE)
    r = poser(praticien, analyse)
    assert r.status_code == 201, r.text
    assert r.json()["question"]["texte"] == QUESTION
    assert r.json()["reponse"]["statut"] == "reponse" and r.json()["reponse"]["sources"][0]["titre"] == "Guide"
    assert poser(praticien, analyse, "Comment interpréter l'indice de confiance ?").status_code == 201

    fil = praticien.get(url(analyse)).json()["messages"]
    assert [(m["role"], m["statut"]) for m in fil] == [
        ("question", None), ("reponse", "reponse"), ("question", None), ("reponse", "reponse")]
    assert fil[1]["texte"].endswith("[1]") and fil[1]["sources"][0]["section"] == "Lésions péri-apicales"

    # Rechargement de la page : même fil, intact.
    assert praticien.get(url(analyse)).json()["messages"] == fil


def test_chacun_son_fil(connecte, analyse, db):
    premier = connecte("dr.premier@cabinet.example.org", PRACTITIONER_ROLE)
    second = connecte("dr.second@cabinet.example.org", PRACTITIONER_ROLE)
    poser(premier, analyse)
    assert second.get(url(analyse)).json()["messages"] == []
    poser(second, analyse, "Comment interpréter l'indice de confiance ?")
    assert len(premier.get(url(analyse)).json()["messages"]) == 2
    assert db.query(Conversation).count() == 2


def test_refus_enregistre_comme_tel(connecte, analyse):
    praticien = connecte("dr.refus@cabinet.example.org", PRACTITIONER_ROLE)
    r = poser(praticien, analyse, "Comment traiter une fracture du fémur ?").json()["reponse"]
    assert (r["statut"], r["texte"], r["sources"]) == ("refus", REFUS_HORS_DOCUMENTATION, [])


def test_une_reponse_non_sourcee_n_entre_jamais_dans_le_fil(connecte, analyse, db, monkeypatch):
    class SansSource:
        nom = "test"

        def rediger(self, question, extraits, contexte):
            return "La lésion se traite par antibiotiques."

    monkeypatch.setattr(assistant, "redacteur_courant", SansSource)
    praticien = connecte("dr.sanssource@cabinet.example.org", PRACTITIONER_ROLE)
    r = poser(praticien, analyse).json()["reponse"]
    assert (r["statut"], r["texte"]) == ("echec", ECHEC_SANS_SOURCE)
    textes = [m.texte for m in db.scalars(select(Message)).all()]
    assert not any("antibiotiques" in t for t in textes)


def test_question_invalide_rien_d_enregistre(connecte, analyse, db):
    praticien = connecte("dr.invalide@cabinet.example.org", PRACTITIONER_ROLE)
    r = poser(praticien, analyse, " a ")
    assert (r.status_code, r.json()["code"]) == (422, "question_invalide")
    assert db.query(Message).count() == 0


def test_effacer_son_fil_journalise_sans_toucher_aux_autres(connecte, analyse, db):
    premier = connecte("dr.efface@cabinet.example.org", PRACTITIONER_ROLE)
    second = connecte("dr.garde@cabinet.example.org", PRACTITIONER_ROLE)
    poser(premier, analyse)
    poser(premier, analyse, "Comment interpréter l'indice de confiance ?")
    poser(second, analyse)
    assert premier.delete(url(analyse)).status_code == 204
    assert premier.get(url(analyse)).json()["messages"] == []
    assert len(second.get(url(analyse)).json()["messages"]) == 2
    (entree,) = db.scalars(select(Journal).where(Journal.action == "conversation_effacee")).all()
    assert entree.details == {"messages": 4, "reference": "PDX-2026-1000"}
    assert entree.cible == f"analyse:{analyse.id}"
    # Effacer un fil vide : rien à journaliser.
    assert premier.delete(url(analyse)).status_code == 204
    assert db.query(Journal).filter(Journal.action == "conversation_effacee").count() == 1


def test_apres_cloture_le_fil_se_lit_mais_ne_s_ecrit_plus(connecte, analyse, db):
    praticien = connecte("dr.cloture@cabinet.example.org", PRACTITIONER_ROLE)
    poser(praticien, analyse)
    a = db.get(Analysis, analyse.id)
    a.statut = StatutAnalyse.TERMINEE
    a.cloturee_le = a.created_at
    db.commit()
    corps = praticien.get(url(analyse)).json()
    assert corps["lecture_seule"] is True and len(corps["messages"]) == 2
    for r in (poser(praticien, analyse), praticien.delete(url(analyse))):
        assert (r.status_code, r.json()["code"]) == (409, "analyse_cloturee")
    assert db.query(Message).count() == 2


def test_supprimer_l_analyse_supprime_ses_fils(connecte, analyse, db):
    praticien = connecte("dr.suppr@cabinet.example.org", PRACTITIONER_ROLE)
    poser(praticien, analyse)
    db.delete(db.get(Analysis, analyse.id))
    db.commit()
    assert db.query(Conversation).count() == 0 and db.query(Message).count() == 0


def test_acces(connecte, nouveau_client, analyse):
    lecteur = connecte("lecteur.fil@cabinet.example.org", VIEWER_ROLE)
    assert lecteur.get(url(analyse)).status_code == 403
    assert nouveau_client().get(url(analyse)).status_code == 401
    praticien = connecte("dr.inconnue@cabinet.example.org", PRACTITIONER_ROLE)
    assert praticien.get(f"{BASE}/analyses/inconnue/conversation").status_code == 404
