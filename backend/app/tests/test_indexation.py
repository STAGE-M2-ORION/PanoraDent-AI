"""Ingestion de la base documentaire (sprint 9, lot B) : extraction, découpage,
vectorisation et indexation d'un document seul."""
import io

import httpx
import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.config import Settings
from app.models import Document, EtatDocument, Passage
from app.services import vectorisation
from app.services.decoupage import RECOUVREMENT, TAILLE, decouper, decouper_texte
from app.services.extraction_texte import Bloc, ExtractionImpossible, extraire
from app.services.indexation import empreinte, etat_index, indexer, perime
from app.services.vectorisation import (
    VectorisationImpossible, VectoriseurFactice, VectoriseurOllama,
)
from app.vecteurs import DIMENSION

MARKDOWN = """# Lésions péri-apicales

Une lésion péri-apicale est une **zone radio-claire** autour de l'apex.

## Signes radiologiques

Contours variables ; voir [la fiche 12](https://exemple.org/fiche12).

```
# ceci n'est pas un titre
```

## Diagnostic différentiel

L'image seule ne permet pas de conclure.

# Indice de confiance

Le score exprime la certitude du modèle.
""".encode()


def _pdf(pages: list[str], signets: list[tuple[str, int, int]] = ()) -> bytes:
    """PDF de test : une page par texte ; signets (titre, page 1-based, niveau)."""
    tampon = io.BytesIO()
    c = canvas.Canvas(tampon, pagesize=A4, invariant=1)
    for numero, texte in enumerate(pages, start=1):
        c.bookmarkPage(f"p{numero}")
        for titre, page, niveau in signets:
            if page == numero:
                c.addOutlineEntry(titre, f"p{numero}", level=niveau)
        y = 800
        for ligne in texte.split("\n"):
            c.drawString(60, y, ligne)
            y -= 16
        c.showPage()
    c.save()
    return tampon.getvalue()


# --- Extraction -----------------------------------------------------------------

def test_markdown_sections_en_chemin_et_balisage_retire():
    blocs = extraire(MARKDOWN, "markdown")
    sections = [b.section for b in blocs]
    assert sections == [
        "Lésions péri-apicales",
        "Lésions péri-apicales › Signes radiologiques",
        "Lésions péri-apicales › Diagnostic différentiel",
        "Indice de confiance",
    ]
    assert "zone radio-claire" in blocs[0].texte and "**" not in blocs[0].texte
    assert "la fiche 12" in blocs[1].texte and "https://" not in blocs[1].texte
    # Un « # » dans un bloc de code n'ouvre pas de section.
    assert "ceci n'est pas un titre" in blocs[1].texte
    assert all(b.page is None for b in blocs)


def test_markdown_mal_encode_refuse():
    with pytest.raises(ExtractionImpossible, match="UTF-8"):
        extraire("é".encode("latin-1") * 10, "markdown")


def test_markdown_vide_refuse():
    with pytest.raises(ExtractionImpossible, match="aucun texte"):
        extraire(b"# Titre seul\n\n## Autre titre\n", "markdown")


def test_pdf_une_page_par_bloc_et_section_du_sommaire():
    contenu = _pdf(
        ["Lire une panoramique.\nExamen de premiere intention.", "Les caries apparaissent sombres.",
         "Suite des caries."],
        signets=[("Chapitre 1", 1, 0), ("Caries", 2, 1)],
    )
    blocs = extraire(contenu, "pdf")
    assert [b.page for b in blocs] == [1, 2, 3]
    assert blocs[0].section == "Chapitre 1"
    assert blocs[1].section == "Chapitre 1 › Caries"
    assert blocs[2].section == "Chapitre 1 › Caries"  # la section court jusqu'au signet suivant
    assert "Examen de premiere intention" in blocs[0].texte


def test_pdf_sans_sommaire_sans_section():
    blocs = extraire(_pdf(["Un texte."]), "pdf")
    assert blocs == [Bloc("Un texte.", section=None, page=1)]


def test_pdf_sans_texte_refuse():
    with pytest.raises(ExtractionImpossible, match="scanné"):
        extraire(_pdf([""]), "pdf")


def test_pdf_illisible_refuse():
    with pytest.raises(ExtractionImpossible, match="illisible"):
        extraire(b"%PDF-1.4 ceci n'est pas un pdf", "pdf")


# --- Découpage ------------------------------------------------------------------

TEXTE_LONG = " ".join(
    f"La phrase numéro {i} décrit une observation radiologique particulière." for i in range(60))


