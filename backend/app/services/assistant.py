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
ECHEC_SANS_SOURCE = ("L'assistant n'a pas pu appuyer sa réponse sur la documentation : elle n'est pas "
                     "affichée. Reformulez la question.")


@dataclass
class Reponse:
    statut: str                      # « reponse », « refus » ou « echec »
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
    return {"numero": numero, "document_id": doc.id, "titre": doc.titre, "section": p.section,
            "page": p.page, "extrait": extrait, "passage_id": p.id, "similarite": round(trouve.score, 3)}


def repondre(db: Session, question: str, *, analyse: Analysis | None = None,
             vectoriseur: Vectoriseur | None = None, redacteur: Redacteur | None = None,
             nombre: int | None = None, seuil: float | None = None) -> Reponse:
    vectoriseur = vectoriseur or vectoriseur_courant()
    redacteur = redacteur or redacteur_courant()
    nombre = settings.assistant_passages if nombre is None else nombre
    seuil = settings.assistant_seuil if seuil is None else seuil

    if passages_utilisables(db, vectoriseur.nom) == 0:
        return Reponse("refus", REFUS_BASE_VIDE)
    try:
        trouves = rechercher(db, vectoriseur.vectoriser([question])[0], modele=vectoriseur.nom,
                             nombre=nombre, seuil=seuil)
    except VectorisationImpossible as exc:
        return Reponse("echec", f"L'assistant est indisponible : {exc}", motif=str(exc))
    if not trouves:
        return Reponse("refus", REFUS_HORS_DOCUMENTATION)

    extraits = [Extrait(i, t.passage.document.titre, t.passage.section, t.passage.page, t.passage.texte)
                for i, t in enumerate(trouves, start=1)]
    contexte = contexte_analyse(analyse) if analyse is not None else None
    try:
        texte = redacteur.rediger(question, extraits, contexte)
    except RedactionImpossible as exc:
        return Reponse("echec", f"L'assistant est indisponible : {exc}.", motif=str(exc))

    controle = verifier(texte, len(extraits))
    if controle.statut == "refus":
        return Reponse("refus", REFUS_HORS_DOCUMENTATION)
    if controle.statut == "echec":
        return Reponse("echec", ECHEC_SANS_SOURCE, motif=controle.motif)
    return Reponse("reponse", texte.strip(), [_source(n, trouves[n - 1]) for n in controle.citees])


def poser_question(db: Session, question: str, *, utilisateur_id, analyse: Analysis | None = None,
                   request: Request | None = None, **reglages) -> Reponse:
    """Question posée par un utilisateur : contrôle, réponse, journal."""
    question = " ".join((question or "").split())
    if not QUESTION_MIN <= len(question) <= QUESTION_MAX:
        raise ApiError(422, "question_invalide",
                       f"La question doit compter entre {QUESTION_MIN} et {QUESTION_MAX} caractères.")
    p = parametres(db)
    reglages.setdefault("nombre", p.passages)
    reglages.setdefault("seuil", p.seuil)
    reponse = repondre(db, question, analyse=analyse, **reglages)
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
    )
    return reponse
