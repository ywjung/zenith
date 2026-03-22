"""Extra coverage push — targets remaining uncovered lines."""
import ipaddress
from unittest.mock import MagicMock, patch, PropertyMock
from sqlalchemy.exc import IntegrityError

import pytest


# ── automation.py:156  (RuleUpdate.validate_conditions non-string, non-list value) ──

def test_update_automation_rule_integer_condition_value(client, admin_cookies):
    """PATCH rule with integer condition value → validate_conditions str() conversion (line 156)."""
    # First create a rule to PATCH
    create_resp = client.post(
        "/automation-rules",
        json={
            "name": "int_cond_test",
            "trigger_event": "ticket.created",
            "conditions": [{"field": "priority", "operator": "eq", "value": "high"}],
            "actions": [{"type": "set_status", "value": "in_progress"}],
            "is_active": True,
        },
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 201
    rule_id = create_resp.json()["id"]

    # PATCH with integer condition value → hits line 156
    resp = client.patch(
        f"/automation-rules/{rule_id}",
        json={"conditions": [{"field": "status", "operator": "eq", "value": 3}]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    # value should have been str-converted
    updated = resp.json()
    assert updated["conditions"][0]["value"] == "3"


# ── admin/api_keys.py:116  (revoke nonexistent API key → 404) ──────────────────

def test_revoke_nonexistent_api_key(client, admin_cookies):
    """DELETE /admin/api-keys/9999 → 404 (line 116)."""
    resp = client.delete("/admin/api-keys/9999", cookies=admin_cookies)
    assert resp.status_code == 404


# ── admin/announcements.py:56  (POST invalid type → 400) ──────────────────────

def test_create_announcement_invalid_type(client, admin_cookies):
    """POST /admin/announcements with invalid type → 400 (line 56)."""
    resp = client.post(
        "/admin/announcements",
        json={"title": "Test", "content": "body", "type": "unknown", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ── admin/announcements.py:82  (PUT nonexistent → 404) ─────────────────────────

def test_update_nonexistent_announcement(client, admin_cookies):
    """PUT /admin/announcements/9999 → 404 (line 82)."""
    resp = client.put(
        "/admin/announcements/9999",
        json={"title": "X", "content": "Y", "type": "info", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


# ── admin/announcements.py:102  (DELETE nonexistent → 404) ─────────────────────

def test_delete_nonexistent_announcement(client, admin_cookies):
    """DELETE /admin/announcements/9999 → 404 (line 102)."""
    resp = client.delete("/admin/announcements/9999", cookies=admin_cookies)
    assert resp.status_code == 404


# ── ip_allowlist.py:66-69  (private proxy IP → trust X-Forwarded-For) ─────────

def test_get_my_ip_private_proxy_trusted(client, admin_cookies):
    """GET /admin/ip-allowlist/my-ip with private proxy → uses XFF (lines 66-68)."""
    private_mock = MagicMock(spec=ipaddress.IPv4Address)
    private_mock.is_private = True

    with patch("app.routers.ip_allowlist.ipaddress.ip_address", return_value=private_mock):
        resp = client.get(
            "/admin/ip-allowlist/my-ip",
            headers={"X-Forwarded-For": "203.0.113.1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ip"] == "203.0.113.1"


def test_get_my_ip_public_proxy_ignored(client, admin_cookies):
    """GET /admin/ip-allowlist/my-ip with public proxy → uses client.host (line 69)."""
    public_mock = MagicMock(spec=ipaddress.IPv4Address)
    public_mock.is_private = False

    with patch("app.routers.ip_allowlist.ipaddress.ip_address", return_value=public_mock):
        resp = client.get(
            "/admin/ip-allowlist/my-ip",
            headers={"X-Forwarded-For": "203.0.113.1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    # When public proxy, falls back to client.host (not the XFF value)
    data = resp.json()
    assert "ip" in data


# ── watchers.py:79-81  (IntegrityError on commit → rollback + re-query) ────────

def test_watch_ticket_integrity_error_race_condition(client, admin_cookies):
    """db.commit raises IntegrityError (race) → rollback + re-query (lines 79-81)."""
    from app.database import get_db
    from app.main import app
    from app.models import TicketWatcher

    # Build a fake watcher to return from the re-query after rollback
    fake_watcher = MagicMock(spec=TicketWatcher)
    fake_watcher.ticket_iid = 888
    fake_watcher.project_id = "1"
    fake_watcher.user_id = "42"
    fake_watcher.user_email = "hong@example.com"
    fake_watcher.user_name = "홍길동"

    query_count = {"n": 0}

    class _FakeQuery:
        def filter(self, *a, **kw): return self
        def first(self):
            query_count["n"] += 1
            if query_count["n"] == 1:
                return None  # No existing — triggers add+commit path
            return fake_watcher  # Re-query after rollback returns it

    class _FakeDB:
        def query(self, *a, **kw): return _FakeQuery()
        def add(self, obj): pass
        def commit(self):
            raise IntegrityError("", {}, Exception("unique violation"))
        def rollback(self): pass
        def refresh(self, obj): pass

    def override_get_db():
        yield _FakeDB()

    original = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    try:
        resp = client.post("/tickets/888/watch", cookies=admin_cookies)
        # Should succeed (returns the pre-existing watcher from re-query)
        assert resp.status_code in (200, 201)
    finally:
        if original is not None:
            app.dependency_overrides[get_db] = original
        else:
            app.dependency_overrides.pop(get_db, None)


# ── kb.py:216-219  (fallback when primary tsvector returns empty) ───────────────

def test_kb_suggest_fallback_when_primary_empty(client, user_cookies):
    """Primary tsvector returns [] → fallback OR query runs (lines 216-219)."""
    from app.database import get_db
    from app.main import app
    from app.models import KBArticle

    class _FakeQuery:
        """Returns [] for both tsvector queries but supports all chaining."""
        def filter(self, *a, **kw): return self
        def order_by(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def all(self): return []

    class _FakeDB:
        def query(self, *a, **kw): return _FakeQuery()

    def override_get_db():
        yield _FakeDB()

    original = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    try:
        resp = client.get("/kb/suggest?q=docker%20install", cookies=user_cookies)
        assert resp.status_code == 200
        assert resp.json() == []
    finally:
        if original is not None:
            app.dependency_overrides[get_db] = original
        else:
            app.dependency_overrides.pop(get_db, None)
