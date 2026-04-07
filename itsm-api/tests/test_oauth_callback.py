"""Tests for OAuth login/callback/exchange — GitLab API is mocked via unittest.mock."""
from unittest.mock import MagicMock, patch

import pytest


# ── Fake GitLab responses ─────────────────────────────────────────────────────

FAKE_OAUTH_TOKEN_RESP = {
    "access_token": "gl-fake-access-token",
    "refresh_token": "gl-fake-refresh-token",
    "token_type": "Bearer",
    "expires_in": 7200,
}

FAKE_GITLAB_USER = {
    "id": 99,
    "username": "testuser",
    "name": "Test User",
    "email": "testuser@example.com",
    "avatar_url": "http://gitlab/avatar.png",
}


def _mock_httpx_client(token_resp=None, token_ok=True, user_resp=None, user_ok=True):
    """Return a mock httpx.Client context-manager whose post/get behave as configured."""
    mock_token = MagicMock()
    mock_token.is_success = token_ok
    mock_token.json.return_value = token_resp or FAKE_OAUTH_TOKEN_RESP

    mock_user = MagicMock()
    mock_user.is_success = user_ok
    mock_user.json.return_value = user_resp or FAKE_GITLAB_USER

    mock_client = MagicMock()
    mock_client.post.return_value = mock_token
    mock_client.get.return_value = mock_user
    mock_client.__enter__ = lambda self: mock_client
    mock_client.__exit__ = MagicMock(return_value=False)
    return mock_client


# ── GET /auth/login ──────────────────────────────────────────────────────────


def test_login_redirects_to_gitlab(client):
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.status_code == 307
    location = resp.headers["location"]
    assert "/oauth/authorize" in location
    assert "client_id=" in location
    assert "state=" in location


def test_login_sets_state_cookie(client):
    resp = client.get("/auth/login", follow_redirects=False)
    assert "oauth_state" in resp.cookies


# ── GET /auth/callback ───────────────────────────────────────────────────────


def _callback_with_mocks(client, code="abc123", state=None, cookies=None,
                         token_ok=True, user_ok=True):
    """Helper: call /auth/callback with a valid state cookie and mocked GitLab."""
    # First get a real state cookie from /auth/login
    if cookies is None:
        login_resp = client.get("/auth/login", follow_redirects=False)
        state = login_resp.cookies.get("oauth_state", state or "fake-state")
        cookies = {"oauth_state": state}

    mock_client = _mock_httpx_client(token_ok=token_ok, user_ok=user_ok)
    with patch("app.routers.auth.httpx.Client", return_value=mock_client), \
         patch("app.routers.auth._fetch_max_access_level", return_value=30), \
         patch("app.routers.auth.store_gitlab_token"):
        resp = client.get(
            f"/auth/callback?code={code}&state={state}",
            cookies=cookies,
            follow_redirects=False,
        )
    return resp


def test_callback_success_sets_tokens(client):
    resp = _callback_with_mocks(client)
    # Should redirect to /
    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == "/"
    # Should set itsm_token and itsm_refresh cookies
    assert "itsm_token" in resp.cookies
    assert "itsm_refresh" in resp.cookies


def test_callback_missing_code_redirects_login(client):
    resp = client.get("/auth/callback?error=access_denied", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "error=access_denied" in resp.headers["location"]


def test_callback_empty_code_redirects_login(client):
    resp = client.get("/auth/callback?code=&state=x", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "error=access_denied" in resp.headers["location"]


def test_callback_csrf_state_mismatch(client):
    """State param doesn't match cookie → redirect to /login?error=csrf."""
    resp = client.get(
        "/auth/callback?code=abc&state=wrong-state",
        cookies={"oauth_state": "real-state"},
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    assert "error=csrf" in resp.headers["location"]


def test_callback_no_state_cookie(client):
    """No oauth_state cookie → redirect to /login?error=csrf."""
    resp = client.get(
        "/auth/callback?code=abc&state=something",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    assert "error=csrf" in resp.headers["location"]


def test_callback_gitlab_token_exchange_fails(client):
    resp = _callback_with_mocks(client, token_ok=False)
    assert resp.status_code in (302, 307)
    assert "error=token_exchange" in resp.headers["location"]


def test_callback_gitlab_user_info_fails(client):
    resp = _callback_with_mocks(client, user_ok=False)
    assert resp.status_code in (302, 307)
    assert "error=user_info" in resp.headers["location"]


# ── POST /auth/exchange ──────────────────────────────────────────────────────


def _exchange_with_mocks(client, code="abc123", state=None, cookies=None,
                         token_ok=True, user_ok=True):
    """Helper: call POST /auth/exchange with a valid state cookie and mocked GitLab."""
    if cookies is None:
        login_resp = client.get("/auth/login", follow_redirects=False)
        state = login_resp.cookies.get("oauth_state", state or "fake-state")
        cookies = {"oauth_state": state}

    mock_client = _mock_httpx_client(token_ok=token_ok, user_ok=user_ok)
    with patch("app.routers.auth.httpx.Client", return_value=mock_client), \
         patch("app.routers.auth._fetch_max_access_level", return_value=30), \
         patch("app.routers.auth.store_gitlab_token"):
        resp = client.post(
            "/auth/exchange",
            json={"code": code, "state": state},
            cookies=cookies,
        )
    return resp


def test_exchange_success(client):
    resp = _exchange_with_mocks(client)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "itsm_token" in resp.cookies
    assert "itsm_refresh" in resp.cookies


def test_exchange_csrf_mismatch(client):
    """State in body doesn't match cookie → 400."""
    resp = client.post(
        "/auth/exchange",
        json={"code": "abc", "state": "wrong"},
        cookies={"oauth_state": "real-state"},
    )
    assert resp.status_code == 400
    assert "CSRF" in resp.json()["detail"]


def test_exchange_no_state_cookie(client):
    """No oauth_state cookie → 400."""
    resp = client.post(
        "/auth/exchange",
        json={"code": "abc", "state": "something"},
    )
    assert resp.status_code == 400


def test_exchange_token_exchange_fails(client):
    resp = _exchange_with_mocks(client, token_ok=False)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "token_exchange"


def test_exchange_user_info_fails(client):
    resp = _exchange_with_mocks(client, user_ok=False)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "user_info"
