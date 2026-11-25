"""Extraction du texte des documents de référence (sprint 9).

Un document devient une suite de blocs : du texte, le titre de la section qui
le porte et, pour un PDF, la page. Ce sont eux qui rendent une citation utile :
le lecteur peut aller vérifier dans le document, à la bonne page.

- Markdown : les titres (`#` à `######`) délimitent les sections ; la section
  d'un bloc est le chemin de ses titres (« Lésions › Signes radiologiques »).
  Les titres à l'intérieur d'un bloc de code ne comptent pas.
- PDF : une page par bloc ; la section vient du sommaire (signets) du PDF
  quand il en a un. Un PDF sans texte (cliché scanné) est refusé : l'OCR
  n'est pas pris en charge.
"""
import io
import re
from dataclasses import dataclass

FORMATS = ("pdf", "markdown")
SEPARATEUR_SECTIONS = " › "


class ExtractionImpossible(Exception):
    """Le document ne donne aucun texte exploitable ; le message dit pourquoi."""


@dataclass(frozen=True)
class Bloc:
    texte: str
    section: str | None = None
    page: int | None = None


def extraire(contenu: bytes, format: str) -> list[Bloc]:
    if format == "markdown":
        blocs = extraire_markdown(contenu)
    elif format == "pdf":
        blocs = extraire_pdf(contenu)
    else:
        raise ExtractionImpossible(f"Format non pris en charge : {format}.")
    blocs = [b for b in blocs if b.texte.strip()]
    if not blocs:
        raise ExtractionImpossible("Le document ne contient aucun texte exploitable.")
    return blocs


# --- Markdown -----------------------------------------------------------------

_TITRE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_CLOTURE = re.compile(r"^\s*(```|~~~)")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LIEN = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_EMPHASE = re.compile(r"(\*\*|__|\*|_|`)(?=\S)(.+?)(?<=\S)\1")


def _texte_markdown(ligne: str) -> str:
    """Retire le balisage qui gêne la lecture : images, liens, emphase."""
    ligne = _IMAGE.sub(lambda m: m.group(1), ligne)
    ligne = _LIEN.sub(lambda m: m.group(1), ligne)
    return _EMPHASE.sub(lambda m: m.group(2), ligne)


def extraire_markdown(contenu: bytes) -> list[Bloc]:
    try:
        texte = contenu.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ExtractionImpossible("Le fichier Markdown n'est pas encodé en UTF-8.") from exc

    blocs: list[Bloc] = []
    titres: list[tuple[int, str]] = []
    lignes: list[str] = []
    dans_code = False

    def clore():
        corps = "\n".join(lignes).strip()
        if corps:
            section = SEPARATEUR_SECTIONS.join(t for _, t in titres) or None
            blocs.append(Bloc(normaliser(corps), section=section))
        lignes.clear()

    for ligne in texte.splitlines():
        if _CLOTURE.match(ligne):
            dans_code = not dans_code
            continue
        m = None if dans_code else _TITRE.match(ligne)
        if m:
            clore()
            niveau = len(m.group(1))
            titres[:] = [t for t in titres if t[0] < niveau] + [(niveau, _texte_markdown(m.group(2)))]
        else:
            lignes.append(ligne if dans_code else _texte_markdown(ligne))
    clore()
    return blocs


# --- PDF ----------------------------------------------------------------------

def _sommaire(lecteur) -> list[tuple[int, str]]:
    """(page, chemin de titres) de chaque signet du PDF, dans l'ordre."""
    entrees: list[tuple[int, str]] = []

    def parcourir(elements, parents):
        dernier = None
        for el in elements:
            if isinstance(el, list):
                if dernier is not None:
                    parcourir(el, parents + [dernier])
                continue
            titre = str(getattr(el, "title", "") or "").strip()
            try:
                page = lecteur.get_destination_page_number(el) + 1
            except Exception:  # signet sans destination exploitable
                page = None
            if titre and page:
                entrees.append((page, SEPARATEUR_SECTIONS.join(parents + [titre])))
            dernier = titre or dernier

    try:
        parcourir(lecteur.outline, [])
    except Exception:  # sommaire corrompu : on s'en passe
        return []
    return entrees


def extraire_pdf(contenu: bytes) -> list[Bloc]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        lecteur = PdfReader(io.BytesIO(contenu))
        if lecteur.is_encrypted:
            raise ExtractionImpossible("Le PDF est protégé par un mot de passe.")
        pages = list(lecteur.pages)
    except ExtractionImpossible:
        raise
    except (PdfReadError, ValueError, OSError) as exc:
        raise ExtractionImpossible("Le fichier PDF est illisible.") from exc

    sommaire = _sommaire(lecteur)
    blocs: list[Bloc] = []
    for numero, page in enumerate(pages, start=1):
        try:
            texte = page.extract_text() or ""
        except Exception:  # une page illisible n'empêche pas les autres
            texte = ""
        section = None
        for debut, titre in sommaire:
            if debut <= numero:
                section = titre
        if texte.strip():
            blocs.append(Bloc(normaliser(texte), section=section, page=numero))
    if not blocs:
        raise ExtractionImpossible(
            "Aucun texte dans ce PDF : un document scanné n'est pas pris en charge (pas d'OCR).")
    return blocs


# --- Commun -------------------------------------------------------------------

def normaliser(texte: str) -> str:
    """Espaces réguliers ; mots coupés en fin de ligne recollés ; paragraphes
    (ligne vide) gardés, simples retours à la ligne remplacés par une espace."""
    texte = texte.replace("\r\n", "\n").replace("\r", "\n").replace("­", "")
    texte = re.sub(r"(\w)-\n(\w)", r"\1\2", texte)
    paragraphes = re.split(r"\n\s*\n", texte)
    propres = (re.sub(r"\s+", " ", p).strip() for p in paragraphes)
    return "\n\n".join(p for p in propres if p)
