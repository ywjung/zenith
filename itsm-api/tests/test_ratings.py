"""Tests for /tickets/{iid}/ratings endpoints."""
from unittest.mock import patch

CLOSED_ISSUE = {
    "iid": 1,
    "title": "해결된 티켓",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n\n---\n\n내용",
    "state": "closed",
    "labels": ["cat::software", "prio::low", "status::resolved"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z",
    "web_url": "http://gitlab/issues/1",
}

OPENED_ISSUE = {**CLOSED_ISSUE, "state": "opened"}

RATING_PAYLOAD = {
    "employee_name": "홍길동",
    "employee_email": "hong@example.com",
    "score": 5,
    "comment": "빠른 처리 감사합니다",
}


def test_create_rating(client):
    with (
        patch("app.gitlab_client.get_issue", return_value=CLOSED_ISSUE),
        patch("app.gitlab_client.add_note", return_value={}),
    ):
        resp = client.post("/tickets/1/ratings", json=RATING_PAYLOAD)
    assert resp.status_code == 201
    data = resp.json()
    assert data["score"] == 5
    assert data["gitlab_issue_iid"] == 1


def test_create_rating_duplicate(client):
    with (
        patch("app.gitlab_client.get_issue", return_value=CLOSED_ISSUE),
        patch("app.gitlab_client.add_note", return_value={}),
    ):
        client.post("/tickets/1/ratings", json=RATING_PAYLOAD)
        resp = client.post("/tickets/1/ratings", json=RATING_PAYLOAD)
    assert resp.status_code == 409


def test_create_rating_open_ticket(client):
    with patch("app.gitlab_client.get_issue", return_value=OPENED_ISSUE):
        resp = client.post("/tickets/1/ratings", json=RATING_PAYLOAD)
    assert resp.status_code == 400
    assert "완료된 티켓" in resp.json()["detail"]


def test_create_rating_invalid_score(client):
    payload = {**RATING_PAYLOAD, "score": 6}
    resp = client.post("/tickets/1/ratings", json=payload)
    assert resp.status_code == 422


def test_get_rating_not_found(client):
    resp = client.get("/tickets/999/ratings")
    assert resp.status_code == 200
    assert resp.json() is None


def test_get_rating_exists(client):
    with (
        patch("app.gitlab_client.get_issue", return_value=CLOSED_ISSUE),
        patch("app.gitlab_client.add_note", return_value={}),
    ):
        client.post("/tickets/1/ratings", json=RATING_PAYLOAD)
    resp = client.get("/tickets/1/ratings")
    assert resp.status_code == 200
    assert resp.json()["score"] == 5
