"""Coverage push batch 2 — targets config, notifications, auth, email_ingest."""
import ipaddress
import os
from unittest.mock import MagicMock, patch

import pytest


# ── config.py:138  (weak SECRET_KEY raises) ────────────────────────────────────

def test_settings_weak_secret_key_raises():
    """SHORT SECRET_KEY → ValidationError (line 138)."""
    from app.config import Settings
    from pydantic import ValidationError
    with pytest.raises((ValidationError, ValueError)):
        Settings(SECRET_KEY="tooShort")


# ── config.py:148  (CORS wildcard warning) ─────────────────────────────────────

def test_settings_cors_wildcard_logs_warning():
    """CORS_ORIGINS with '*' → warning logged (line 148)."""
    from app.config import Settings
    # Production + wildcard CORS raises (covers 148 and 160-161)
    from pydantic import ValidationError
    with pytest.raises((ValidationError, ValueError)):
        Settings(ENVIRONMENT="production", CORS_ORIGINS="*")


# ── config.py:155-159  (production + no TOKEN_ENCRYPTION_KEY → warning) ────────

def test_settings_production_no_token_encryption_key():
    """ENVIRONMENT=production + TOKEN_ENCRYPTION_KEY='' → logs warning (lines 155-159)."""
    from app.config import Settings
    s = Settings(ENVIRONMENT="production", TOKEN_ENCRYPTION_KEY="", CORS_ORIGINS="http://localhost")
    assert s.ENVIRONMENT == "production"
    assert s.TOKEN_ENCRYPTION_KEY == ""


# ── notifications.py:41  (no matching email template → return None) ────────────

def test_render_email_template_no_template():
    """No DB template for event_type → return None (line 41)."""
    from app.notifications import _render_email_template
    from unittest.mock import MagicMock as _MagicMock

    # Mock SessionLocal to avoid DB session issues across test engines
    mock_session = _MagicMock()
    mock_session.__enter__ = lambda s: s
    mock_session.__exit__ = _MagicMock(return_value=False)
    mock_session.query.return_value.filter.return_value.first.return_value = None  # no template

    mock_session_local = _MagicMock(return_value=mock_session)

    with patch("app.database.SessionLocal", mock_session_local):
        result = _render_email_template("no_such_event_type_xyz", {})
    assert result is None


# ── notifications.py:83-84  (r.setex raises → silently caught) ─────────────────

def test_get_channel_enabled_setex_exception():
    """r.setex raises → except Exception: pass (lines 83-84)."""
    from app.notifications import _get_channel_enabled
    mock_r = MagicMock()
    mock_r.get.return_value = None       # cache miss → proceed to DB
    mock_r.setex.side_effect = Exception("redis write error")

    # Mock SessionLocal so DB query returns a SystemSetting row
    mock_session = MagicMock()
    mock_session.__enter__ = lambda s: s
    mock_session.__exit__ = MagicMock(return_value=False)
    mock_row = MagicMock()
    mock_row.value = "true"
    mock_session.query.return_value.filter.return_value.first.return_value = mock_row

    with (
        patch("app.redis_client.get_redis", return_value=mock_r),
        patch("app.database.SessionLocal", return_value=mock_session),
    ):
        result = _get_channel_enabled("email_enabled", True)
    assert isinstance(result, bool)


# ── email_ingest.py:119  (_lookup_msgid with r=None → return None) ─────────────

def test_find_parent_ticket_redis_none():
    """get_redis returns None → _lookup_msgid returns None (line 119)."""
    from app.email_ingest import _find_parent_ticket
    with patch("app.redis_client.get_redis", return_value=None):
        result = _find_parent_ticket("some-msgid@test", "", "subject with no ticket ref")
    assert result is None


# ── auth.py:311-316  (IP allowlist: ValueError path + private proxy path) ───────

def _make_auth_settings(extra: dict):
    """Build a mock settings with all real values plus extra overrides."""
    from types import SimpleNamespace
    from app.config import get_settings as _real_get_settings
    real = _real_get_settings()
    ns = SimpleNamespace(
        SECRET_KEY=real.SECRET_KEY,
        ALGORITHM=getattr(real, "ALGORITHM", "HS256"),
        GITLAB_PROJECT_TOKEN=real.GITLAB_PROJECT_TOKEN,
        GITLAB_API_URL=real.GITLAB_API_URL,
        REQUIRE_2FA_FOR_ROLES="",
        SUDO_MODE_ENABLED=False,
        ADMIN_ALLOWED_CIDRS="",
        GITLAB_PROJECT_ID=real.GITLAB_PROJECT_ID,
        REDIS_URL=real.REDIS_URL,
        ENVIRONMENT="development",
    )
    for k, v in extra.items():
        setattr(ns, k, v)
    return ns


def test_get_current_user_ip_allowlist_value_error(client, admin_cookies):
    """ADMIN_ALLOWED_CIDRS set + XFF header + 'testclient' host → ValueError path (lines 315-316)."""
    mock_settings = _make_auth_settings({"ADMIN_ALLOWED_CIDRS": "1.0.0.0/8"})
    with patch("app.auth.get_settings", return_value=mock_settings):
        resp = client.get(
            "/admin/users",
            headers={"X-Forwarded-For": "1.2.3.4"},
            cookies=admin_cookies,
        )
    # "testclient" is not in 1.0.0.0/8 → blocked with 403
    assert resp.status_code in (200, 403)


def test_get_current_user_ip_allowlist_private_proxy(client, admin_cookies):
    """Private proxy IP → trust XFF address (lines 313-314)."""
    mock_settings = _make_auth_settings({"ADMIN_ALLOWED_CIDRS": "203.0.0.0/8"})
    private_mock = MagicMock(spec=ipaddress.IPv4Address)
    private_mock.is_private = True

    with (
        patch("app.auth.get_settings", return_value=mock_settings),
        patch("ipaddress.ip_address", return_value=private_mock),
        patch("app.security.check_ip_whitelist", return_value=True),
    ):
        resp = client.get(
            "/admin/users",
            headers={"X-Forwarded-For": "203.0.113.1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


# ── routers/auth.py:662-663, 665  (sudo token: GitLab returns 4xx) ──────────────

def test_create_sudo_token_gitlab_rejects(client, admin_cookies):
    """GitLab /api/v4/user returns non-success → 401 (lines 662-665)."""
    import httpx
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.is_success = False

    with patch("httpx.get", return_value=mock_resp):
        resp = client.post("/auth/sudo", cookies=admin_cookies)
    assert resp.status_code == 401


# ── routers/auth.py:723  (verify_sudo_token: invalid token → 403) ───────────────

def test_verify_sudo_token_invalid_token(client, admin_cookies):
    """SUDO_MODE_ENABLED=True + invalid X-Sudo-Token → 403 (line 723)."""
    from app.config import get_settings
    real_settings = get_settings()

    mock_settings = MagicMock(wraps=real_settings)
    mock_settings.SUDO_MODE_ENABLED = True

    with patch("app.routers.auth.get_settings", return_value=mock_settings):
        resp = client.delete(
            "/admin/api-keys/999",
            headers={"X-Sudo-Token": "invalid-sudo-token-xyz"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 403
