"""Unit tests for auth router utility functions: IP extraction, role mapping, sync."""
from unittest.mock import patch, MagicMock


# ── _extract_client_ip ────────────────────────────────────────────────────────

def test_extract_client_ip_direct_no_forwarded():
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client.host = "203.0.113.1"
    mock_req.headers.get.return_value = ""  # no X-Forwarded-For
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = ""
        result = _extract_client_ip(mock_req)
    assert result == "203.0.113.1"


def test_extract_client_ip_unknown_client():
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client = None
    mock_req.headers.get.return_value = "1.2.3.4"
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = ""
        result = _extract_client_ip(mock_req)
    assert result == "unknown"


def test_extract_client_ip_private_proxy_trusts_forwarded():
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client.host = "192.168.1.1"  # private → trusted
    mock_req.headers.get.return_value = "203.0.113.5, 192.168.1.1"
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = ""
        result = _extract_client_ip(mock_req)
    assert result == "203.0.113.5"


def test_extract_client_ip_public_proxy_not_trusted():
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client.host = "8.8.8.8"  # public IP → not trusted by default
    mock_req.headers.get.return_value = "10.0.0.1"
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = ""
        result = _extract_client_ip(mock_req)
    assert result == "8.8.8.8"


def test_extract_client_ip_trusted_cidr():
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client.host = "10.0.1.5"
    mock_req.headers.get.return_value = "203.0.113.99"
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = "10.0.0.0/8"
        result = _extract_client_ip(mock_req)
    assert result == "203.0.113.99"


# ── _gitlab_access_to_itsm_role ───────────────────────────────────────────────

def test_gitlab_access_to_itsm_role_owner():
    from app.routers.auth import _gitlab_access_to_itsm_role
    assert _gitlab_access_to_itsm_role(50) == "admin"


def test_gitlab_access_to_itsm_role_maintainer():
    from app.routers.auth import _gitlab_access_to_itsm_role
    assert _gitlab_access_to_itsm_role(40) == "admin"


def test_gitlab_access_to_itsm_role_developer():
    from app.routers.auth import _gitlab_access_to_itsm_role
    assert _gitlab_access_to_itsm_role(30) == "agent"


def test_gitlab_access_to_itsm_role_reporter():
    from app.routers.auth import _gitlab_access_to_itsm_role
    assert _gitlab_access_to_itsm_role(20) == "user"


def test_gitlab_access_to_itsm_role_guest():
    from app.routers.auth import _gitlab_access_to_itsm_role
    assert _gitlab_access_to_itsm_role(10) == "user"


# ── _fetch_max_access_level ───────────────────────────────────────────────────

