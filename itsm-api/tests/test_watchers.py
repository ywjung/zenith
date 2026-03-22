"""Tests for /tickets/{iid}/watchers and /notifications/my-watches endpoints."""
from unittest.mock import patch


def test_list_watchers_requires_auth(client):
    resp = client.get("/tickets/1/watchers")
    assert resp.status_code == 401


def test_list_watchers_empty(client, user_cookies):
    resp = client.get("/tickets/1/watchers", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_watch_ticket_success(client, user_cookies):
    resp = client.post("/tickets/1/watch", cookies=user_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["ticket_iid"] == 1
    assert data["user_name"] == "홍길동"


def test_watch_ticket_idempotent(client, user_cookies):
    """Watching the same ticket twice returns 201 both times (idempotent)."""
    client.post("/tickets/1/watch", cookies=user_cookies)
    resp = client.post("/tickets/1/watch", cookies=user_cookies)
    assert resp.status_code == 201


def test_list_watchers_after_watch(client, user_cookies):
    client.post("/tickets/1/watch", cookies=user_cookies)
    resp = client.get("/tickets/1/watchers", cookies=user_cookies)
    assert resp.status_code == 200
    watchers = resp.json()
    assert len(watchers) == 1
    assert watchers[0]["user_email"] == "hong@example.com"


def test_unwatch_ticket_success(client, user_cookies):
    client.post("/tickets/1/watch", cookies=user_cookies)
    resp = client.delete("/tickets/1/watch", cookies=user_cookies)
    assert resp.status_code == 204


def test_unwatch_ticket_not_watching(client, user_cookies):
    resp = client.delete("/tickets/99/watch", cookies=user_cookies)
    assert resp.status_code == 404


def test_my_watches_empty(client, user_cookies):
    resp = client.get("/notifications/my-watches", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_my_watches_returns_watched_tickets(client, user_cookies):
    client.post("/tickets/1/watch", cookies=user_cookies)
    fake_issue = {
        "iid": 1,
        "title": "테스트 티켓",
        "state": "opened",
        "labels": ["status::open", "prio::high"],
        "web_url": "http://gitlab/1",
        "assignees": [{"name": "담당자"}],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    with patch("app.gitlab_client.get_issue", return_value=fake_issue):
        resp = client.get("/notifications/my-watches", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ticket_iid"] == 1
    assert data[0]["status"] == "open"
    assert data[0]["priority"] == "high"


def test_my_watches_gitlab_error_graceful(client, user_cookies):
    """When GitLab fails, returns stub data instead of raising."""
    client.post("/tickets/2/watch", cookies=user_cookies)
    with patch("app.gitlab_client.get_issue", side_effect=Exception("GitLab 오류")):
        resp = client.get("/notifications/my-watches", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["status"] == "unknown"


def test_watch_invalid_email_rejected(client):
    """Token with no email should fail email validation."""
    from tests.conftest import make_token
    cookies = {"itsm_token": make_token(email="")}
    resp = client.post("/tickets/1/watch", cookies=cookies)
    assert resp.status_code == 400
