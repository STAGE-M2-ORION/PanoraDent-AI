"""Sauvegarde, restauration et jeu de démonstration (sprint 12, lot E), côté
application. Le parcours complet (pg_dump, pile vierge, chronométrage) est
celui de `scripts/sauvegarder.sh` et `scripts/restaurer.sh`."""
import io
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app import demo, sauvegarde
from app.auth_models import Journal, Utilisateur
from app.config import settings
from app.models import Analysis, Document, StatutAnalyse
from app.services import storage

from .test_anonymize import octets, panoramique


class FauxS3:
    """Le strict nécessaire de l'API S3, en mémoire : objets et leur type."""

    def __init__(self):
        self.objets: dict[str, tuple[bytes, str]] = {}

    def head_bucket(self, Bucket):
        return {}

    def create_bucket(self, Bucket):
        return {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objets[Key] = (Body, ContentType)

    def get_object(self, Bucket, Key):
        corps, type_ = self.objets[Key]
        return {"Body": io.BytesIO(corps), "ContentType": type_}

    def get_paginator(self, _nom):
        s3 = self

        class P:
            def paginate(self, Bucket, Prefix=""):
                yield {"Contents": [{"Key": k, "Size": len(v[0]), "LastModified": datetime(2026, 11, 26, tzinfo=timezone.utc)}
                                    for k, v in sorted(s3.objets.items()) if k.startswith(Prefix)]}

        return P()


@pytest.fixture()
def s3(monkeypatch, session_factory):
    faux = FauxS3()
    monkeypatch.setattr(storage, "_s3", faux)
    monkeypatch.setattr(sauvegarde, "get_session_factory", lambda: session_factory)
    return faux


def test_objets_aller_retour_avec_leur_type(s3):
    s3.put_object("b", "images/a.png", b"\x89PNG-a", "image/png")
    s3.put_object("b", "documents/guide.md", "é".encode() * 3, "text/markdown")
    archive = io.BytesIO()
    assert sauvegarde.exporter_objets(archive) == 2

    vierge = FauxS3()
    storage._s3 = vierge   # remis par monkeypatch à la fin du test
    archive.seek(0)
    assert sauvegarde.importer_objets(archive) == 2
    assert vierge.objets == {"images/a.png": (b"\x89PNG-a", "image/png"),
                             "documents/guide.md": ("é".encode() * 3, "text/markdown")}


def test_inventaire_et_verification(s3, db):
    db.add(Analysis(reference="PDX-S-1", image_key="images/x.png", report_key="rapports/x.pdf", width=1, height=1))
    db.add(Document(titre="Guide", nom_fichier="g.md", format="markdown", cle_stockage="documents/g.md", empreinte="e" * 64))
    db.commit()
    s3.put_object("b", "images/x.png", b"123", "image/png")
    s3.put_object("b", "documents/g.md", b"#", "text/markdown")

    inv = sauvegarde.inventaire()
    assert inv["comptes"]["analyses"] == 1 and inv["comptes"]["documents"] == 1
    assert inv["objets"] == {"nombre": 2, "octets": 4}
    # Le rapport cité par l'analyse manque : la vérification le nomme.
    assert sauvegarde.verifier() == ["rapports/x.pdf"]
    s3.put_object("b", "rapports/x.pdf", b"%PDF", "application/pdf")
    assert sauvegarde.verifier() == []


def test_comparaison_et_trace_de_la_restauration(s3, db):
    ref = sauvegarde.inventaire()
    assert sauvegarde.comparer(ref, sauvegarde.inventaire()) == []
    s3.put_object("b", "images/en-trop.png", b"1", "image/png")
    db.add(Analysis(reference="PDX-S-2", image_key="images/en-trop.png", width=1, height=1))
    db.commit()
    ecarts = sauvegarde.comparer(ref, sauvegarde.inventaire())
    assert any(e.startswith("analyses : 0 sauvegardés, 1 restaurés") for e in ecarts)
    assert any(e.startswith("objets :") for e in ecarts)
    sauvegarde.journaliser_restauration(ref)
    (entree,) = db.scalars(select(Journal).where(Journal.action == "restauration")).all()
    assert entree.details["sauvegarde_du"] == ref["date"]


def test_jeu_de_demo_par_le_circuit_reel(s3, db):
    images = [("test_1.png", octets(panoramique())), ("test_2.png", octets(panoramique())), ("note.png", b"pas une image")]
    bilan = demo.charger(db, images)
    assert bilan["comptes_crees"] == ["praticien.demo@demo.example.org", "lecteur.demo@demo.example.org"]
    assert len(bilan["analyses"]) == 2 and bilan["ignorees"][0].startswith("note.png (")

    praticien = db.scalar(select(Utilisateur).where(Utilisateur.email == "praticien.demo@demo.example.org"))
    assert praticien.mot_de_passe is None                 # activé par son lien, comme tout compte
    analyses = db.scalars(select(Analysis).where(Analysis.utilisateur_id == praticien.id)).all()
    assert {a.statut for a in analyses} == {StatutAnalyse.EN_FILE}       # le worker les prendra
    assert all(a.image_key in s3.objets for a in analyses)               # image anonymisée stockée
    assert db.scalar(select(Journal).where(Journal.action == "jeu_demo_charge")).details["analyses"] == 2
    assert len(db.scalars(select(Journal).where(Journal.action == "import_analyse")).all()) == 2

    # Rejoué : rien n'est doublé.
    encore = demo.charger(db, images[:2])
    assert encore["comptes_crees"] == [] and encore["analyses"] == [] and len(encore["ignorees"]) == 2


def test_jeu_de_demo_refuse_en_production(s3, db, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    with pytest.raises(demo.Refus, match="production"):
        demo.charger(db, [("test_1.png", octets(panoramique()))])
    assert db.scalar(select(Utilisateur).where(Utilisateur.email.like("%demo.example.org"))) is None
    assert demo.main() == 1                                # refusé avant même de lire l'archive
