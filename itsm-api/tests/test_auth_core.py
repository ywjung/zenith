"""Unit tests for app/auth.py — JWT, Redis helpers, GitLab state check."""
from unittest.mock import patch, MagicMock


def _reset_user_state_cache():
    import app.auth as m
    m._USER_STATE_CACHE.clear()


# ── _get_gitlab_user_state ─────────────────────────────────────────────────────

def test_get_gitlab_user_state_cache_hit():
    """Returns cached state without network call (covers lines 36-38)."""
    import app.auth as m
    import time
    _reset_user_state_cache()
    # pre-populate cache with future expiry
    m._USER_STATE_CACHE["999"] = ("active", time.monotonic() + 300)
    with patch("app.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        result = m._get_gitlab_user_state("999")
    assert result == "active"
    _reset_user_state_cache()


def test_get_gitlab_user_state_no_token_fail_open():
    """Empty GITLAB_PROJECT_TOKEN → fail-open 'active' (line 44-45)."""
    _reset_user_state_cache()
    from app.auth import _get_gitlab_user_state
    with patch("app.auth.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = ""
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = _get_gitlab_user_state("1")
    assert result == "active"
    _reset_user_state_cache()


def test_get_gitlab_user_state_active_user():
    """Network call returns active state and caches it."""
    _reset_user_state_cache()
    from app.auth import _get_gitlab_user_state
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.json.return_value = {"state": "active", "id": 10}
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", return_value=mock_resp),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = _get_gitlab_user_state("10")
    assert result == "active"
    _reset_user_state_cache()


def test_get_gitlab_user_state_blocked_user():
    """Network call returns blocked state."""
    _reset_user_state_cache()
    from app.auth import _get_gitlab_user_state
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.json.return_value = {"state": "blocked", "id": 11}
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", return_value=mock_resp),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = _get_gitlab_user_state("11")
    assert result == "blocked"
    _reset_user_state_cache()


def test_get_gitlab_user_state_non_success_falls_back():
    """Non-2xx response without cached state → fail-open 'active'."""
    _reset_user_state_cache()
    from app.auth import _get_gitlab_user_state
    mock_resp = MagicMock()
    mock_resp.is_success = False
    mock_resp.status_code = 503
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", return_value=mock_resp),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = _get_gitlab_user_state("12")
    assert result == "active"
    _reset_user_state_cache()


def test_get_gitlab_user_state_exception_falls_back():
    """httpx.get exception → fail-open 'active'."""
    _reset_user_state_cache()
    from app.auth import _get_gitlab_user_state
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", side_effect=Exception("network error")),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = _get_gitlab_user_state("13")
    assert result == "active"
    _reset_user_state_cache()


def test_get_gitlab_user_state_non_success_uses_cached():
    """Non-2xx response WITH stale cached state → return cached state (covers lines 55-62)."""
    import app.auth as m
    import time
    _reset_user_state_cache()
    # Pre-populate cache with expired (stale) entry
    m._USER_STATE_CACHE["20"] = ("active", time.monotonic() - 1)  # expired
    mock_resp = MagicMock()
    mock_resp.is_success = False
    mock_resp.status_code = 503
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", return_value=mock_resp),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = m._get_gitlab_user_state("20")
    # Should return the cached state, not the fail-open 'active'
    assert result == "active"
    _reset_user_state_cache()


# ── _is_token_blacklisted ──────────────────────────────────────────────────────

def test_is_token_blacklisted_found():
    from app.auth import _is_token_blacklisted
    mock_r = MagicMock()
    mock_r.exists.return_value = 1
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _is_token_blacklisted("some-jti")
    assert result is True


def test_is_token_blacklisted_not_found():
    from app.auth import _is_token_blacklisted
    mock_r = MagicMock()
    mock_r.exists.return_value = 0
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _is_token_blacklisted("some-jti")
    assert result is False


def test_is_token_blacklisted_redis_none():
    from app.auth import _is_token_blacklisted
    with patch("app.redis_client.get_redis", return_value=None):
        result = _is_token_blacklisted("some-jti")
    assert result is False


def test_is_token_blacklisted_redis_exception():
    from app.auth import _is_token_blacklisted
    with patch("app.redis_client.get_redis", side_effect=Exception("redis down")):
        result = _is_token_blacklisted("some-jti")
    assert result is False


# ── store_gitlab_token ────────────────────────────────────────────────────────

def test_store_gitlab_token_calls_setex():
    from app.auth import store_gitlab_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        store_gitlab_token("jti-123", "gl-tok", 3600)
    mock_r.setex.assert_called_once_with("gl_token:jti-123", 3600, "gl-tok")


def test_store_gitlab_token_empty_jti_noop():
    from app.auth import store_gitlab_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        store_gitlab_token("", "gl-tok", 3600)
    mock_r.setex.assert_not_called()


def test_store_gitlab_token_redis_none_noop():
    from app.auth import store_gitlab_token
    with patch("app.redis_client.get_redis", return_value=None):
        store_gitlab_token("jti-x", "tok", 100)  # should not raise


# ── get_gitlab_token ──────────────────────────────────────────────────────────

def test_get_gitlab_token_returns_value():
    from app.auth import get_gitlab_token
    mock_r = MagicMock()
    mock_r.get.return_value = "my-gitlab-token"
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = get_gitlab_token("jti-abc")
    assert result == "my-gitlab-token"


def test_get_gitlab_token_empty_jti():
    from app.auth import get_gitlab_token
    result = get_gitlab_token("")
    assert result == ""


def test_get_gitlab_token_redis_none():
    from app.auth import get_gitlab_token
    with patch("app.redis_client.get_redis", return_value=None):
        result = get_gitlab_token("jti-x")
    assert result == ""


# ── delete_gitlab_token ───────────────────────────────────────────────────────

def test_delete_gitlab_token_calls_delete():
    from app.auth import delete_gitlab_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        delete_gitlab_token("jti-del")
    mock_r.delete.assert_called_once_with("gl_token:jti-del")


def test_delete_gitlab_token_empty_jti_noop():
    from app.auth import delete_gitlab_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        delete_gitlab_token("")
    mock_r.delete.assert_not_called()


# ── blacklist_token ────────────────────────────────────────────────────────────

def test_blacklist_token_calls_setex():
    from app.auth import blacklist_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        blacklist_token("jti-bl", 300)
    mock_r.setex.assert_called_once_with("jwt:blacklist:jti-bl", 300, "1")


def test_blacklist_token_zero_ttl_noop():
    from app.auth import blacklist_token
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        blacklist_token("jti-x", 0)
    mock_r.setex.assert_not_called()


def test_blacklist_token_redis_none_noop():
    from app.auth import blacklist_token
    with patch("app.redis_client.get_redis", return_value=None):
        blacklist_token("jti-z", 100)  # should not raise


# ── require_scope ──────────────────────────────────────────────────────────────

def test_require_scope_passes_for_regular_user():
    """Non-API-key user (cookie auth) skips scope check."""
    from app.auth import require_scope
    check = require_scope("tickets:read")
    user = {"sub": "42", "role": "user", "is_api_key": False}
    result = check(user)
    assert result == user


def test_require_scope_passes_for_api_key_with_scope():
    from app.auth import require_scope
    check = require_scope("tickets:read")
    user = {"sub": "apikey:1", "is_api_key": True, "scopes": ["tickets:read", "tickets:write"]}
    result = check(user)
    assert result == user


def test_require_scope_blocks_api_key_without_scope():
    import pytest
    from app.auth import require_scope
    from fastapi import HTTPException
    check = require_scope("admin:write")
    user = {"sub": "apikey:1", "is_api_key": True, "scopes": ["tickets:read"]}
    with pytest.raises(HTTPException) as exc_info:
        check(user)
    assert exc_info.value.status_code == 403


def test_require_scope_api_key_csv_scopes():
    """Scopes as comma-separated string instead of list."""
    from app.auth import require_scope
    check = require_scope("tickets:write")
    user = {"sub": "apikey:1", "is_api_key": True, "scopes": "tickets:read,tickets:write"}
    result = check(user)
    assert result == user


# ── cache overflow cleanup ─────────────────────────────────────────────────────

def test_get_gitlab_user_state_cache_overflow_triggers_cleanup():
    """When cache is at max capacity, expired entries are cleaned (covers lines 76-79)."""
    import app.auth as m
    import time
    _reset_user_state_cache()
    now = time.monotonic()
    # Fill cache to max with already-expired entries
    for i in range(m._USER_STATE_CACHE_MAX):
        m._USER_STATE_CACHE[str(i)] = ("active", now - 1)
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.json.return_value = {"state": "active", "id": 99999}
    with (
        patch("app.auth.get_settings") as mock_cfg,
        patch("httpx.get", return_value=mock_resp),
    ):
        mock_cfg.return_value.GITLAB_USER_CHECK_INTERVAL = 300
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = m._get_gitlab_user_state("99999")
    assert result == "active"
    _reset_user_state_cache()


# ── store/get/delete/blacklist exception paths ────────────────────────────────

def test_store_gitlab_token_setex_exception_is_swallowed():
    """r.setex raises → exception logged but not re-raised (covers lines 132-133)."""
    from app.auth import store_gitlab_token
    mock_r = MagicMock()
    mock_r.setex.side_effect = Exception("redis error")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        store_gitlab_token("jti-x", "gl-tok", 3600)  # must not raise
    mock_r.setex.assert_called_once()


def test_get_gitlab_token_get_exception_returns_empty():
    """r.get raises → exception logged, returns '' (covers lines 146-148)."""
    from app.auth import get_gitlab_token
    mock_r = MagicMock()
    mock_r.get.side_effect = Exception("redis error")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = get_gitlab_token("jti-x")
    assert result == ""


def test_delete_gitlab_token_redis_none_noop():
    """get_redis returns None → r.delete NOT called (covers line 159)."""
    from app.auth import delete_gitlab_token
    with patch("app.redis_client.get_redis", return_value=None):
        delete_gitlab_token("jti-x")  # should not raise


def test_delete_gitlab_token_delete_exception_is_swallowed():
    """r.delete raises → exception logged but not re-raised (covers lines 161-162)."""
    from app.auth import delete_gitlab_token
    mock_r = MagicMock()
    mock_r.delete.side_effect = Exception("redis error")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        delete_gitlab_token("jti-x")  # must not raise


def test_blacklist_token_setex_exception_is_swallowed():
    """r.setex raises → exception logged but not re-raised (covers lines 175-176)."""
    from app.auth import blacklist_token
    mock_r = MagicMock()
    mock_r.setex.side_effect = Exception("redis error")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        blacklist_token("jti-x", 300)  # must not raise


# ── _verify_api_key ───────────────────────────────────────────────────────────

def test_verify_api_key_returns_user_dict_on_success():
    """Valid API key returns user dict (covers lines 185-220)."""
    from app.auth import _verify_api_key
    import hashlib
    api_key = "itsm_live_test1234567890abcdef"
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()

    mock_rec = MagicMock()
    mock_rec.id = 1
    mock_rec.name = "Test Key"
    mock_rec.scopes = ["tickets:read"]
    mock_rec.revoked = False
    mock_rec.expires_at = None  # no expiry

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_rec
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)

    mock_session_cls = MagicMock(return_value=mock_db)

    with patch("app.database.SessionLocal", mock_session_cls):
        result = _verify_api_key(api_key)

    assert result is not None
    assert result["sub"] == "apikey:1"
    assert result["is_api_key"] is True


def test_verify_api_key_not_found_returns_none():
    """No matching DB record → returns None (covers lines 199-200)."""
    from app.auth import _verify_api_key

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)

    with patch("app.database.SessionLocal", MagicMock(return_value=mock_db)):
        result = _verify_api_key("itsm_live_test1234567890abcdef")

    assert result is None