def test_texte_court_un_seul_passage():
    assert decouper_texte("Un texte court.") == ["Un texte court."]
    assert decouper_texte("   ") == []


def test_texte_long_passages_bornes_recouvrants_et_complets():
    passages = decouper_texte(TEXTE_LONG)
    assert len(passages) > 3
    assert all(len(p) <= TAILLE for p in passages)
    for avant, apres in zip(passages, passages[1:]):
        # Le passage suivant reprend la fin du précédent (recouvrement).
        assert apres[:30] in avant
        # Jamais de coupe au milieu d'un mot.
        assert TEXTE_LONG.find(apres) == 0 or TEXTE_LONG[TEXTE_LONG.find(apres) - 1] == " "
    # Tout le texte est couvert : chaque phrase figure dans au moins un passage.
    for i in range(60):
        assert any(f"numéro {i} " in p for p in passages)
    # Coupe de préférence en fin de phrase.
    assert sum(p.endswith(".") for p in passages) >= len(passages) - 1


def test_recouvrement_borne():
    passages = decouper_texte(TEXTE_LONG)
    for avant, apres in zip(passages, passages[1:]):
        commun = next(n for n in range(len(apres), 0, -1) if avant.endswith(apres[:n]))
        assert commun <= RECOUVREMENT + 1


def test_un_passage_ne_deborde_pas_de_son_bloc():
    morceaux = decouper([Bloc("Texte de la page un.", "A", 1), Bloc("Texte de la page deux.", "B", 2)])
    assert [(m.texte, m.section, m.page) for m in morceaux] == [
        ("Texte de la page un.", "A", 1), ("Texte de la page deux.", "B", 2)]
    assert morceaux[0].a_vectoriser() == "A\nTexte de la page un."


def test_decoupage_deterministe():
    assert decouper_texte(TEXTE_LONG) == decouper_texte(TEXTE_LONG)


# --- Vectorisation --------------------------------------------------------------

