"""Fixtures : base recréée à chaque test, fournisseur d'identité de remplacement.

Les tests envoient de vraies requêtes HTTP à l'application (TestClient) sur une
base SQLite en mémoire recréée pour chaque test. Google est remplacé par le
fournisseur factice : il signe localement ses jetons d'identité, que la route
de retour vérifie exactement comme ceux de Google.

Le client parle en HTTPS (`https://testserver`) : sans cela, les cookies
`Secure` ne seraient jamais renvoyés et les tests ne prouveraient rien.
"""
import os

# Avant tout import de `app`.
os.environ["APP_ENV"] = "test"
os.environ["IDENTITY_PROVIDER"] = "fake"
os.environ["GOOGLE_CLIENT_ID"] = "client-panoradent.apps.googleusercontent.com"
os.environ["JWT_SECRET"] = "secret-de-test-suffisamment-long-0123456789"
os.environ["APP_URL"] = "http://localhost:3000"
# bcrypt au coût 4 : mêmes chemins de code, tests rapides (la production exige 12).
os.environ["BCRYPT_COUT"] = "4"
os.environ["COURRIEL_MODE"] = "memoire"

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed_auth
from app.auth_models import Utilisateur
from app.database import Base, get_db
from app.identity import fournisseur
from app.main import app
from app.permissions import ADMIN_ROLE, PRACTITIONER_ROLE, VIEWER_ROLE
from app.services import courriel

ADMIN_EMAIL = "admin@cabinet.example.org"
BASE = "/api/v1"


@pytest.fixture(autouse=True)
def boite():
    """Boîte de réception (COURRIEL_MODE=memoire), vidée avant chaque test."""
    courriel.BOITE.clear()
    yield courriel.BOITE
    courriel.BOITE.clear()


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):  # ON DELETE CASCADE / SET NULL nécessitent ce PRAGMA
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with factory() as db:
        perms = seed_auth.seed_permissions(db)
        roles = seed_auth.seed_roles(db, perms)
        seed_auth.seed_admin(db, roles[ADMIN_ROLE], ADMIN_EMAIL)
        db.commit()
    yield factory
    engine.dispose()


@pytest.fixture()
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture()
def nouveau_client(session_factory):
    """Fabrique de navigateurs indépendants (un pot de cookies chacun)."""
    def _get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    clients = []

    def _nouveau() -> TestClient:
        c = TestClient(app, base_url="https://testserver")
        clients.append(c)
        return c

    yield _nouveau
    for c in clients:
        c.close()
    app.dependency_overrides.clear()


@pytest.fixture()
def client(nouveau_client):
    return nouveau_client()


# --- Parcours de connexion -------------------------------------------------

def demarrer(client: TestClient) -> dict:
    """Appelle /demarrer et renvoie les paramètres de la redirection."""
    r = client.get(f"{BASE}/auth/google/demarrer", follow_redirects=False)
    assert r.status_code == 302, r.text
    return {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}


def connexion(client: TestClient, email: str, *, cle: str = "principale", state=None, **revendications):
    """Parcours complet avec le fournisseur factice. `revendications` surcharge
    le jeton d'identité (aud, exp, nonce, email_verified, sub…). Renvoie la
    réponse de la route de retour (non suivie)."""
    params = demarrer(client)
    fake = fournisseur()
    revendications.setdefault("nonce", params["nonce"])
    claims = fake.revendications(email, **revendications)
    code = fake.emettre_code(claims, params["code_challenge"], cle=cle)
    return client.get(
        f"{BASE}/auth/google/retour",
        params={"code": code, "state": state if state is not None else params["state"]},
        follow_redirects=False,
    )


def erreur(r) -> str | None:
    """Code `?erreur=` d'une redirection de retour (None si succès)."""
    assert r.status_code == 302, r.text
    return parse_qs(urlparse(r.headers["location"]).query).get("erreur", [None])[0]


@pytest.fixture()
def admin(client):
    """Navigateur de l'administrateur, session ouverte."""
    assert erreur(connexion(client, ADMIN_EMAIL)) is None
    return client


@pytest.fixture()
def creer_compte(admin, db):
    """Crée un compte via l'API d'administration ; renvoie son JSON."""
    roles = {r["libelle"]: r["id"] for r in admin.get(f"{BASE}/roles").json()}

    def _creer(email: str, role: str = PRACTITIONER_ROLE, **champs):
        r = admin.post(f"{BASE}/utilisateurs", json={"email": email, "role_id": roles[role], **champs})
        assert r.status_code == 201, r.text
        return r.json()

    return _creer


@pytest.fixture()
def connecte(nouveau_client, creer_compte):
    """Crée un compte du rôle demandé et renvoie un navigateur connecté avec."""
    def _connecte(email: str, role: str = PRACTITIONER_ROLE) -> TestClient:
        creer_compte(email, role)
        c = nouveau_client()
        assert erreur(connexion(c, email)) is None
        return c

    return _connecte


__all__ = [
    "ADMIN_EMAIL", "BASE", "PRACTITIONER_ROLE", "VIEWER_ROLE", "Utilisateur",
    "connexion", "demarrer", "erreur",
]
