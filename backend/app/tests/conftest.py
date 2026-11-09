"""Fixtures de test : base SQLite en mémoire, amorçage RBAC, clients HTTP.

Les tests n'ont besoin ni de PostgreSQL, ni de MinIO, ni du service
d'inférence : la base est remplacée via `dependency_overrides` et le
stockage/l'inférence sont simulés là où un test traverse le flux d'analyse.
"""
import os

# Avant tout import de `app` : coût bcrypt minimal pour garder les tests rapides.
os.environ["BCRYPT_ROUNDS"] = "4"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed_auth
from app.auth_models import Role, User
from app.auth_security import hash_password
from app.database import Base, get_db
from app.main import app

ADMIN_EMAIL = "admin@panoradent.test.dev"
ADMIN_PASSWORD = "admin-password-1"


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):  # ON DELETE CASCADE nécessite ce PRAGMA sous SQLite
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    with factory() as db:
        perms = seed_auth.seed_permissions(db)
        roles = seed_auth.seed_roles(db, perms)
        db.add(User(
            email=ADMIN_EMAIL,
            full_name="Admin",
            hashed_password=hash_password(ADMIN_PASSWORD),
            role_id=roles["admin"].id,
        ))
        db.commit()
    yield factory
    engine.dispose()


@pytest.fixture()
def db(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture()
def client(session_factory):
    def _get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def login(client, email, password):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def bearer(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture()
def admin_headers(client):
    r = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, r.text
    return bearer(r.json()["access_token"])


@pytest.fixture()
def make_user(client, db, admin_headers):
    """Crée un utilisateur via l'API admin ; renvoie `(email, password)`."""
    def _make(role_name: str, email: str, password: str = "user-password-1"):
        role = db.query(Role).filter_by(name=role_name).one()
        r = client.post("/api/users", headers=admin_headers, json={
            "email": email, "password": password, "full_name": role_name, "role_id": role.id,
        })
        assert r.status_code == 201, r.text
        return email, password
    return _make
