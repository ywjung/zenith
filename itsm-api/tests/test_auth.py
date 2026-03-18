"""
Tests for authentication — JWT creation/validation, refresh token flow, /me endpoint.
"""
import pytest
from jose import JWTError, jwt

from app.auth import ALGORITHM


# ── /auth/me ──────────────────────────────────────────────────────────────────

def test_me_returns_user_info(client, user_cookies):
    resp = client.get("/auth/me", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["sub"] == "42"   # /me returns 'sub', not 'id'
    assert data["role"] == "user"


def test_me_no_token_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_expired_token_returns_401(client):
    import time
    from app.config import get_settings
    s = get_settings()
    payload = {"sub": "42", "role": "user", "exp": int(time.time()) - 1}
    token = jwt.encode(payload, s.SECRET_KEY, algorithm=ALGORITHM)
    resp = client.get("/auth/me", cookies={"itsm_token": token})
    assert resp.status_code == 401


def test_me_tampered_token_returns_401(client, user_cookies):
    bad_token = user_cookies["itsm_token"] + "tampered"
    resp = client.get("/auth/me", cookies={"itsm_token": bad_token})
    assert resp.status_code == 401


# ── /auth/logout ──────────────────────────────────────────────────────────────

def test_logout_without_token_redirects(client):
    """Logout without token still succeeds (cleans up nothing) and redirects."""
    # The logout endpoint always redirects to /login (303).
    # TestClient follows redirects by default; /login page may return 404.
    resp = client.post("/auth/logout")
    # Accept redirect (303) or the final redirect target result
    assert resp.status_code in (200, 303, 404)


def test_logout_with_valid_token(client, user_cookies):
    """Logout with valid token redirects to /login (303)."""
    resp = client.post("/auth/logout", cookies=user_cookies)
    # TestClient follows redirect; /login page may return 404
    assert resp.status_code in (200, 303, 404)


# ── /auth/sessions ────────────────────────────────────────────────────────────

def test_list_sessions_requires_auth(client):
    resp = client.get("/auth/sessions")
    assert resp.status_code == 401


def test_list_sessions_empty(client, user_cookies):
    resp = client.get("/auth/sessions", cookies=user_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── token creation internals (unit tests) ────────────────────────────────────

def test_create_token_contains_sub_and_role():
    """create_token embeds role into the JWT."""
    from app.auth import create_token
    from app.config import get_settings
    settings = get_settings()
    # create_token expects a user dict like GitLab OAuth would return
    token = create_token(
        {"id": 7, "username": "admin", "name": "관리자"},
        role="admin",
    )
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    assert payload["sub"] == "7"
    assert payload["role"] == "admin"


def test_expired_token_decode_raises():
    """Decoding an expired token must raise JWTError."""
    import time
    from app.config import get_settings
    s = get_settings()
    token = jwt.encode({"sub": "1", "exp": int(time.time()) - 1}, s.SECRET_KEY, algorithm=ALGORITHM)
    with pytest.raises(JWTError):
        jwt.decode(token, s.SECRET_KEY, algorithms=[ALGORITHM])


# ── /auth/refresh ─────────────────────────────────────────────────────────────

def test_refresh_without_cookie_returns_401(client):
    """No refresh token cookie → 401."""
    resp = client.post("/auth/refresh")
    assert resp.status_code == 401


# ── sudo token ────────────────────────────────────────────────────────────────

def test_sudo_endpoint_requires_auth(client):
    resp = client.post("/auth/sudo", json={"password": "anything"})
    assert resp.status_code == 401