def test_fetch_max_access_level_admin_user_returns_50():
    from app.routers.auth import _fetch_max_access_level
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.json.return_value = {"is_admin": True}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.routers.auth.get_settings") as mock_cfg,
        patch("httpx.Client", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = _fetch_max_access_level(1)
    assert result == 50


def test_fetch_max_access_level_from_memberships():
    from app.routers.auth import _fetch_max_access_level
    user_resp = MagicMock()
    user_resp.is_success = True
    user_resp.json.return_value = {"is_admin": False}
    member_resp = MagicMock()
    member_resp.is_success = True
    member_resp.json.return_value = [{"access_level": 40}, {"access_level": 30}]
    mock_client = MagicMock()
    mock_client.get.side_effect = [user_resp, member_resp]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.routers.auth.get_settings") as mock_cfg,
        patch("httpx.Client", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = _fetch_max_access_level(2)
    assert result == 40


def test_fetch_max_access_level_empty_memberships():
    from app.routers.auth import _fetch_max_access_level
    user_resp = MagicMock()
    user_resp.is_success = True
    user_resp.json.return_value = {"is_admin": False}
    member_resp = MagicMock()
    member_resp.is_success = True
    member_resp.json.return_value = []  # no memberships
    mock_client = MagicMock()
    mock_client.get.side_effect = [user_resp, member_resp]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.routers.auth.get_settings") as mock_cfg,
        patch("httpx.Client", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = _fetch_max_access_level(3)
    assert result == 0


def test_fetch_max_access_level_exception_returns_zero():
    from app.routers.auth import _fetch_max_access_level
    mock_ctx = MagicMock()
    mock_ctx.__enter__.side_effect = Exception("timeout")
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.routers.auth.get_settings") as mock_cfg,
        patch("httpx.Client", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = _fetch_max_access_level(99)
    assert result == 0


def test_fetch_max_access_level_membership_api_fails():
    from app.routers.auth import _fetch_max_access_level
    user_resp = MagicMock()
    user_resp.is_success = True
    user_resp.json.return_value = {"is_admin": False}
    member_resp = MagicMock()
    member_resp.is_success = False  # API failed
    mock_client = MagicMock()
    mock_client.get.side_effect = [user_resp, member_resp]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.routers.auth.get_settings") as mock_cfg,
        patch("httpx.Client", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = _fetch_max_access_level(4)
    assert result == 0


# ── _sync_role_from_gitlab ────────────────────────────────────────────────────

def test_sync_role_creates_new_record_when_none_exists():
    from app.routers.auth import _sync_role_from_gitlab
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    with patch("app.routers.auth._fetch_max_access_level", return_value=40):
        role = _sync_role_from_gitlab(mock_db, 10, "alice", name="Alice", avatar_url="https://img")
    assert role == "admin"
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()


def test_sync_role_updates_existing_record():
    from app.routers.auth import _sync_role_from_gitlab
    from app.models import UserRole
    existing = MagicMock(spec=UserRole)
    existing.role = "user"
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = existing

    with patch("app.routers.auth._fetch_max_access_level", return_value=30):
        role = _sync_role_from_gitlab(mock_db, 11, "bob")
    assert role == "agent"
    assert existing.role == "agent"


def test_sync_role_gitlab_fails_uses_existing_role():
    from app.routers.auth import _sync_role_from_gitlab
    from app.models import UserRole
    existing = MagicMock(spec=UserRole)
    existing.role = "admin"
    existing.name = "Bob"
    existing.avatar_url = "https://img"
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = existing

    with patch("app.routers.auth._fetch_max_access_level", return_value=0):
        role = _sync_role_from_gitlab(mock_db, 12, "bob")
    assert role == "admin"
    # Existing record with name already set — no commit for name update
    mock_db.add.assert_not_called()


def test_sync_role_gitlab_fails_creates_user_role_when_no_record():
    from app.routers.auth import _sync_role_from_gitlab
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    with patch("app.routers.auth._fetch_max_access_level", return_value=0):
        role = _sync_role_from_gitlab(mock_db, 13, "carol")
    assert role == "user"
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()


def test_sync_role_updates_name_when_previously_empty():
    from app.routers.auth import _sync_role_from_gitlab
    from app.models import UserRole
    existing = MagicMock(spec=UserRole)
    existing.role = "user"
    existing.name = None  # was empty
    existing.avatar_url = None
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = existing

    with patch("app.routers.auth._fetch_max_access_level", return_value=0):
        role = _sync_role_from_gitlab(mock_db, 14, "dave", name="Dave", avatar_url="https://avatar")
    # Updates name and avatar_url
    assert existing.name == "Dave"
    assert existing.avatar_url == "https://avatar"
    mock_db.commit.assert_called_once()


# ── /auth/login endpoint ──────────────────────────────────────────────────────

def test_login_redirects_to_gitlab(client):
    resp = client.get("/auth/login", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "oauth/authorize" in resp.headers.get("location", "")


def test_login_sets_state_cookie(client):
    resp = client.get("/auth/login", follow_redirects=False)
    # oauth_state cookie should be set
    assert "oauth_state" in resp.cookies or "oauth_state" in resp.headers.get("set-cookie", "")


# ── /auth/callback endpoint ───────────────────────────────────────────────────

def test_callback_no_code_redirects_to_login(client):
    resp = client.get("/auth/callback?error=access_denied", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "access_denied" in resp.headers.get("location", "")


def test_callback_csrf_mismatch_redirects(client):
    """Missing or mismatched oauth_state cookie → redirect to /login?error=csrf."""
    resp = client.get("/auth/callback?code=abc&state=wrongstate", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert "csrf" in resp.headers.get("location", "")


def test_callback_gitlab_token_exchange_fails(client):
    """GitLab token exchange fails → redirect to /login?error=token_exchange."""
    mock_resp = MagicMock()
    mock_resp.is_success = False
    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "test_state_value"
    with patch("httpx.Client", return_value=mock_ctx):
        resp = client.get(
            f"/auth/callback?code=mycode&state={state}",
            cookies={"oauth_state": state},
            follow_redirects=False,
        )
    assert resp.status_code in (302, 307)
    assert "token_exchange" in resp.headers.get("location", "")


def test_callback_user_info_fails(client):
    """GitLab user info GET fails → redirect to /login?error=user_info."""
    token_resp = MagicMock()
    token_resp.is_success = True
    token_resp.json.return_value = {"access_token": "tok", "refresh_token": "ref"}
    user_resp = MagicMock()
    user_resp.is_success = False

    mock_client = MagicMock()
    mock_client.post.return_value = token_resp
    mock_client.get.return_value = user_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "test_state_userinfoerr"
    with patch("httpx.Client", return_value=mock_ctx):
        resp = client.get(
            f"/auth/callback?code=mycode&state={state}",
            cookies={"oauth_state": state},
            follow_redirects=False,
        )
    assert resp.status_code in (302, 307)
    assert "user_info" in resp.headers.get("location", "")


def test_callback_success_redirects_to_home(client):
    """Full callback success: token exchange + user info → redirect to / and set cookies
    (covers lines 255-295 + _create_refresh_token 161-196)."""
    token_resp = MagicMock()
    token_resp.is_success = True
    token_resp.json.return_value = {"access_token": "gl-access-tok", "refresh_token": "gl-ref-tok"}
    user_resp = MagicMock()
    user_resp.is_success = True
    user_resp.json.return_value = {
        "id": 99, "username": "test_user", "name": "Test User",
        "email": "test@example.com", "avatar_url": None,
    }

    mock_client = MagicMock()
    mock_client.post.return_value = token_resp
    mock_client.get.return_value = user_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "test_success_state"
    with (
        patch("httpx.Client", return_value=mock_ctx),
        patch("app.routers.auth._fetch_max_access_level", return_value=30),
    ):
        resp = client.get(
            f"/auth/callback?code=mycode&state={state}",
            cookies={"oauth_state": state},
            follow_redirects=False,
        )
    assert resp.status_code in (302, 307)
    location = resp.headers.get("location", "")
    assert "error" not in location


# ── /auth/exchange endpoint ───────────────────────────────────────────────────

def test_exchange_csrf_mismatch(client):
    """Missing or wrong oauth_state cookie → 400."""
    resp = client.post(
        "/auth/exchange",
        json={"code": "mycode", "state": "wrongstate"},
        follow_redirects=False,
    )
    assert resp.status_code == 400


def test_exchange_token_fails(client):
    """Token exchange failure → 400."""
    token_resp = MagicMock()
    token_resp.is_success = False
    mock_client = MagicMock()
    mock_client.post.return_value = token_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "ex_state_1"
    with patch("httpx.Client", return_value=mock_ctx):
        resp = client.post(
            "/auth/exchange",
            json={"code": "mycode", "state": state},
            cookies={"oauth_state": state},
        )
    assert resp.status_code == 400


def test_exchange_user_info_fails(client):
    """User info GET fails → 400."""
    token_resp = MagicMock()
    token_resp.is_success = True
    token_resp.json.return_value = {"access_token": "tok", "refresh_token": "ref"}
    user_resp = MagicMock()
    user_resp.is_success = False
    mock_client = MagicMock()
    mock_client.post.return_value = token_resp
    mock_client.get.return_value = user_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "ex_state_2"
    with patch("httpx.Client", return_value=mock_ctx):
        resp = client.post(
            "/auth/exchange",
            json={"code": "mycode", "state": state},
            cookies={"oauth_state": state},
        )
    assert resp.status_code == 400


def test_exchange_success(client):
    """Full exchange success → ok:True and cookies set (covers lines 310-361)."""
    token_resp = MagicMock()
    token_resp.is_success = True
    token_resp.json.return_value = {"access_token": "gl-tok", "refresh_token": "gl-ref"}
    user_resp = MagicMock()
    user_resp.is_success = True
    user_resp.json.return_value = {
        "id": 100, "username": "exchange_user", "name": "Exchange User",
        "email": "ex@example.com", "avatar_url": None,
    }
    mock_client = MagicMock()
    mock_client.post.return_value = token_resp
    mock_client.get.return_value = user_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    state = "ex_state_ok"
    with (
        patch("httpx.Client", return_value=mock_ctx),
        patch("app.routers.auth._fetch_max_access_level", return_value=30),
    ):
        resp = client.post(
            "/auth/exchange",
            json={"code": "mycode", "state": state},
            cookies={"oauth_state": state},
        )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── _extract_client_ip: invalid IP host ──────────────────────────────────────

def test_extract_client_ip_invalid_host_returns_host():
    """Non-IP client host → ValueError → returns host unchanged (covers lines 53-54)."""
    from app.routers.auth import _extract_client_ip
    mock_req = MagicMock()
    mock_req.client.host = "invalid_hostname"
    mock_req.headers.get.return_value = "1.2.3.4"
    with patch("app.routers.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.TRUSTED_PROXIES = ""
        result = _extract_client_ip(mock_req)
    assert result == "invalid_hostname"


# ── _sync_role_from_gitlab: update name+avatar on existing record ─────────────

def test_sync_role_updates_name_and_avatar_on_existing():
    """access_level > 0, record exists, name+avatar_url provided → updates them (covers 126, 128)."""
    import pytest
    from app.routers.auth import _sync_role_from_gitlab
    from app.models import UserRole
    existing = MagicMock(spec=UserRole)
    existing.role = "user"
    existing.name = None
    existing.avatar_url = None
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = existing

    with patch("app.routers.auth._fetch_max_access_level", return_value=30):
        role = _sync_role_from_gitlab(mock_db, 15, "eve", name="Eve", avatar_url="https://av")
    assert role == "agent"
    assert existing.name == "Eve"
    assert existing.avatar_url == "https://av"


def test_sync_role_db_commit_fails_rollback():
    """DB commit raises → rollback called, exception propagated (covers 131-134)."""
    import pytest
    from app.routers.auth import _sync_role_from_gitlab
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None
    mock_db.commit.side_effect = Exception("DB error")

    with (
        patch("app.routers.auth._fetch_max_access_level", return_value=30),
        pytest.raises(Exception, match="DB error"),
    ):
        _sync_role_from_gitlab(mock_db, 16, "frank")
    mock_db.rollback.assert_called_once()


# ── /auth/me endpoint ─────────────────────────────────────────────────────────

def test_me_returns_user_info(client, user_cookies):
    """Authenticated /auth/me returns user fields."""
    resp = client.get("/auth/me", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "username" in data
    assert "role" in data


# ── /auth/logout with refresh token revocation ────────────────────────────────

def test_logout_revokes_refresh_token(client, user_cookies, db_session):
    """Logout with valid itsm_refresh cookie revokes RefreshToken record (covers 503-505)."""
    import hashlib
    from app.models import RefreshToken
    from datetime import datetime, timezone, timedelta

    raw = "test-refresh-token-value"
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    rt = RefreshToken(
        token_hash=token_hash,
        gitlab_user_id="42",
        expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).replace(tzinfo=None),
        revoked=False,
    )
    db_session.add(rt)
    db_session.commit()

    resp = client.post(
        "/auth/logout",
        cookies={**user_cookies, "itsm_refresh": raw},
        follow_redirects=False,
    )
    assert resp.status_code in (302, 303, 307)
    db_session.refresh(rt)
    assert rt.revoked is True


def test_logout_without_valid_token(client):
    """Logout without any auth cookies → still redirects to /login."""
    resp = client.post("/auth/logout", follow_redirects=False)
    assert resp.status_code in (302, 303, 307)


# ── /auth/refresh endpoint ────────────────────────────────────────────────────

def test_refresh_no_cookie_returns_401(client):
    """No itsm_refresh cookie → 401."""
    resp = client.post("/auth/refresh")
    assert resp.status_code == 401


def test_refresh_invalid_token_returns_401(client):
    """Non-existent refresh token → 401."""
    resp = client.post("/auth/refresh", cookies={"itsm_refresh": "nonexistent"})
    assert resp.status_code == 401


def test_refresh_expired_token_returns_401(client, db_session):
    """Expired RefreshToken → 401."""
    import hashlib
    from app.models import RefreshToken
    from datetime import datetime, timezone, timedelta

    raw = "expired-refresh-token"
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    rt = RefreshToken(
        token_hash=token_hash,
        gitlab_user_id="42",
        expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).replace(tzinfo=None),
        revoked=False,
    )
    db_session.add(rt)
    db_session.commit()

    resp = client.post("/auth/refresh", cookies={"itsm_refresh": raw})
    assert resp.status_code == 401


def test_refresh_success(client, db_session):
    """Valid refresh token → issues new token pair (covers lines 372-470)."""
    import hashlib
    from app.models import RefreshToken, UserRole
    from datetime import datetime, timezone, timedelta

    # Create user role record
    role_rec = UserRole(gitlab_user_id=42, username="hong", name="홍길동", role="user", is_active=True)
    db_session.add(role_rec)

    raw = "valid-refresh-token-test"
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    rt = RefreshToken(
        token_hash=token_hash,
        gitlab_user_id="42",
        expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).replace(tzinfo=None),
        revoked=False,
    )
    db_session.add(rt)
    db_session.commit()

    # GitLab refresh fails gracefully (no gitlab_refresh_token stored)
    resp = client.post("/auth/refresh", cookies={"itsm_refresh": raw})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_refresh_revoked_token_returns_401(client, db_session):
    """Revoked refresh token → 401 (not found because revoked=True)."""
    import hashlib
    from app.models import RefreshToken
    from datetime import datetime, timezone, timedelta

    raw = "revoked-token"
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    rt = RefreshToken(
        token_hash=token_hash,
        gitlab_user_id="42",
        expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).replace(tzinfo=None),
        revoked=True,  # already revoked
    )
    db_session.add(rt)
    db_session.commit()

    resp = client.post("/auth/refresh", cookies={"itsm_refresh": raw})
    assert resp.status_code == 401


# ── /auth/sessions endpoints ──────────────────────────────────────────────────

def test_get_sessions_empty(client, user_cookies):
    """GET /auth/sessions with no tokens returns empty list."""
    resp = client.get("/auth/sessions", cookies=user_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_revoke_session_not_found(client, user_cookies):
    """DELETE /auth/sessions/9999 (nonexistent) → 404."""
    resp = client.delete("/auth/sessions/9999", cookies=user_cookies)
    assert resp.status_code == 404


def test_revoke_session_success(client, user_cookies, db_session):
    """DELETE /auth/sessions/{id} revokes a session (covers lines 601-602)."""
    from app.models import RefreshToken
    from datetime import datetime, timezone, timedelta
    import hashlib

    rt = RefreshToken(
        token_hash=hashlib.sha256(b"some-tok").hexdigest(),
        gitlab_user_id="42",
        expires_at=(datetime.now(timezone.utc) + timedelta(days=7)).replace(tzinfo=None),
        revoked=False,
    )
    db_session.add(rt)
    db_session.commit()

    resp = client.delete(f"/auth/sessions/{rt.id}", cookies=user_cookies)
    assert resp.status_code == 204
    db_session.refresh(rt)
    assert rt.revoked is True
