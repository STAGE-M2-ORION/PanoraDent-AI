"""Assistant documentaire (sprint 9) : une question, une réponse sourcée ou un refus.

1. la question est vectorisée, puis comparée aux passages de la base ;
2. aucun passage au-dessus du seuil → refus motivé, sans appel au modèle ;
3. sinon, le modèle rédige à partir des seuls passages retrouvés (et du
   contexte ANONYME de l'analyse, si la question en vient) ;
4. la réponse est contrôlée : sans citation valide, elle n'est pas montrée ;
5. question, statut, réponse et sources sont inscrits au journal.

L'assistant explique, il ne diagnostique pas : cette frontière est tenue par
le gabarit et par le contrôle des citations, pas par une consigne seule.
"""
from contextlib import aclosing
from dataclasses import dataclass, field

from fastapi import Request
from sqlalchemy.orm import Session

from .. import journal
from ..config import settings
from ..errors import ApiError
from ..models import LABEL_DENT, Analysis, ParametresAssistant
from . import revue
from .compte_rendu import TYPES
from .recherche import passages_utilisables, rechercher
from .redaction import Extrait, RedactionImpossible, Redacteur, redacteur_courant, verifier
from .vectorisation import VectorisationImpossible, Vectoriseur, vectoriseur_courant

QUESTION_MIN, QUESTION_MAX = 3, 1000
EXTRAIT_MAX = 400  # caractères de l'extrait affiché sous la réponse
AVERTISSEMENT = ("L'assistant éclaire la lecture à partir de la documentation de référence ; "
                 "il ne pose pas de diagnostic.")

REFUS_HORS_DOCUMENTATION = ("Je ne trouve rien dans la documentation de référence pour répondre à cette "
                            "question. Essayez de la reformuler, ou ajoutez à la base documentaire le "
                            "document qui en traite.")
REFUS_BASE_VIDE = ("La base documentaire est vide, ou doit être réindexée : l'assistant n'a aucun "
                   "passage sur lequel s'appuyer.")
INTERROMPUE = "Réponse interrompue à votre demande : rien n'a été enregistré de son texte."
ECHEC_SANS_SOURCE = ("L'assistant n'a pas pu appuyer sa réponse sur la documentation : elle n'est pas "
                     "affichée. Reformulez la question.")


@dataclass
class Reponse:
    statut: str                      # « reponse », « refus », « echec » ou « interrompue »
    texte: str                       # la réponse, ou le message de refus ou d'échec
    sources: list[dict] = field(default_factory=list)
    motif: str | None = None         # cause technique d'un échec (journal, jamais affichée seule)

    def en_json(self) -> dict:
        return {"statut": self.statut, "texte": self.texte, "sources": self.sources,
                "avertissement": AVERTISSEMENT}


def parametres(db: Session) -> ParametresAssistant:
    """Réglages de la recherche : la ligne unique, créée à la première lecture
    avec les valeurs par défaut de la configuration."""
    p = db.get(ParametresAssistant, 1)
    if p is None:
        p = ParametresAssistant(id=1, passages=settings.assistant_passages, seuil=settings.assistant_seuil)
        db.add(p)
        db.flush()
    return p


def contexte_analyse(a: Analysis) -> dict:
    """Contexte ANONYME d'une analyse, par construction : la version du modèle
    et, pour chaque anomalie retenue, son type, sa dent et sa confiance. Ni
    l'image, ni la référence, ni la date, ni la note, ni la conclusion, ni le
    praticien : un test vérifie la charge envoyée champ par champ."""
    anomalies = []
    for d in a.detections:
        if d.label == LABEL_DENT or not revue.au_compte_rendu(a, d):
            continue
        retenu = d.retenu()
        anomalies.append({
            "type": TYPES.get(retenu["label"], (retenu["label"],))[0].lower(),
            "dent": retenu["fdi"],
            "confiance": round(d.confidence * 100) if d.confidence is not None else None,
            "origine": "ajoutée par le praticien" if d.confidence is None else "proposée par le modèle",
        })
    anomalies.sort(key=lambda x: (x["dent"] or 99, x["type"]))
    return {"modele": a.model_version or None, "anomalies": anomalies}


def _source(numero: int, trouve) -> dict:
    p, doc = trouve.passage, trouve.passage.document
    extrait = p.texte if len(p.texte) <= EXTRAIT_MAX else p.texte[:EXTRAIT_MAX].rsplit(" ", 1)[0] + "…"
    return {"numero": numero, "document_id": doc.id, "titre": doc.titre, "format": doc.format, "section": p.section,
            "page": p.page, "extrait": extrait, "passage_id": p.id, "similarite": round(trouve.score, 3)}


@dataclass
class Preparation:
    """Ce qui précède la rédaction : passages retrouvés et contexte anonyme ;
    ou, si la question s'arrête là (base vide, rien de pertinent, service
    absent), la réponse définitive."""
    reponse: Reponse | None = None
    trouves: list = field(default_factory=list)
    extraits: list[Extrait] = field(default_factory=list)
    contexte: dict | None = None


