"""Indexation d'un document de référence (sprint 9) : extraction du texte,
découpage en passages, vectorisation, enregistrement.

Réindexer un document ne touche que ses propres passages : les autres
documents restent intacts. Si l'indexation échoue (texte introuvable, service
de vectorisation absent), le document passe à l'état « échec » avec le motif,
et ses passages précédents, s'il en avait, sont conservés tels quels.
"""
import hashlib
import logging
from datetime import datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .. import journal
from ..models import Document, EtatDocument, Passage
from .decoupage import decouper
from .extraction_texte import ExtractionImpossible, extraire
from .vectorisation import VectorisationImpossible, Vectoriseur, vectoriseur_courant

logger = logging.getLogger("panoradent.indexation")


def empreinte(contenu: bytes) -> str:
    return hashlib.sha256(contenu).hexdigest()


def indexer(db: Session, document: Document, contenu: bytes, vectoriseur: Vectoriseur) -> Document:
    """(Ré)indexe `document` à partir du fichier `contenu`. Ne valide pas la
    transaction : l'appelant décide (et journalise)."""
    try:
        morceaux = decouper(extraire(contenu, document.format))
        if not morceaux:
            raise ExtractionImpossible("Le document ne contient aucun texte exploitable.")
        vecteurs = vectoriseur.vectoriser([m.a_vectoriser() for m in morceaux])
    except (ExtractionImpossible, VectorisationImpossible) as exc:
        document.etat = EtatDocument.ECHEC
        document.erreur = str(exc)
        db.flush()
        return document

    # Les anciens passages partent avant l'insertion des nouveaux : (document, rang) est unique.
    document.passages = []
    db.flush()
    document.passages = [
        Passage(rang=i, texte=m.texte, section=m.section, page=m.page, modele=vectoriseur.nom, vecteur=v)
        for i, (m, v) in enumerate(zip(morceaux, vecteurs))
    ]
    document.etat = EtatDocument.INDEXE
    document.erreur = None
    document.modele_vecteurs = vectoriseur.nom
    document.nb_passages = len(morceaux)
    document.indexe_le = datetime.utcnow()
    db.flush()
    return document


def perime(document: Document, modele_courant: str) -> bool:
    """Indexé avec un autre modèle que le modèle courant : à réindexer."""
    return document.etat == EtatDocument.INDEXE and document.modele_vecteurs != modele_courant


def etat_index(db: Session, modele_courant: str) -> dict:
    """Résumé de la base documentaire pour l'administration."""
    par_etat = dict(db.query(Document.etat, func.count()).group_by(Document.etat).all())
    perimes = (db.query(func.count(Passage.id))
               .filter(or_(Passage.modele.is_(None), Passage.modele != modele_courant,
                           Passage.vecteur.is_(None)))
               .scalar())
    documents_perimes = (db.query(func.count(Document.id))
                         .filter(Document.etat == EtatDocument.INDEXE,
                                 or_(Document.modele_vecteurs.is_(None),
                                     Document.modele_vecteurs != modele_courant))
                         .scalar())
    return {
        "modele": modele_courant,
        "documents": sum(par_etat.values()),
        "par_etat": {e: par_etat.get(e, 0) for e in EtatDocument.TOUS},
        "passages": db.query(func.count(Passage.id)).scalar(),
        "passages_perimes": perimes,
        "documents_perimes": documents_perimes,
    }


# --- File d'indexation (worker) -------------------------------------------------
# Comme les analyses : la file est la table elle-même, l'état en base fait foi.
# Le worker ne prend un document que lorsqu'aucune analyse n'attend.

def reprendre_les_documents_interrompus(db: Session) -> int:
    """Remet « en attente » les documents restés « en cours » (worker arrêté)."""
    n = db.execute(update(Document).where(Document.etat == EtatDocument.EN_COURS)
                   .values(etat=EtatDocument.EN_ATTENTE)).rowcount or 0
    db.commit()
    return n


def prendre_un_document(db: Session) -> Document | None:
    """Plus ancien document en attente, passé « en cours » dans la même transaction."""
    doc = db.scalar(select(Document).where(Document.etat == EtatDocument.EN_ATTENTE)
                    .order_by(Document.depose_le).limit(1)
                    .with_for_update(skip_locked=True, of=Document))
    if doc is None:
        db.rollback()
        return None
    doc.etat = EtatDocument.EN_COURS
    db.commit()
    return doc


def traiter_document(db: Session, doc: Document, lire, vectoriseur: Vectoriseur | None = None) -> Document | None:
    """Indexe un document pris par le worker. `lire(cle)` renvoie le fichier
    stocké. Termine en « indexe » ou « echec », et l'inscrit au journal. Le
    document peut être supprimé pendant ce temps : rien n'est alors recréé."""
    vectoriseur = vectoriseur or vectoriseur_courant()
    ident = doc.id
    try:
        contenu = lire(doc.cle_stockage)
    except Exception:  # noqa: BLE001
        logger.exception("Document %s : fichier illisible dans le stockage", doc.id)
        doc.etat, doc.erreur = EtatDocument.ECHEC, "Le fichier est introuvable dans le stockage."
    else:
        try:
            indexer(db, doc, contenu, vectoriseur)
        except Exception:  # noqa: BLE001 — jamais de document bloqué « en cours »
            db.rollback()
            logger.exception("Document %s : erreur inattendue", ident)
            doc = db.get(Document, ident)
            if doc is None:
                return None
            doc.etat, doc.erreur = EtatDocument.ECHEC, "Erreur inattendue pendant l'indexation."
    reussi = doc.etat == EtatDocument.INDEXE
    journal.inscrire(
        db, "document_indexe" if reussi else "document_echec", journal.SUCCES if reussi else journal.ECHEC,
        cible=f"document:{doc.id}", commit=False,
        details={"titre": doc.titre, **({"passages": doc.nb_passages, "modele": doc.modele_vecteurs}
                                        if reussi else {"erreur": doc.erreur})},
    )
    db.commit()
    return doc