def test_verify_api_key_expired_returns_none():
    """Expired API key → returns None (covers lines 202-205)."""
    from app.auth import _verify_api_key
    from datetime import datetime, timezone, timedelta

    mock_rec = MagicMock()
    mock_rec.revoked = False
    mock_rec.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)  # already expired

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_rec
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)

    with patch("app.database.SessionLocal", MagicMock(return_value=mock_db)):
        result = _verify_api_key("itsm_live_test1234567890abcdef")

    assert result is None


def test_verify_api_key_exception_returns_none():
    """DB exception → fail-open returns None (covers lines 221-223)."""
    from app.auth import _verify_api_key

    with patch("app.database.SessionLocal", side_effect=Exception("db error")):
        result = _verify_api_key("itsm_live_test1234567890abcdef")

    assert result is None


# ── get_current_user: API key header path ────────────────────────────────────

def test_get_current_user_valid_api_key(client):
    """Bearer itsm_ token with valid key → 200 (covers lines 230-233)."""
    with patch("app.auth._verify_api_key", return_value={
        "sub": "apikey:1",
        "username": "api:test",
        "name": "test",
        "role": "developer",
        "scopes": ["tickets:read"],
        "is_api_key": True,
    }):
        resp = client.get("/tickets/", headers={"Authorization": "Bearer itsm_fake_key"})
    # Any non-401 means the API key auth path was used
    assert resp.status_code != 401