def _cosinus(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_vectoriseur_factice_norme_deterministe_et_lexical():
    v = VectoriseurFactice()
    lpa, lpa2, conf = v.vectoriser([
        "Une lésion péri-apicale apparaît radio-claire autour de l'apex.",
        "Lesion peri-apicale : zone radio-claire à l'apex de la racine.",
        "Le seuil de confiance règle le nombre de propositions affichées.",
    ])
    assert len(lpa) == DIMENSION
    assert abs(_cosinus(lpa, lpa) - 1) < 1e-9
    assert v.vectoriser(["Une lésion péri-apicale apparaît radio-claire autour de l'apex."])[0] == lpa
    assert _cosinus(lpa, lpa2) > _cosinus(lpa, conf)


class _Ollama:
    """Remplace `httpx.post` : enregistre les appels, répond comme Ollama."""

    def __init__(self, statut=200, dimension=DIMENSION, erreur=None):
        self.appels, self.statut, self.dimension, self.erreur = [], statut, dimension, erreur

    def __call__(self, url, json, timeout):
        self.appels.append((url, json))
        if self.erreur:
            raise self.erreur
        corps = {"embeddings": [[1.0] + [0.0] * (self.dimension - 1) for _ in json["input"]]}
        return httpx.Response(self.statut, json=corps if self.statut == 200 else {"error": "x"})


def test_ollama_par_lots_et_vecteurs_normes(monkeypatch):
    faux = _Ollama()
    monkeypatch.setattr(vectorisation.httpx, "post", faux)
    vecteurs = VectoriseurOllama("http://ollama:11434/", "bge-m3").vectoriser([f"t{i}" for i in range(20)])
    assert len(vecteurs) == 20
    assert [len(j["input"]) for _, j in faux.appels] == [16, 4]
    assert faux.appels[0] == ("http://ollama:11434/api/embed", {"model": "bge-m3", "input": [f"t{i}" for i in range(16)]})


@pytest.mark.parametrize("faux, motif", [
    (_Ollama(erreur=httpx.ConnectError("refus")), "ne répond pas"),
    (_Ollama(statut=404), "ollama pull bge-m3"),
    (_Ollama(statut=500), "HTTP 500"),
    (_Ollama(dimension=768), "dimension 768"),
])
def test_ollama_en_echec_motif_explicite(monkeypatch, faux, motif):
    monkeypatch.setattr(vectorisation.httpx, "post", faux)
    with pytest.raises(VectorisationImpossible, match=motif):
        VectoriseurOllama("http://ollama:11434", "bge-m3").vectoriser(["texte"])


def test_vectoriseur_factice_refuse_en_production():
    with pytest.raises(ValueError, match="ASSISTANT_FOURNISSEUR=factice"):
        Settings(app_env="production", identity_provider="google", assistant_fournisseur="factice",
                 courriel_mode="smtp", bcrypt_cout=12,
                 smtp_hote="smtp.example.org", jwt_secret="x" * 40, google_client_id="id",
                 google_client_secret="secret")
    with pytest.raises(ValueError, match="inconnu"):
        Settings(assistant_fournisseur="openai")


# --- Indexation -----------------------------------------------------------------

def _document(db, contenu: bytes, format="markdown", titre="Guide") -> Document:
    doc = Document(titre=titre, nom_fichier=f"{titre}.{'md' if format == 'markdown' else 'pdf'}",
                   format=format, cle_stockage=f"documents/{titre}", empreinte=empreinte(contenu),
                   taille=len(contenu))
    db.add(doc)
    db.flush()
    return doc


class _VectoriseurEnPanne:
    nom = "bge-m3"

    def vectoriser(self, textes):
        raise VectorisationImpossible("Le service de vectorisation (Ollama) ne répond pas.")


def test_indexer_un_document(db):
    doc = indexer(db, _document(db, MARKDOWN), MARKDOWN, VectoriseurFactice())
    db.commit()
    assert doc.etat == EtatDocument.INDEXE and doc.erreur is None
    assert doc.nb_passages == 4 == len(doc.passages)
    assert doc.modele_vecteurs == "factice-hachage-v1" and doc.indexe_le is not None
    p = doc.passages[1]
    assert p.section == "Lésions péri-apicales › Signes radiologiques"
    assert p.modele == "factice-hachage-v1" and len(p.vecteur) == DIMENSION


def test_indexer_un_pdf_garde_les_pages(db):
    contenu = _pdf(["Page un du guide.", "Page deux du guide."], signets=[("Guide", 1, 0)])
    doc = indexer(db, _document(db, contenu, "pdf"), contenu, VectoriseurFactice())
    assert [(p.page, p.section) for p in doc.passages] == [(1, "Guide"), (2, "Guide")]


def test_reindexer_un_document_laisse_les_autres_intacts(db):
    autre = indexer(db, _document(db, MARKDOWN, titre="Autre"), MARKDOWN, VectoriseurFactice())
    db.commit()
    avant = [(p.id, p.texte) for p in autre.passages]

    contenu = b"# Seuils\n\nAbaisser le seuil montre plus de propositions."
    doc = indexer(db, _document(db, contenu), contenu, VectoriseurFactice())
    db.commit()
    nouveau = b"# Seuils\n\nVersion revue.\n\n# Annexe\n\nUn second passage."
    indexer(db, doc, nouveau, VectoriseurFactice())
    db.commit()
    db.expire_all()

    assert [p.texte for p in db.get(Document, doc.id).passages] == ["Version revue.", "Un second passage."]
    assert [(p.id, p.texte) for p in db.get(Document, autre.id).passages] == avant
    assert db.query(Passage).count() == 6


def test_echec_garde_les_passages_precedents_et_le_motif(db):
    doc = indexer(db, _document(db, MARKDOWN), MARKDOWN, VectoriseurFactice())
    db.commit()
    indexer(db, doc, MARKDOWN, _VectoriseurEnPanne())
    db.commit()
    assert doc.etat == EtatDocument.ECHEC
    assert doc.erreur == "Le service de vectorisation (Ollama) ne répond pas."
    assert len(doc.passages) == 4


def test_document_sans_texte_en_echec(db):
    contenu = _pdf([""])
    doc = indexer(db, _document(db, contenu, "pdf"), contenu, VectoriseurFactice())
    assert doc.etat == EtatDocument.ECHEC and "OCR" in doc.erreur and doc.passages == []


def test_changement_de_modele_detecte_et_signale(db):
    doc = indexer(db, _document(db, MARKDOWN), MARKDOWN, VectoriseurFactice())
    db.add(Passage(document_id=doc.id, rang=99, texte="sans vecteur"))
    db.commit()

    a_jour = etat_index(db, "factice-hachage-v1")
    assert a_jour["documents_perimes"] == 0 and a_jour["passages_perimes"] == 1
    assert a_jour["par_etat"] == {"en_attente": 0, "en_cours": 0, "indexe": 1, "echec": 0}
    assert not perime(doc, "factice-hachage-v1")

    # Le modèle de vectorisation change : tout l'index est signalé périmé.
    change = etat_index(db, "bge-m3")
    assert change["documents_perimes"] == 1 and change["passages_perimes"] == 5
    assert perime(doc, "bge-m3")
