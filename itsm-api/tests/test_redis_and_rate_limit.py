"""Unit tests for app/redis_client.py and app/rate_limit.py."""
from unittest.mock import patch, MagicMock


# ── redis_client.py ───────────────────────────────────────────────────────────

def _reset_redis_pool():
    import app.redis_client as m
    m._pool = None



def test_scan_delete_with_keys():
    """scan_delete calls r.delete when keys are found (covers line 56)."""
    from app.redis_client import scan_delete
    mock_r = MagicMock()
    # First scan: returns some keys; second: cursor=0, empty
    mock_r.scan.side_effect = [
        (1, ["key:1", "key:2"]),
        (0, []),
    ]
    scan_delete(mock_r, "key:*")
    mock_r.delete.assert_called_once_with("key:1", "key:2")


def test_scan_delete_empty_keys():
    """scan_delete with no matching keys doesn't call delete."""
    from app.redis_client import scan_delete
    mock_r = MagicMock()
    mock_r.scan.return_value = (0, [])
    scan_delete(mock_r, "nokey:*")
    mock_r.delete.assert_not_called()


# ── rate_limit.py ─────────────────────────────────────────────────────────────

def test_get_user_or_ip_with_valid_token():
    """_get_user_or_ip extracts username from JWT cookie (covers lines 32-34)."""
    from app.rate_limit import _get_user_or_ip
    import time
    import jwt as _jwt
    from app.config import get_settings
    settings = get_settings()
    token = _jwt.encode(
        {"sub": "42", "username": "hong", "exp": int(time.time()) + 3600},
        settings.SECRET_KEY, algorithm="HS256",
    )
    mock_request = MagicMock()
    mock_request.cookies.get.return_value = token
    result = _get_user_or_ip(mock_request)
    assert result == "hong"


def test_get_user_or_ip_without_token_returns_ip():
    """_get_user_or_ip falls back to IP when no cookie."""
    from app.rate_limit import _get_user_or_ip
    mock_request = MagicMock()
    mock_request.cookies.get.return_value = ""
    with patch("app.rate_limit.get_remote_address", return_value="192.168.1.1"):
        result = _get_user_or_ip(mock_request)
    assert result == "192.168.1.1"


def test_get_user_or_ip_invalid_token_falls_back():
    """_get_user_or_ip falls back to IP on invalid token (covers except clause)."""
    from app.rate_limit import _get_user_or_ip
    mock_request = MagicMock()
    mock_request.cookies.get.return_value = "invalid.token.here"
    with patch("app.rate_limit.get_remote_address", return_value="10.0.0.1"):
        result = _get_user_or_ip(mock_request)
    assert result == "10.0.0.1"


def test_get_login_username_from_body():
    """_get_login_username reads username from request body (covers lines 42-53)."""
    from app.rate_limit import _get_login_username
    import json
    body = json.dumps({"username": "Admin@EXAMPLE.COM"}).encode()
    mock_request = MagicMock()
    mock_request._body = body
    result = _get_login_username(mock_request)
    assert result == "login_user:admin@example.com"


def test_get_login_username_from_email_field():
    """_get_login_username uses email field as fallback."""
    from app.rate_limit import _get_login_username
    import json
    body = json.dumps({"email": "user@example.com"}).encode()
    mock_request = MagicMock()
    mock_request._body = body
    result = _get_login_username(mock_request)
    assert result == "login_user:user@example.com"


def test_get_login_username_no_body_returns_ip():
    """_get_login_username falls back to IP when no body (covers line 56)."""
    from app.rate_limit import _get_login_username
    mock_request = MagicMock(spec=[])  # no _body attribute
    with patch("app.rate_limit.get_remote_address", return_value="1.2.3.4"):
        result = _get_login_username(mock_request)
    assert result == "login_ip:1.2.3.4"


def test_get_login_username_invalid_json_falls_back():
    """Invalid JSON in body causes exception → fallback to IP (covers lines 54-55)."""
    from app.rate_limit import _get_login_username
    mock_request = MagicMock()
    mock_request._body = b"not valid json!!!"
    with patch("app.rate_limit.get_remote_address", return_value="5.5.5.5"):
        result = _get_login_username(mock_request)
    assert result == "login_ip:5.5.5.5"


def test_get_login_username_empty_username_returns_ip():
    """Empty username in body falls back to IP."""
    from app.rate_limit import _get_login_username
    import json
    body = json.dumps({"username": ""}).encode()
    mock_request = MagicMock()
    mock_request._body = body
    with patch("app.rate_limit.get_remote_address", return_value="9.9.9.9"):
        result = _get_login_username(mock_request)
    assert result == "login_ip:9.9.9.9"


def test_redis_url_fallback_on_settings_error():
    """_redis_url returns 'memory://' when settings raise (covers lines 61-62)."""
    from app.rate_limit import _redis_url
    with patch("app.rate_limit._get_settings", side_effect=Exception("config error")):
        result = _redis_url()
    assert result == "memory://"


# ── redis_client.py: get_redis() ────────────────────────────────────────────

def _stop_global_redis_patch():
    """Temporarily stop the conftest global get_redis patch."""
    import tests.conftest as c
    for p in c._redis_patches:
        p.stop()


def _start_global_redis_patch():
    """Re-start the conftest global get_redis patch."""
    import tests.conftest as c
    for p in c._redis_patches:
        p.start()


def test_get_redis_creates_pool_and_returns_client():
    """get_redis() creates ConnectionPool and returns a Redis client (lines 30-44)."""
    import app.redis_client as m
    import redis as _redis_mod

    _stop_global_redis_patch()
    _reset_redis_pool()

    mock_pool = MagicMock()
    mock_client = MagicMock()
    mock_client.ping.return_value = True

    try:
        with patch.object(_redis_mod.ConnectionPool, "from_url", return_value=mock_pool):
            with patch.object(_redis_mod, "Redis", return_value=mock_client):
                result = m.get_redis()
        assert result is mock_client
        mock_client.ping.assert_called_once()
    finally:
        _reset_redis_pool()
        _start_global_redis_patch()


def test_get_redis_returns_none_on_ping_failure():
    """get_redis() returns None when ping raises (lines 45-47)."""
    import app.redis_client as m
    import redis as _redis_mod

    _stop_global_redis_patch()
    _reset_redis_pool()

    mock_pool = MagicMock()
    mock_client = MagicMock()
    mock_client.ping.side_effect = Exception("Connection refused")

    try:
        with patch.object(_redis_mod.ConnectionPool, "from_url", return_value=mock_pool):
            with patch.object(_redis_mod, "Redis", return_value=mock_client):
                result = m.get_redis()
        assert result is None
    finally:
        _reset_redis_pool()
        _start_global_redis_patch()


def test_get_redis_reuses_existing_pool():
    """get_redis() skips pool creation if _pool already exists."""
    import app.redis_client as m
    import redis as _redis_mod

    _stop_global_redis_patch()
    existing_pool = MagicMock()
    m._pool = existing_pool

    mock_client = MagicMock()
    mock_client.ping.return_value = True

    try:
        with patch.object(_redis_mod, "Redis", return_value=mock_client):
            result = m.get_redis()
        assert result is mock_client
        # from_url should NOT be called (pool already exists)
    finally:
        _reset_redis_pool()
        _start_global_redis_patch()