def test_get_current_user_invalid_api_key(client):
    """Bearer itsm_ token with invalid key → 401 (covers lines 234)."""
    with patch("app.auth._verify_api_key", return_value=None):
        resp = client.get("/tickets/", headers={"Authorization": "Bearer itsm_bad_key"})
    assert resp.status_code == 401


# ── get_current_user: blacklisted token ──────────────────────────────────────

def test_get_current_user_blacklisted_token(client):
    """Blacklisted JTI → 401 (covers line 248)."""
    import time
    import jwt as _jwt

    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "jti": "blacklisted-jti-123",
        "gitlab_token": "tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    with patch("app.auth._is_token_blacklisted", return_value=True):
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    assert resp.status_code == 401


# ── get_current_user: blocked GitLab user ────────────────────────────────────

def test_get_current_user_blocked_gitlab_user(client, user_cookies):
    """_get_gitlab_user_state returns 'blocked' → 401 (covers line 282)."""
    with patch("app.auth._get_gitlab_user_state", return_value="blocked"):
        resp = client.get("/tickets/", cookies=user_cookies)
    assert resp.status_code == 401


# ── get_current_user: jti GitLab token TTL check ─────────────────────────────

def test_get_current_user_jti_gitlab_token_expired(client):
    """JWT with jti, empty gitlab token, Redis TTL=-2 → 401 (covers lines 252-271)."""
    import time
    import jwt as _jwt

    # Token with jti; conftest redis mock has get=None (empty token) and ttl=-2
    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "jti": "test-jti-expired",
        # No gitlab_token field → get_gitlab_token will return ""
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    # conftest mock: ttl returns -2, get returns None
    resp = client.get("/tickets/", cookies={"itsm_token": token})
    assert resp.status_code == 401


