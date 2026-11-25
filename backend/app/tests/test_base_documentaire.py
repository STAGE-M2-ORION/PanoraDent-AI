"""Socle de la base documentaire (sprint 9, lot A) : tables et vecteurs.

Sous SQLite, le vecteur est rangé en JSON ; sous PostgreSQL, en `vector(1024)`.
Le type `Vecteur` garantit la même chose dans les deux cas : une liste de
flottants de la bonne dimension, ou un refus.
"""
import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError, StatementError

from app.models import Document, EtatDocument, Passage
from app.vecteurs import DIMENSION, Vecteur, _VectorPg


def _document(**kw):
    base = dict(titre="Lire une panoramique", nom_fichier="lecture.md", format="markdown",
                cle_stockage="documents/abc", empreinte="a" * 64, taille=1200)
    return Document(**{**base, **kw})


def _vecteur(i: int) -> list[float]:
    v = [0.0] * DIMENSION
    v[i] = 1.0
    return v


def test_document_et_passages_aller_retour(db):
    doc = _document()
    doc.passages = [
        Passage(rang=0, texte="Une zone radio-claire…", section="Signes", page=None, modele="bge-m3", vecteur=_vecteur(0)),
        Passage(rang=1, texte="Le seuil de confiance…", section="Seuils", page=3, modele="bge-m3", vecteur=_vecteur(5)),
    ]
    db.add(doc)
    db.commit()
    db.expire_all()

    relu = db.get(Document, doc.id)
    assert relu.etat == EtatDocument.EN_ATTENTE
    assert [p.rang for p in relu.passages] == [0, 1]
    assert relu.passages[1].page == 3
    assert len(relu.passages[1].vecteur) == DIMENSION
    assert relu.passages[1].vecteur[5] == 1.0
    assert sum(relu.passages[1].vecteur) == 1.0


def test_passage_sans_vecteur_accepte(db):
    doc = _document(passages=[Passage(rang=0, texte="pas encore vectorisé")])
    db.add(doc)
    db.commit()
    assert db.get(Document, doc.id).passages[0].vecteur is None


def test_vecteur_de_mauvaise_dimension_refuse(db):
    db.add(_document(passages=[Passage(rang=0, texte="x", vecteur=[0.1, 0.2, 0.3])]))
    with pytest.raises(StatementError, match="dimension 3"):
        db.commit()


def test_vecteur_non_fini_refuse(db):
    v = _vecteur(0)
    v[1] = float("nan")
    db.add(_document(passages=[Passage(rang=0, texte="x", vecteur=v)]))
    with pytest.raises(StatementError, match="non fini"):
        db.commit()


def test_supprimer_un_document_supprime_ses_passages(db):
    doc = _document(passages=[Passage(rang=i, texte=f"p{i}") for i in range(3)])
    db.add(doc)
    db.commit()
    db.delete(doc)
    db.commit()
    assert db.query(Passage).count() == 0


def test_meme_fichier_depose_deux_fois_refuse(db):
    db.add(_document())
    db.commit()
    db.add(_document(titre="Copie"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_rang_unique_dans_un_document(db):
    db.add(_document(passages=[Passage(rang=0, texte="a"), Passage(rang=0, texte="b")]))
    with pytest.raises(IntegrityError):
        db.commit()


def test_forme_postgresql_du_vecteur():
    """Sous PostgreSQL : colonne `vector(1024)`, échangée sous la forme « [x,y,…] »."""
    dialecte = postgresql.dialect()
    impl = Vecteur().load_dialect_impl(dialecte)
    assert isinstance(impl, _VectorPg)
    assert impl.get_col_spec() == f"vector({DIMENSION})"
    assert impl.bind_processor(dialecte)([1, 0.5, -2]) == "[1.0,0.5,-2.0]"
    assert impl.result_processor(dialecte, None)("[1,0.5,-2]") == [1.0, 0.5, -2.0]
    assert impl.result_processor(dialecte, None)(None) is None
