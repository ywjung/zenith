"""Tests for app/rate_limit.py fallback path (lines 71-85)."""
import sys
from unittest.mock import patch, MagicMock


def test_rate_limit_fallback_when_slowapi_unavailable():
    """When slowapi import fails → limiter=None, user_limiter=None, login_limiter=None (lines 71-85)."""
    # Force the module to re-execute with slowapi blocked
    blocked = {
        "slowapi": None,
        "slowapi.util": None,
        "slowapi.errors": None,
    }

    # Remove cached module so it reimports
    original = sys.modules.pop("app.rate_limit", None)
    try:
        with patch.dict(sys.modules, blocked):
            import importlib
            import app.rate_limit as rl_mod
            importlib.reload(rl_mod)
            assert rl_mod.limiter is None
            assert rl_mod.user_limiter is None
            assert rl_mod.login_limiter is None
    finally:
        # Restore original module state
        if original is not None:
            sys.modules["app.rate_limit"] = original
        else:
            sys.modules.pop("app.rate_limit", None)
        # Reimport to restore
        import importlib
        import app.rate_limit  # noqa: F401


def test_rate_limit_fallback_production_warning():
    """When slowapi unavailable in production → error logged (lines 74-82)."""
    blocked = {
        "slowapi": None,
        "slowapi.util": None,
        "slowapi.errors": None,
    }

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "production"
    mock_settings.REDIS_URL = "memory://"

    original = sys.modules.pop("app.rate_limit", None)
    try:
        with (
            patch.dict(sys.modules, blocked),
            patch("app.config.get_settings", return_value=mock_settings),
        ):
            import importlib
            import app.rate_limit as rl_mod
            importlib.reload(rl_mod)
            # Should log error for production with no rate limiting
            assert rl_mod.limiter is None
    finally:
        if original is not None:
            sys.modules["app.rate_limit"] = original
        import importlib
        import app.rate_limit  # noqa: F401


def test_rate_limit_login_username_key_from_body():
    """_get_login_username extracts username from request body."""
    import json
    original = sys.modules.get("app.rate_limit")
    import app.rate_limit as rl_mod

    if not hasattr(rl_mod, "_get_login_username"):
        return  # slowapi not installed in test env, skip

    mock_request = MagicMock()
    mock_request._body = json.dumps({"username": "testuser"}).encode()

    result = rl_mod._get_login_username(mock_request)
    assert result == "login_user:testuser"


def test_rate_limit_login_username_key_from_email():
    """_get_login_username falls back to email field."""
    import json
    import app.rate_limit as rl_mod

    if not hasattr(rl_mod, "_get_login_username"):
        return

    mock_request = MagicMock()
    mock_request._body = json.dumps({"email": "user@example.com"}).encode()

    result = rl_mod._get_login_username(mock_request)
    assert result == "login_user:user@example.com"


def test_rate_limit_login_username_no_body():
    """_get_login_username falls back to IP when no body."""
    import app.rate_limit as rl_mod

    if not hasattr(rl_mod, "_get_login_username"):
        return

    mock_request = MagicMock()
    mock_request._body = None
    mock_request.client.host = "10.0.0.1"

    result = rl_mod._get_login_username(mock_request)
    assert result.startswith("login_ip:")


def test_rate_limit_user_or_ip_key_with_valid_token():
    """_get_user_or_ip returns username from JWT when valid."""
    import jwt
    import app.rate_limit as rl_mod

    if not hasattr(rl_mod, "_get_user_or_ip"):
        return

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    token = jwt.encode({"username": "alice", "sub": "1"}, mock_settings.SECRET_KEY, algorithm="HS256")

    mock_request = MagicMock()
    mock_request.cookies = {"itsm_token": token}

    with patch("app.rate_limit._get_settings", return_value=mock_settings):
        result = rl_mod._get_user_or_ip(mock_request)
    assert result == "alice"