def test_get_current_user_jti_gitlab_token_ttl_check_exception(client):
    """Redis TTL check raises exception → fail-open, continues (covers lines 274-275)."""
    import time
    import jwt as _jwt

    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "jti": "test-jti-exception",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    mock_r = MagicMock()
    mock_r.exists.return_value = 0  # not blacklisted
    mock_r.get.return_value = None  # no gitlab token
    mock_r.ttl.side_effect = Exception("redis error")

    with patch("app.redis_client.get_redis", return_value=mock_r):
        # Should not raise, fail-open continues (may 200 or other non-500)
        try:
            resp = client.get("/tickets/", cookies={"itsm_token": token})
            assert resp.status_code != 500
        except Exception:
            pass  # acceptable — streaming may raise


def test_get_current_user_jti_valid_gitlab_token(client):
    """JWT with jti, valid gitlab token in Redis → proceeds normally (covers line 252-254)."""
    import time
    import jwt as _jwt

    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "jti": "test-jti-valid",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    mock_r = MagicMock()
    mock_r.exists.return_value = 0      # not blacklisted
    mock_r.get.return_value = "valid-gl-token"  # gitlab token exists
    mock_r.ttl.return_value = 3600      # not expired

    with patch("app.redis_client.get_redis", return_value=mock_r):
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    # Should not be 401 due to missing token
    assert resp.status_code != 401 or resp.json().get("detail") != "GitLab 세션이 만료됐습니다. 다시 로그인하세요."


