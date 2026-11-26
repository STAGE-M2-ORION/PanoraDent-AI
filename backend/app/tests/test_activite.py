"""Tableau de bord du praticien et du lecteur (sprint 12, lot C) : indicateurs
réels, portée « moi » pour le praticien, « cabinet » pour le lecteur."""
from datetime import datetime, timedelta, timezone

from app import journal
from app.auth_models import Journal, Utilisateur
from app.models import Analysis, Detection, EtatDetection, StatutAnalyse
from app.permissions import PRACTITIONER_ROLE, VIEWER_ROLE

from .conftest import BASE

URL = f"{BASE}/tableau-de-bord/activite"


def _id(db, email):
    return db.query(Utilisateur).filter_by(email=email).one().id


def _analyse(db, ref, auteur, statut=StatutAnalyse.TERMINEE, *, cree=None, cloturee=None, par=None, seuils=None):
    maintenant = datetime.utcnow()
    a = Analysis(reference=ref, image_key="k", width=1, height=1, statut=statut, utilisateur_id=auteur,
                 created_at=cree or maintenant, seuils=seuils)
    if statut == StatutAnalyse.TERMINEE:
        a.termine_le = (cree or maintenant) + timedelta(seconds=10)
    if cloturee:
        a.cloturee_le, a.cloturee_par_id = cloturee, par or auteur
    db.add(a)
    db.flush()
    return a


def _anomalie(db, a, label, etat=EtatDetection.A_REVOIR, confiance=0.9):
    d = Detection(analysis_id=a.id, label=label, fdi=36, confidence=confiance, x=0.1, y=0.1, w=0.1, h=0.1,
                  model_version="v", etat=etat)
    db.add(d)
    return d


def test_portee_moi_pour_le_praticien(connecte, db):
    c = connecte("dr.activite@cabinet.example.org", PRACTITIONER_ROLE)
    connecte("dr.voisin@cabinet.example.org", PRACTITIONER_ROLE)
    moi, voisin = _id(db, "dr.activite@cabinet.example.org"), _id(db, "dr.voisin@cabinet.example.org")
    maintenant = datetime.utcnow()

    _analyse(db, "PDX-A-1", moi, StatutAnalyse.EN_FILE)
    _analyse(db, "PDX-A-2", moi, StatutAnalyse.ECHOUEE)
    a_relire = _analyse(db, "PDX-A-3", moi, seuils={"caries": 0.5})
    _anomalie(db, a_relire, "caries", EtatDetection.VALIDEE)
    _anomalie(db, a_relire, "caries")                                   # proposée, sans verdict
    _anomalie(db, a_relire, "caries", confiance=0.2)                    # sous le seuil, sans verdict : ignorée
    _anomalie(db, a_relire, "impacted_tooth", EtatDetection.VALIDEE, confiance=0.2)   # sous le seuil, relue : compte
    _anomalie(db, a_relire, "caries", EtatDetection.REJETEE)
    close = _analyse(db, "PDX-A-4", moi, cree=maintenant - timedelta(hours=2),
                     cloturee=maintenant - timedelta(hours=1))
    _anomalie(db, close, "periapical_lesion", EtatDetection.VALIDEE)
    _analyse(db, "PDX-V-1", voisin, StatutAnalyse.EN_FILE)              # pas la mienne
    db.add(Journal(action="compte_rendu_telecharge", resultat=journal.SUCCES, details={},
                   cible=f"analyse:{close.id}", horodatage=datetime.now(timezone.utc) - timedelta(minutes=5)))
    db.add(Journal(action="compte_rendu_telecharge", resultat=journal.SUCCES, details={},
                   cible=f"analyse:{close.id}", horodatage=datetime.now(timezone.utc) - timedelta(days=40)))
    db.commit()

    r = c.get(URL)
    assert r.status_code == 200
    ind = r.json()
    assert ind["portee"] == "moi"
    assert ind["analyses"] == {"ce_mois": ind["analyses"]["ce_mois"], "mois_precedent": ind["analyses"]["mois_precedent"],
                               "en_cours": 1, "a_relire": 1, "cloturees": 1, "echouees": 1}
    assert ind["analyses"]["ce_mois"] + ind["analyses"]["mois_precedent"] == 4
    # Proposées : 1 validée + 1 en attente + 1 rejetée + 1 sous le seuil relue (A-3), 1 validée (A-4).
    assert ind["detections"] == {"proposees": 5, "relues": 4}
    assert ind["types"] == {"caries": 2, "impacted_tooth": 1, "periapical_lesion": 1}
    assert ind["delai_moyen_cloture_s"] == 3600 - 10
    assert ind["comptes_rendus"] == {"trente_jours": 1, "trente_jours_precedents": 1}
    semaines = ind["semaines"]
    assert len(semaines) == 12 and semaines[-1]["clotures"] == 1
    assert sum(s["comptes_rendus"] for s in semaines) == 2
    assert datetime.fromisoformat(semaines[-1]["debut"]).weekday() == 0    # lundi


def test_portee_cabinet_pour_le_lecteur(connecte, db):
    connecte("dr.cab@cabinet.example.org", PRACTITIONER_ROLE)
    lecteur = connecte("lecteur.cab@cabinet.example.org", VIEWER_ROLE)
    dr = _id(db, "dr.cab@cabinet.example.org")
    _analyse(db, "PDX-C-1", dr, StatutAnalyse.EN_COURS)
    _analyse(db, "PDX-C-2", None, cloturee=datetime.utcnow(), par=dr)
    db.commit()

    ind = lecteur.get(URL).json()
    assert ind["portee"] == "cabinet"
    assert (ind["analyses"]["en_cours"], ind["analyses"]["cloturees"]) == (1, 1)
    assert ind["semaines"][-1]["clotures"] == 1
    # La portée « moi » reste permise au lecteur : il n'a rien déposé ni clôturé.
    assert lecteur.get(URL, params={"portee": "moi"}).json()["analyses"]["cloturees"] == 0
    assert lecteur.get(URL, params={"portee": "tout"}).status_code == 422


def test_vide_sans_rien_inventer(connecte):
    c = connecte("dr.neuf@cabinet.example.org", PRACTITIONER_ROLE)
    ind = c.get(URL).json()
    assert ind["detections"] == {"proposees": 0, "relues": 0}
    assert ind["types"] == {} and ind["delai_moyen_cloture_s"] is None
    assert all(s["clotures"] == 0 and s["comptes_rendus"] == 0 for s in ind["semaines"])


def test_exige_une_session(client):
    assert client.get(URL).status_code == 401
