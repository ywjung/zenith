"""Unit tests for RBAC and audit logging."""
from unittest.mock import MagicMock, patch


# ── RBAC role levels ───────────────────────────────────────────────────────────

def test_role_levels_order():
    from app.rbac import ROLE_LEVELS
    assert ROLE_LEVELS["user"] < ROLE_LEVELS["developer"]
    assert ROLE_LEVELS["developer"] < ROLE_LEVELS["pl"]
    assert ROLE_LEVELS["pl"] < ROLE_LEVELS["agent"]
    assert ROLE_LEVELS["agent"] < ROLE_LEVELS["admin"]


def test_get_user_role_not_found():
    from app.rbac import get_user_role
    mock_db = MagicMock()
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)
    mock_db.query.return_value.filter.return_value.first.return_value = None
    with patch("app.rbac.SessionLocal", return_value=mock_db):
        result = get_user_role(9999)
    assert result == "user"


def test_get_user_role_found():
    from app.rbac import get_user_role
    from app.models import UserRole
    mock_record = MagicMock(spec=UserRole)
    mock_record.role = "admin"
    mock_db = MagicMock()
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record
    with patch("app.rbac.SessionLocal", return_value=mock_db):
        result = get_user_role(42)
    assert result == "admin"


# ── require_role integration via HTTP ─────────────────────────────────────────

def test_user_cannot_access_agent_route(client, user_cookies):
    """user role (level 0) cannot access require_agent (level 3) routes."""
    resp = client.post("/templates/", json={"name": "x", "description": "y"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_admin_can_access_agent_route(client, admin_cookies):
    """admin role satisfies require_agent."""
    resp = client.post(
        "/templates/",
        json={"name": "테스트 템플릿", "description": "테스트용 설명"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201


def test_unauthenticated_returns_401(client):
    resp = client.get("/templates/")
    assert resp.status_code == 401


# ── audit._mask_sensitive ──────────────────────────────────────────────────────

def test_mask_sensitive_password():
    from app.audit import _mask_sensitive
    data = {"username": "hong", "password": "secret123"}
    result = _mask_sensitive(data)
    assert result["username"] == "hong"
    assert result["password"] == "[REDACTED]"


def test_mask_sensitive_token():
    from app.audit import _mask_sensitive
    data = {"access_token": "abc123", "name": "홍길동"}
    result = _mask_sensitive(data)
    assert result["access_token"] == "[REDACTED]"
    assert result["name"] == "홍길동"


def test_mask_sensitive_nested():
    from app.audit import _mask_sensitive
    data = {"user": {"api_key": "key123", "role": "admin"}}
    result = _mask_sensitive(data)
    assert result["user"]["api_key"] == "[REDACTED]"
    assert result["user"]["role"] == "admin"


def test_mask_sensitive_list():
    from app.audit import _mask_sensitive
    data = [{"secret": "shh"}, {"name": "ok"}]
    result = _mask_sensitive(data)
    assert result[0]["secret"] == "[REDACTED]"
    assert result[1]["name"] == "ok"


def test_mask_sensitive_plain_value():
    from app.audit import _mask_sensitive
    assert _mask_sensitive("plain") == "plain"
    assert _mask_sensitive(42) == 42
    assert _mask_sensitive(None) is None


def test_mask_sensitive_key_substring():
    from app.audit import _mask_sensitive
    # "private_key" contains "key"
    data = {"private_key": "ssh-rsa ...", "category": "network"}
    result = _mask_sensitive(data)
    assert result["private_key"] == "[REDACTED]"
    assert result["category"] == "network"


# ── write_audit_log ────────────────────────────────────────────────────────────

def test_write_audit_log_basic():
    from app.audit import write_audit_log
    mock_db = MagicMock()
    user = {"sub": "42", "username": "hong", "name": "홍길동", "role": "admin"}
    write_audit_log(mock_db, user, "ticket_created", "ticket", "123")
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()


def test_write_audit_log_swallows_errors():
    from app.audit import write_audit_log
    mock_db = MagicMock()
    mock_db.add.side_effect = Exception("DB 오류")
    user = {"sub": "1", "username": "test", "role": "user"}
    # Should not raise
    write_audit_log(mock_db, user, "action", "resource", "id")
    mock_db.rollback.assert_called_once()


def test_write_audit_log_with_request():
    from app.audit import write_audit_log
    mock_db = MagicMock()
    mock_request = MagicMock()
    mock_request.headers.get.return_value = "1.2.3.4, 5.6.7.8"
    user = {"sub": "1", "username": "hong", "role": "admin"}
    write_audit_log(mock_db, user, "login", "session", "1", request=mock_request)
    mock_db.add.assert_called_once()
    # Verify ip was extracted
    log_entry = mock_db.add.call_args[0][0]
    assert log_entry.ip_address == "1.2.3.4"


def test_write_audit_log_masks_sensitive_values():
    from app.audit import write_audit_log
    mock_db = MagicMock()
    user = {"sub": "1", "username": "hong", "role": "admin"}
    write_audit_log(
        mock_db, user, "update", "user", "1",
        old_value={"password": "old_pass"},
        new_value={"password": "new_pass"},
    )
    log_entry = mock_db.add.call_args[0][0]
    assert log_entry.old_value["password"] == "[REDACTED]"
    assert log_entry.new_value["password"] == "[REDACTED]"