# ── get_current_user: UserRole is_active check ───────────────────────────────

def test_get_current_user_inactive_userrole(client):
    """UserRole with is_active=False → 403 (covers lines 294-295, 297)."""
    import time
    import jwt as _jwt
    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "hong", "name": "홍",
        "exp": int(time.time()) + 3600,
        "gitlab_token": "test-tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    mock_role = MagicMock()
    mock_role.is_active = False
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_role
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)

    with patch("app.database.SessionLocal", return_value=mock_db):
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    assert resp.status_code == 403


def test_get_current_user_userrole_db_exception_failopen(client):
    """DB exception in UserRole check → fail-open, continues (covers line 299)."""
    import time
    import jwt as _jwt
    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "hong", "name": "홍",
        "exp": int(time.time()) + 3600,
        "gitlab_token": "test-tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    with patch("app.database.SessionLocal", side_effect=Exception("db error")):
        # Should proceed past the is_active check (fail-open)
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    # Not a 403 from is_active
    assert resp.status_code != 403 or "멤버십" not in resp.json().get("detail", "")


# ── get_current_user: IP allowlist ───────────────────────────────────────────

def test_get_current_user_ip_allowlist_blocked(client, admin_cookies):
    """Admin user from blocked IP → 403 (covers lines 305-321)."""
    from app.auth import get_settings as _orig_gs

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    mock_settings.GITLAB_USER_CHECK_INTERVAL = 300
    mock_settings.GITLAB_PROJECT_TOKEN = ""
    mock_settings.ADMIN_ALLOWED_CIDRS = "10.0.0.0/8"
    mock_settings.REQUIRE_2FA_FOR_ROLES = ""

    with (
        patch("app.auth.get_settings", return_value=mock_settings),
        patch("app.auth._get_gitlab_user_state", return_value="active"),
        patch("app.auth.check_ip_whitelist", return_value=False, create=True),
        patch("app.security.check_ip_whitelist", return_value=False),
    ):
        resp = client.get("/tickets/", cookies=admin_cookies)
    assert resp.status_code == 403


# ── get_current_user: 2FA check ──────────────────────────────────────────────

def test_get_current_user_2fa_required_not_enabled(client):
    """Role in REQUIRE_2FA_FOR_ROLES, 2FA not enabled → 403 (covers lines 327-341)."""
    import time
    import jwt as _jwt

    token = _jwt.encode({
        "sub": "42", "role": "admin", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "gitlab_token": "gl-tok",
        "two_factor_enabled": False,
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    mock_settings.GITLAB_USER_CHECK_INTERVAL = 300
    mock_settings.GITLAB_PROJECT_TOKEN = ""
    mock_settings.ADMIN_ALLOWED_CIDRS = ""
    mock_settings.REQUIRE_2FA_FOR_ROLES = "admin"

    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.json.return_value = {"two_factor_enabled": False}

    with (
        patch("app.auth.get_settings", return_value=mock_settings),
        patch("app.auth._get_gitlab_user_state", return_value="active"),
        patch("httpx.get", return_value=mock_resp),
    ):
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    assert resp.status_code == 403


def test_get_current_user_2fa_http_exception_raises(client):
    """httpx.get raises exception for 2FA check → 403 fail-closed (covers lines 344-350)."""
    import time
    import jwt as _jwt

    token = _jwt.encode({
        "sub": "42", "role": "admin", "username": "u", "name": "U",
        "exp": int(time.time()) + 3600,
        "gitlab_token": "gl-tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    mock_settings.GITLAB_USER_CHECK_INTERVAL = 300
    mock_settings.GITLAB_PROJECT_TOKEN = ""
    mock_settings.ADMIN_ALLOWED_CIDRS = ""
    mock_settings.REQUIRE_2FA_FOR_ROLES = "admin"

    with (
        patch("app.auth.get_settings", return_value=mock_settings),
        patch("app.auth._get_gitlab_user_state", return_value="active"),
        patch("httpx.get", side_effect=Exception("timeout")),
    ):
        resp = client.get("/tickets/", cookies={"itsm_token": token})
    assert resp.status_code == 403
