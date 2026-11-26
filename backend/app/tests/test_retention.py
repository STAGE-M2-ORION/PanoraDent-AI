"""Rétention du journal d'audit et purge (sprint 11, lot D).

Ce qui ferme le lot : la purge respecte la rétention, s'inscrit au journal
avec le volume et la date limite, et elle est refusée dans la session qui vient
d'abaisser la durée de conservation.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import journal
from app.auth_models import Journal
from app.models import Analysis, Detection, StatutAnalyse, Verdict
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE

from .conftest import ADMIN_EMAIL, BASE, connexion, erreur

RETENTION = f"{BASE}/journal/retention"
PURGE = f"{BASE}/journal/purge"


def _ancienne(db, jours: int, action="export_historique"):
    db.add(Journal(action=action, resultat=journal.SUCCES, details={"age": jours},
                   horodatage=datetime.now(timezone.utc) - timedelta(days=jours)))
    db.commit()


def _actions(db, action):
    return db.scalars(select(Journal).where(Journal.action == action)).all()


def test_un_an_par_defaut(admin):
    r = admin.get(RETENTION).json()
    assert (r["retention_jours"], r["minimum"], r["maximum"], r["defaut"]) == (365, 180, 3650, 365)
    assert r["purge_bloquee"] is False
    assert admin.get(f"{BASE}/cabinet").json()["retention_jours"] == 365


def test_duree_bornee_six_mois_a_dix_ans(admin, db):
    for jours in (179, 3651, 0):
        r = admin.put(f"{BASE}/cabinet/retention", json={"jours": jours})
        assert (r.status_code, r.json()["code"]) == (422, "retention_invalide")
    assert admin.put(f"{BASE}/cabinet/retention", json={"jours": 730}).json()["retention_jours"] == 730
    (entree,) = _actions(db, "retention_journal")
    assert entree.details == {"avant": 365, "apres": 730}


def test_la_purge_respecte_la_retention_et_s_inscrit_au_journal(admin, db):
    _ancienne(db, 400)
    _ancienne(db, 500)
    _ancienne(db, 100)                                  # dans la durée : conservée
    a = Analysis(reference="PDX-2026-1500", image_key="k", width=1, height=1, statut=StatutAnalyse.TERMINEE)
    d = Detection(label="caries", fdi=36, confidence=0.8, x=0.1, y=0.1, w=0.1, h=0.1)
    a.detections = [d]
    db.add(a)
    db.flush()
    db.add(Verdict(detection_id=d.id, numero=1, action="valider", label="caries", fdi=36, x=0.1, y=0.1, w=0.1, h=0.1,
                   cree_le=datetime.utcnow() - timedelta(days=600)))
    db.commit()

    apercu = admin.get(RETENTION).json()
    assert apercu["lignes"] == 2

    r = admin.post(PURGE, json={"confirmer": True})
    assert r.status_code == 200 and r.json()["lignes"] == 2
    db.expire_all()
    restantes = sorted(e.details["age"] for e in _actions(db, "export_historique"))
    assert restantes == [100]
    assert db.query(Verdict).count() == 1              # donnée clinique : jamais purgée ici
    (purge,) = _actions(db, "purge_journal")
    assert purge.details["lignes"] == 2 and purge.details["retention_jours"] == 365
    limite = datetime.fromisoformat(purge.details["date_limite"])
    assert abs((datetime.utcnow() - timedelta(days=365)) - limite) < timedelta(minutes=1)
    assert admin.get(RETENTION).json()["lignes"] == 0


def test_purge_a_confirmer(admin, db):
    _ancienne(db, 400)
    r = admin.post(PURGE, json={})
    assert (r.status_code, r.json()["code"]) == (422, "confirmation_requise")
    assert len(_actions(db, "export_historique")) == 1


def test_purge_refusee_dans_la_session_qui_a_abaisse_la_duree(admin, nouveau_client, db):
    _ancienne(db, 250)
    assert admin.put(f"{BASE}/cabinet/retention", json={"jours": 200}).status_code == 200
    assert admin.get(RETENTION).json()["purge_bloquee"] is True
    r = admin.post(PURGE, json={"confirmer": True})
    assert (r.status_code, r.json()["code"]) == (409, "retention_abaissee_dans_la_session")
    assert len(_actions(db, "export_historique")) == 1 and _actions(db, "purge_journal") == []

    # Depuis une autre session : possible, et bornée par la nouvelle durée.
    autre = nouveau_client()
    assert erreur(connexion(autre, ADMIN_EMAIL)) is None
    assert autre.get(RETENTION).json()["purge_bloquee"] is False
    assert autre.post(PURGE, json={"confirmer": True}).json()["lignes"] == 1


def test_allonger_la_duree_ne_bloque_pas_la_purge(admin):
    assert admin.put(f"{BASE}/cabinet/retention", json={"jours": 1000}).status_code == 200
    assert admin.get(RETENTION).json()["purge_bloquee"] is False
    assert admin.post(PURGE, json={"confirmer": True}).status_code == 200


def test_reserve_a_l_administration(connecte):
    for role in (PRACTITIONER_ROLE, VIEWER_ROLE):
        c = connecte(f"{role.lower()}.retention@cabinet.example.org", role)
        assert c.get(RETENTION).status_code == 403
        assert c.post(PURGE, json={"confirmer": True}).status_code == 403
        assert c.put(f"{BASE}/cabinet/retention", json={"jours": 200}).status_code == 403


def test_libelles_au_journal(admin, db):
    from app.services import journal_audit as ja

    admin.put(f"{BASE}/cabinet/retention", json={"jours": 400})
    assert ja._precision("retention_journal", _actions(db, "retention_journal")[0].details) == "365 → 400 jours"
    assert ja._precision("purge_journal", {"lignes": 3, "date_limite": "2025-11-26T10:00:00", "retention_jours": 365}) == \
        "3 entrées antérieures au 2025-11-26 · conservation 365 jours"
