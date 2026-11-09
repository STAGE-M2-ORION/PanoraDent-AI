import io
from datetime import timedelta

from PIL import Image

from app import auth_security as sec
from app.auth_models import RefreshToken, User, utcnow
from app.permissions import PERMISSIONS
from app.routers import analyses as analyses_router

from .conftest import ADMIN_EMAIL, ADMIN_PASSWORD, bearer, login


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("L", (64, 32), 128).save(buf, format="PNG")
    return buf.getvalue()


# --- Connexion et profil ---------------------------------------------------

def test_login_ok_and_me_returns_admin_with_all_permissions(client):
    r = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["access_token"] and body["refresh_token"]

    me = client.get("/api/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    data = me.json()
    assert data["role"] == "admin"
    assert len(data["permissions"]) == 8 == len(PERMISSIONS)
    assert "hashed_password" not in data


def test_login_is_case_insensitive_on_email(client):
    assert login(client, ADMIN_EMAIL.upper(), ADMIN_PASSWORD).status_code == 200


def test_login_error_is_uniform(client):
    unknown = login(client, "nobody@panoradent.test.dev", "whatever-123")
    wrong = login(client, ADMIN_EMAIL, "wrong-password")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_no_public_registration(client):
    r = client.post("/api/users", json={"email": "x@panoradent.test.dev", "password": "password-123", "role_id": "x"})
    assert r.status_code == 401


# --- Accès protégé ---------------------------------------------------------

def test_routes_require_a_token(client):
    assert client.get("/api/analyses").status_code == 401
    assert client.post("/api/analyses", files={"file": ("a.png", _png(), "image/png")}).status_code == 401
    assert client.get("/api/model/versions").status_code == 401
    assert client.get("/api/users").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_health_stays_public(client):
    assert client.get("/api/health").status_code == 200


def test_garbage_and_refresh_tokens_are_rejected_as_access(client):
    assert client.get("/api/auth/me", headers=bearer("not-a-jwt")).status_code == 401
    refresh = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()["refresh_token"]
    assert client.get("/api/auth/me", headers=bearer(refresh)).status_code == 401


def test_viewer_cannot_create_analysis(client, make_user):
    email, pwd = make_user("viewer", "viewer@panoradent.test.dev")
    h = bearer(login(client, email, pwd).json()["access_token"])
    r = client.post("/api/analyses", headers=h, files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 403
    assert client.get("/api/analyses", headers=h).status_code == 200  # analysis:read
    assert client.get("/api/users", headers=h).status_code == 403


def test_practitioner_analysis_flow_still_works(client, make_user, monkeypatch):
    """Le flux import → anonymisation → inférence → persistance reste intact."""
    stored = {}
    monkeypatch.setattr(analyses_router.storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(analyses_router.storage, "put", lambda k, d, c: stored.setdefault(k, d))
    monkeypatch.setattr(analyses_router.storage, "presigned_url", lambda k, expires=3600: f"http://s3/{k}")

    async def fake_infer(png, name="image.png"):
        return {"mode": "mock", "model_version": "t", "detections": [
            {"label": "tooth", "fdi": 11, "confidence": 0.9, "bbox": [1, 2, 3, 4]}]}

    monkeypatch.setattr(analyses_router.inference_client, "infer", fake_infer)

    email, pwd = make_user("practitioner", "dr@panoradent.test.dev")
    h = bearer(login(client, email, pwd).json()["access_token"])
    r = client.post("/api/analyses", headers=h, files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    analysis = r.json()
    assert analysis["detections"][0]["fdi"] == 11 and stored
    assert client.get(f"/api/analyses/{analysis['id']}", headers=h).status_code == 200
    assert client.get(f"/api/analyses/{analysis['id']}/image", headers=h).status_code == 200


# --- Refresh, rotation, logout ---------------------------------------------

def test_refresh_rotation_invalidates_the_old_token(client):
    first = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()
    r = client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r.status_code == 200
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"]

    # L'ancien est révoqué ; sa réutilisation est refusée…
    assert client.post("/api/auth/refresh", json={"refresh_token": first["refresh_token"]}).status_code == 401
    # …et coupe aussi la nouvelle session (détection de réutilisation).
    assert client.post("/api/auth/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401


def test_refresh_rejects_access_token_and_expired_token(client, db):
    pair = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()
    assert client.post("/api/auth/refresh", json={"refresh_token": pair["access_token"]}).status_code == 401

    stored = db.query(RefreshToken).one()
    stored.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]}).status_code == 401


def test_logout_revokes_all_sessions(client):
    a = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()
    b = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()
    assert client.post("/api/auth/logout", headers=bearer(a["access_token"])).status_code == 204
    for pair in (a, b):
        assert client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]}).status_code == 401