def preparer(db: Session, question: str, *, analyse: Analysis | None = None,
             vectoriseur: Vectoriseur | None = None, nombre: int | None = None,
             seuil: float | None = None) -> Preparation:
    vectoriseur = vectoriseur or vectoriseur_courant()
    nombre = settings.assistant_passages if nombre is None else nombre
    seuil = settings.assistant_seuil if seuil is None else seuil

    if passages_utilisables(db, vectoriseur.nom) == 0:
        return Preparation(Reponse("refus", REFUS_BASE_VIDE))
    try:
        trouves = rechercher(db, vectoriseur.vectoriser([question])[0], modele=vectoriseur.nom,
                             nombre=nombre, seuil=seuil)
    except VectorisationImpossible as exc:
        return Preparation(Reponse("echec", f"L'assistant est indisponible : {exc}", motif=str(exc)))
    if not trouves:
        return Preparation(Reponse("refus", REFUS_HORS_DOCUMENTATION))
    extraits = [Extrait(i, t.passage.document.titre, t.passage.section, t.passage.page, t.passage.texte)
                for i, t in enumerate(trouves, start=1)]
    return Preparation(None, trouves, extraits, contexte_analyse(analyse) if analyse is not None else None)


def conclure(texte: str, prep: Preparation) -> Reponse:
    """Contrôle de la réponse rédigée : sans citation valide, elle n'est pas montrée."""
    controle = verifier(texte, len(prep.extraits))
    if controle.statut == "refus":
        return Reponse("refus", REFUS_HORS_DOCUMENTATION)
    if controle.statut == "echec":
        return Reponse("echec", ECHEC_SANS_SOURCE, motif=controle.motif)
    return Reponse("reponse", texte.strip(), [_source(n, prep.trouves[n - 1]) for n in controle.citees])


def indisponible(exc: Exception) -> Reponse:
    return Reponse("echec", f"L'assistant est indisponible : {exc}.", motif=str(exc))


def repondre(db: Session, question: str, *, analyse: Analysis | None = None,
             vectoriseur: Vectoriseur | None = None, redacteur: Redacteur | None = None,
             nombre: int | None = None, seuil: float | None = None) -> Reponse:
    prep = preparer(db, question, analyse=analyse, vectoriseur=vectoriseur, nombre=nombre, seuil=seuil)
    if prep.reponse is not None:
        return prep.reponse
    redacteur = redacteur or redacteur_courant()
    try:
        texte = redacteur.rediger(question, prep.extraits, prep.contexte)
    except RedactionImpossible as exc:
        return indisponible(exc)
    return conclure(texte, prep)


async def rediger_en_flux(prep: Preparation, question: str, redacteur: Redacteur | None = None):
    """Rédaction au fil de l'eau : (« fragment », texte) à mesure, puis
    (« fin », Reponse) une fois le tout contrôlé. Fermer ce générateur (arrêt
    demandé, navigateur parti) ferme aussi le flux du modèle : la génération
    s'arrête côté serveur, elle ne continue pas dans le vide."""
    redacteur = redacteur or redacteur_courant()
    morceaux: list[str] = []
    try:
        async with aclosing(redacteur.flux(question, prep.extraits, prep.contexte)) as flux:
            async for fragment in flux:
                morceaux.append(fragment)
                yield "fragment", fragment
    except RedactionImpossible as exc:
        yield "fin", indisponible(exc)
        return
    yield "fin", conclure("".join(morceaux), prep)


def question_valide(question: str | None) -> str:
    question = " ".join((question or "").split())
    if not QUESTION_MIN <= len(question) <= QUESTION_MAX:
        raise ApiError(422, "question_invalide",
                       f"La question doit compter entre {QUESTION_MIN} et {QUESTION_MAX} caractères.")
    return question


def journaliser(db: Session, question: str, reponse: Reponse, *, utilisateur_id, analyse: Analysis | None,
                request: Request | None, commit: bool = True) -> None:
    journal.inscrire(
        db, "question_assistant", journal.ECHEC if reponse.statut == "echec" else journal.SUCCES,
        request=request, utilisateur_id=utilisateur_id,
        cible=f"analyse:{analyse.id}" if analyse is not None else None,
        details={
            "question": question,
            "statut": reponse.statut,
            "reponse": reponse.texte,
            "sources": [{k: s[k] for k in ("numero", "document_id", "titre", "section", "page", "passage_id")}
                        for s in reponse.sources],
            **({"motif": reponse.motif} if reponse.motif else {}),
        },
        commit=commit,
    )


def poser_question(db: Session, question: str, *, utilisateur_id, analyse: Analysis | None = None,
                   request: Request | None = None, **reglages) -> Reponse:
    """Question posée par un utilisateur : contrôle, réponse, journal."""
    question = question_valide(question)
    p = parametres(db)
    reglages.setdefault("nombre", p.passages)
    reglages.setdefault("seuil", p.seuil)
    reponse = repondre(db, question, analyse=analyse, **reglages)
    journaliser(db, question, reponse, utilisateur_id=utilisateur_id, analyse=analyse, request=request)
    return reponse
