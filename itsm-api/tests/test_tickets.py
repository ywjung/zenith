"""Tests for /tickets endpoints — GitLab is mocked via unittest.mock."""
from unittest.mock import patch

FAKE_ISSUE = {
    "iid": 1,
    "title": "프린터가 작동하지 않아요",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n\n---\n\n프린터 연결 안됨",
    "state": "opened",
    "labels": ["cat::hardware", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "web_url": "http://gitlab/issues/1",
}


def _make_issue(**overrides):
    return {**FAKE_ISSUE, **overrides}


VALID_PAYLOAD = {
    "title": "네트워크 연결 불량 신고합니다",
    "description": "사무실 2층 회의실 인터넷이 안됩니다.",
    "category": "network",
    "priority": "high",
    "employee_name": "김철수",
    "employee_email": "kim@example.com",
}


# ── list ──────────────────────────────────────────────────────────────────────

def test_list_tickets(client, admin_cookies):
    """Admin role uses get_issues (server-side filtering), not get_all_issues."""
    with patch("app.gitlab_client.get_issues", return_value=([FAKE_ISSUE], 1)):
        resp = client.get("/tickets/", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["tickets"][0]["iid"] == 1


def test_list_tickets_gitlab_error(client, admin_cookies):
    with patch("app.gitlab_client.get_issues", side_effect=Exception("connection refused")):
        resp = client.get("/tickets/", cookies=admin_cookies)
    assert resp.status_code == 502


# ── create ────────────────────────────────────────────────────────────────────

def test_create_ticket(client, user_cookies):
    with (
        patch("app.gitlab_client.create_issue", return_value=_make_issue(iid=2)),
        patch("app.gitlab_client.ensure_labels"),
    ):
        resp = client.post("/tickets/", json=VALID_PAYLOAD, cookies=user_cookies)
    assert resp.status_code == 201
    assert resp.json()["iid"] == 2


def test_create_ticket_title_too_short(client, user_cookies):
    payload = {**VALID_PAYLOAD, "title": "짧음"}
    resp = client.post("/tickets/", json=payload, cookies=user_cookies)
    assert resp.status_code == 422


def test_create_ticket_description_too_short(client, user_cookies):
    payload = {**VALID_PAYLOAD, "description": "짧음"}
    resp = client.post("/tickets/", json=payload, cookies=user_cookies)
    assert resp.status_code == 422


# ── get single ────────────────────────────────────────────────────────────────

def test_get_ticket(client, user_cookies):
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.get("/tickets/1", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["status"] == "open"


def test_get_ticket_gitlab_error(client, user_cookies):
    with patch("app.gitlab_client.get_issue", side_effect=Exception("timeout")):
        resp = client.get("/tickets/999", cookies=user_cookies)
    assert resp.status_code == 502
