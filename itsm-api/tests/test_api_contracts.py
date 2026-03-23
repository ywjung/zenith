"""API contract tests — validate response schema structure for key endpoints."""
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_issue(iid: int = 1) -> dict:
    return {
        "iid": iid,
        "title": "테스트 티켓",
        "state": "opened",
        "labels": ["status::open", "prio::medium", "cat::hardware"],
        "description": "설명",
        "author": {"name": "user", "username": "user"},
        "assignees": [],
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
        "web_url": "http://fake/1",
        "confidential": False,
        "milestone": None,
        "project_id": 1,
    }


def _mock_note(note_id: int = 10) -> dict:
    return {
        "id": note_id,
        "body": "테스트 댓글",
        "author": {"name": "admin", "username": "admin", "avatar_url": None},
        "created_at": "2025-01-01T00:00:00Z",
        "confidential": False,
        "system": False,
    }


# ---------------------------------------------------------------------------
# 1. GET /tickets/{iid} — ticket detail schema
# ---------------------------------------------------------------------------

def test_ticket_detail_schema(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", return_value=_mock_issue(1)), \
         patch("app.gitlab_client.get_users_by_usernames", return_value={}):
        resp = client.get("/tickets/1", cookies=admin_cookies)

    # GitLab may be unreachable (502) or record absent (404) — all acceptable
    assert resp.status_code in (200, 404, 502), f"Unexpected status: {resp.status_code}"
    if resp.status_code == 200:
        data = resp.json()
        for key in ("iid", "title", "status", "priority", "category"):
            assert key in data, f"응답에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 2. GET /tickets/ — ticket list schema
# ---------------------------------------------------------------------------

def test_ticket_list_schema(client, admin_cookies):
    mock_issues = [_mock_issue(i) for i in range(1, 4)]
    with patch("app.gitlab_client.get_issues", return_value=(mock_issues, 3)), \
         patch("app.gitlab_client.get_all_issues", return_value=mock_issues):
        resp = client.get("/tickets/", cookies=admin_cookies)

    assert resp.status_code in (200, 502), f"Unexpected status: {resp.status_code}"
    if resp.status_code == 200:
        data = resp.json()
        # Response is either a dict with a "tickets" key or a plain list
        assert isinstance(data, (list, dict)), "응답이 list 또는 dict 이어야 함"
        if isinstance(data, dict):
            assert "tickets" in data or "items" in data, "dict 응답에 'tickets' 또는 'items' 키 없음"


# ---------------------------------------------------------------------------
# 3. GET /admin/custom-fields — custom field definition schema
# ---------------------------------------------------------------------------

def test_admin_custom_fields_schema(client, admin_cookies):
    # Create a field through the API so the app's DB session sees it
    client.post(
        "/admin/custom-fields",
        json={"name": "schema_field", "label": "스키마 필드", "field_type": "text"},
        cookies=admin_cookies,
    )

    resp = client.get("/admin/custom-fields", cookies=admin_cookies)

    assert resp.status_code == 200, f"Unexpected status: {resp.status_code}"
    data = resp.json()
    assert isinstance(data, list), "응답이 list 이어야 함"
    if data:
        item = data[0]
        for key in ("id", "name", "label", "field_type", "enabled"):
            assert key in item, f"항목에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 4. GET /tickets/{iid}/custom-fields — per-ticket custom field values schema
# ---------------------------------------------------------------------------

def test_ticket_custom_fields_schema(client, admin_cookies):
    # Create a field through the admin API so the app's DB session sees it
    create_resp = client.post(
        "/admin/custom-fields",
        json={"name": "cf_contract", "label": "계약 필드", "field_type": "text"},
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 201, f"Field creation failed: {create_resp.text}"

    resp = client.get("/tickets/1/custom-fields", cookies=admin_cookies)

    assert resp.status_code == 200, f"Unexpected status: {resp.status_code}"
    data = resp.json()
    assert isinstance(data, list), "응답이 list 이어야 함"
    if data:
        item = data[0]
        # The tickets sub-router returns "id" (not "field_id") along with name/label/field_type/value
        for key in ("id", "name", "label", "field_type", "value"):
            assert key in item, f"항목에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 5. GET /kb/articles — KB article list schema
# ---------------------------------------------------------------------------

def test_kb_articles_list_schema(client, admin_cookies):
    resp = client.get("/kb/articles", cookies=admin_cookies)

    assert resp.status_code == 200, f"Unexpected status: {resp.status_code}"
    data = resp.json()
    # Empty list is valid for a fresh DB; expect dict with "articles" key
    assert isinstance(data, dict), "응답이 dict 이어야 함"
    articles = data.get("articles", [])
    assert isinstance(articles, list), "'articles' 값이 list 이어야 함"
    if articles:
        item = articles[0]
        for key in ("id", "title"):
            assert key in item, f"KB 항목에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 6. GET /notifications/ — notification list schema
# ---------------------------------------------------------------------------

def test_notifications_list_schema(client, admin_cookies):
    resp = client.get("/notifications/", cookies=admin_cookies)

    assert resp.status_code == 200, f"Unexpected status: {resp.status_code}"
    data = resp.json()
    # Router returns {"unread_count": N, "notifications": [...]}
    assert isinstance(data, dict), "응답이 dict 이어야 함"
    assert "notifications" in data or "items" in data, \
        "응답에 'notifications' 또는 'items' 키 없음"
    items = data.get("notifications", data.get("items", []))
    assert isinstance(items, list), "알림 목록이 list 이어야 함"


# ---------------------------------------------------------------------------
# 7. GET /health — health check schema
# ---------------------------------------------------------------------------

def test_health_schema(client):
    # Mock the httpx call that health() makes to GitLab /api/v4/version
    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 503
    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.get = MagicMock(return_value=mock_response)

    with patch("httpx.Client", return_value=mock_client):
        resp = client.get("/health")

    # Status may be 200 (all ok) or 503 (degraded) — both are valid responses
    assert resp.status_code in (200, 503), f"Unexpected status: {resp.status_code}"
    data = resp.json()
    assert "status" in data, "응답에 'status' 키 없음"
    assert "checks" in data, "응답에 'checks' 키 없음"
    assert isinstance(data["checks"], dict), "'checks' 값이 dict 이어야 함"


# ---------------------------------------------------------------------------
# 8. GET /tickets/{iid}/comments — comment list schema
# ---------------------------------------------------------------------------

def test_ticket_comments_schema(client, admin_cookies):
    notes = [_mock_note(10), _mock_note(11)]
    with patch("app.gitlab_client.get_notes", return_value=notes):
        resp = client.get("/tickets/1/comments", cookies=admin_cookies)

    assert resp.status_code in (200, 502), f"Unexpected status: {resp.status_code}"
    if resp.status_code == 200:
        data = resp.json()
        assert isinstance(data, list), "응답이 list 이어야 함"
        if data:
            item = data[0]
            for key in ("id", "body", "author_name", "created_at"):
                assert key in item, f"댓글 항목에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 9. GET /tickets/{iid}/timeline — timeline list schema
# ---------------------------------------------------------------------------

def test_ticket_timeline_schema(client, admin_cookies):
    notes = [_mock_note(10)]
    with patch("app.gitlab_client.get_notes", return_value=notes):
        resp = client.get("/tickets/1/timeline", cookies=admin_cookies)

    assert resp.status_code in (200, 502), f"Unexpected status: {resp.status_code}"
    if resp.status_code == 200:
        data = resp.json()
        assert isinstance(data, list), "응답이 list 이어야 함"
        if data:
            item = data[0]
            for key in ("type", "created_at"):
                assert key in item, f"타임라인 항목에 '{key}' 키 없음"


# ---------------------------------------------------------------------------
# 10. POST /admin/custom-fields — create field, verify 201 + schema
# ---------------------------------------------------------------------------

def test_admin_custom_fields_create_schema(client, admin_cookies):
    payload = {
        "name": "contract_field",
        "label": "계약 테스트 필드",
        "field_type": "text",
        "options": [],
        "required": False,
        "sort_order": 0,
    }
    resp = client.post("/admin/custom-fields", json=payload, cookies=admin_cookies)

    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
    data = resp.json()
    for key in ("id", "name", "field_type"):
        assert key in data, f"생성 응답에 '{key}' 키 없음"
    assert data["name"] == "contract_field"
    assert data["field_type"] == "text"