def test_change_password_revokes_sessions_and_changes_login(client):
    pair = login(client, ADMIN_EMAIL, ADMIN_PASSWORD).json()
    h = bearer(pair["access_token"])
    bad = client.post("/api/auth/me/password", headers=h, json={"current_password": "nope-nope", "new_password": "brand-new-pass-1"})
    assert bad.status_code == 400
    ok = client.post("/api/auth/me/password", headers=h, json={"current_password": ADMIN_PASSWORD, "new_password": "brand-new-pass-1"})
    assert ok.status_code == 204
    assert client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]}).status_code == 401
    assert login(client, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 401
    assert login(client, ADMIN_EMAIL, "brand-new-pass-1").status_code == 200


# --- Verrouillage ----------------------------------------------------------

def test_lockout_after_five_failures_then_423(client, db):
    for _ in range(5):
        assert login(client, ADMIN_EMAIL, "wrong-password").status_code == 401
    # Verrouillé : même le bon mot de passe est refusé.
    r = login(client, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 423

    # Le verrou expire.
    user = db.query(User).filter_by(email=ADMIN_EMAIL).one()
    user.locked_until = utcnow() - timedelta(seconds=1)
    db.commit()
    assert login(client, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200


def test_successful_login_resets_failure_counter(client):
    for _ in range(4):
        login(client, ADMIN_EMAIL, "wrong-password")
    assert login(client, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200
    for _ in range(4):
        assert login(client, ADMIN_EMAIL, "wrong-password").status_code == 401
    assert login(client, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 200


# --- Administration des comptes --------------------------------------------

def test_cannot_delete_or_demote_last_admin(client, admin_headers, db, make_user):
    admin = db.query(User).filter_by(email=ADMIN_EMAIL).one()
    # Soi-même : refusé.
    assert client.delete(f"/api/users/{admin.id}", headers=admin_headers).status_code == 400
    # Désactivation et rétrogradation du dernier admin : refusées.
    assert client.patch(f"/api/users/{admin.id}", headers=admin_headers, json={"is_active": False}).status_code == 400
    viewer_role = [r for r in client.get("/api/roles", headers=admin_headers).json() if r["name"] == "viewer"][0]
    assert client.patch(f"/api/users/{admin.id}", headers=admin_headers, json={"role_id": viewer_role["id"]}).status_code == 400

    # Avec un second admin, un admin peut supprimer l'autre — mais pas lui-même.
    make_user("admin", "second@panoradent.test.dev")
    second = db.query(User).filter_by(email="second@panoradent.test.dev").one()
    assert client.delete(f"/api/users/{second.id}", headers=admin_headers).status_code == 204


def test_last_admin_deletion_by_another_admin_is_400(client, db, make_user):
    make_user("admin", "second@panoradent.test.dev", "second-password-1")
    h2 = bearer(login(client, "second@panoradent.test.dev", "second-password-1").json()["access_token"])
    first = db.query(User).filter_by(email=ADMIN_EMAIL).one()
    second = db.query(User).filter_by(email="second@panoradent.test.dev").one()
    assert client.delete(f"/api/users/{first.id}", headers=h2).status_code == 204
    # `second` est maintenant le dernier : même s'il se ciblait, c'est refusé.
    assert client.delete(f"/api/users/{second.id}", headers=h2).status_code == 400


def test_duplicate_email_conflicts_and_email_is_lowercased(client, admin_headers, make_user, db):
    make_user("viewer", "Mixed.Case@panoradent.test.dev")
    assert db.query(User).filter_by(email="mixed.case@panoradent.test.dev").count() == 1
    role = [r for r in client.get("/api/roles", headers=admin_headers).json() if r["name"] == "viewer"][0]
    r = client.post("/api/users", headers=admin_headers, json={
        "email": "MIXED.case@panoradent.test.dev", "password": "password-123", "role_id": role["id"]})
    assert r.status_code == 409


def test_short_password_rejected(client, admin_headers):
    r = client.post("/api/users", headers=admin_headers, json={"email": "a@panoradent.test.dev", "password": "short", "role_id": "x"})
    assert r.status_code == 422


def test_deactivated_user_loses_access_immediately(client, admin_headers, make_user, db):
    email, pwd = make_user("viewer", "v@panoradent.test.dev")
    pair = login(client, email, pwd).json()
    user = db.query(User).filter_by(email=email).one()
    assert client.patch(f"/api/users/{user.id}", headers=admin_headers, json={"is_active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(pair["access_token"])).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]}).status_code == 401
    assert login(client, email, pwd).status_code == 401


# --- Rôles -----------------------------------------------------------------

def test_roles_crud_and_validation(client, admin_headers):
    perms = client.get("/api/permissions", headers=admin_headers).json()
    assert {p["code"] for p in perms} == set(PERMISSIONS)

    bad = client.post("/api/roles", headers=admin_headers, json={"name": "tech", "permissions": ["nope:nope"]})
    assert bad.status_code == 400

    r = client.post("/api/roles", headers=admin_headers, json={"name": "tech", "permissions": ["analysis:read"]})
    assert r.status_code == 201
    role = r.json()
    assert role["permissions"] == ["analysis:read"] and role["is_system"] is False

    # PATCH remplace l'ensemble des permissions.
    upd = client.patch(f"/api/roles/{role['id']}", headers=admin_headers, json={"permissions": ["model:read", "report:generate"]})
    assert upd.json()["permissions"] == ["model:read", "report:generate"]

    assert client.post("/api/roles", headers=admin_headers, json={"name": "tech"}).status_code == 409
    assert client.delete(f"/api/roles/{role['id']}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/roles/{role['id']}", headers=admin_headers).status_code == 404


def test_system_roles_are_protected(client, admin_headers):
    roles = {r["name"]: r for r in client.get("/api/roles", headers=admin_headers).json()}
    assert set(roles) >= {"admin", "practitioner", "viewer"}
    assert len(roles["admin"]["permissions"]) == 8
    assert set(roles["viewer"]["permissions"]) == {"analysis:read", "model:read"}
    for role in roles.values():
        if role["is_system"]:
            assert client.delete(f"/api/roles/{role['id']}", headers=admin_headers).status_code == 400
    assert client.patch(f"/api/roles/{roles['viewer']['id']}", headers=admin_headers, json={"name": "other"}).status_code == 400
    assert client.patch(f"/api/roles/{roles['admin']['id']}", headers=admin_headers, json={"permissions": ["analysis:read"]}).status_code == 400


def test_cannot_delete_role_in_use(client, admin_headers, make_user):
    make_user("viewer", "v@panoradent.test.dev")
    custom = client.post("/api/roles", headers=admin_headers, json={"name": "custom", "permissions": ["analysis:read"]}).json()
    assert client.post("/api/users", headers=admin_headers, json={
        "email": "c@panoradent.test.dev", "password": "password-123", "role_id": custom["id"]}).status_code == 201
    assert client.delete(f"/api/roles/{custom['id']}", headers=admin_headers).status_code == 400


def test_role_permission_change_applies_to_users(client, admin_headers, make_user):
    custom = client.post("/api/roles", headers=admin_headers, json={"name": "custom", "permissions": ["analysis:read"]}).json()
    client.post("/api/users", headers=admin_headers, json={
        "email": "c@panoradent.test.dev", "password": "password-123", "role_id": custom["id"]})
    h = bearer(login(client, "c@panoradent.test.dev", "password-123").json()["access_token"])
    assert client.get("/api/model/versions", headers=h).status_code == 403
    client.patch(f"/api/roles/{custom['id']}", headers=admin_headers, json={"permissions": ["analysis:read", "model:read"]})
    assert client.get("/api/model/versions", headers=h).status_code == 200


def test_role_endpoints_require_role_manage(client, make_user):
    email, pwd = make_user("practitioner", "dr@panoradent.test.dev")
    h = bearer(login(client, email, pwd).json()["access_token"])
    assert client.get("/api/roles", headers=h).status_code == 403
    assert client.get("/api/permissions", headers=h).status_code == 403


# --- Sécurité des primitives ------------------------------------------------

def test_password_hash_handles_long_passwords_and_wrong_input():
    long_pw = "a" * 200
    h = sec.hash_password(long_pw)
    assert sec.verify_password(long_pw, h)
    assert not sec.verify_password("a" * 199, h)  # au-delà de 72 octets, la différence compte
    assert not sec.verify_password("x", "not-a-bcrypt-hash")


def test_tokens_have_expected_claims_and_types():
    access = sec.create_access_token("u1")
    claims = sec.decode_token(access, sec.ACCESS)
    assert claims["sub"] == "u1" and claims["type"] == "access" and {"iat", "exp", "jti"} <= set(claims)
    refresh, jti, exp = sec.create_refresh_token("u1")
    assert sec.decode_token(refresh, sec.REFRESH)["jti"] == jti and exp
    try:
        sec.decode_token(refresh, sec.ACCESS)
    except sec.TokenError:
        pass
    else:
        raise AssertionError("un refresh ne doit pas être accepté comme access")


def test_user_manager_can_list_roles_but_not_edit_them(client, admin_headers, make_user):
    custom = client.post("/api/roles", headers=admin_headers, json={"name": "hr", "permissions": ["user:manage"]}).json()
    client.post("/api/users", headers=admin_headers, json={
        "email": "hr@panoradent.test.dev", "password": "password-123", "role_id": custom["id"]})
    h = bearer(login(client, "hr@panoradent.test.dev", "password-123").json()["access_token"])
    assert client.get("/api/roles", headers=h).status_code == 200
    assert client.post("/api/roles", headers=h, json={"name": "x"}).status_code == 403
    assert client.get("/api/permissions", headers=h).status_code == 403
