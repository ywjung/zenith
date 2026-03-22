"""Tests for /ticket-types endpoints."""


# ── get ticket type ────────────────────────────────────────────────────────────

def test_get_ticket_type_requires_auth(client):
    resp = client.get("/ticket-types/1")
    assert resp.status_code == 401


def test_get_ticket_type_default(client, user_cookies):
    """Returns default 'incident' type when no record exists."""
    resp = client.get("/ticket-types/42", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ticket_type"] == "incident"
    assert data["ticket_iid"] == 42
    assert data["updated_by"] is None


# ── set ticket type ────────────────────────────────────────────────────────────

def test_set_ticket_type_requires_agent(client, user_cookies):
    resp = client.put(
        "/ticket-types/1",
        json={"ticket_type": "change"},
        cookies=user_cookies,
    )
    assert resp.status_code == 403


def test_set_ticket_type_invalid(client, admin_cookies):
    resp = client.put(
        "/ticket-types/1",
        json={"ticket_type": "invalid_type"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


def test_set_ticket_type_success(client, admin_cookies):
    resp = client.put(
        "/ticket-types/10",
        json={"ticket_type": "change", "project_id": "1"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ticket_type"] == "change"
    assert data["label"] == "변경 요청"
    assert data["ticket_iid"] == 10


def test_set_ticket_type_update(client, admin_cookies):
    """Setting type again updates existing record."""
    client.put("/ticket-types/5", json={"ticket_type": "problem", "project_id": "1"}, cookies=admin_cookies)
    resp = client.put("/ticket-types/5", json={"ticket_type": "incident", "project_id": "1"}, cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["ticket_type"] == "incident"


def test_get_after_set(client, admin_cookies, user_cookies):
    """After setting type, GET returns updated value."""
    client.put("/ticket-types/7", json={"ticket_type": "service_request"}, cookies=admin_cookies)
    resp = client.get("/ticket-types/7", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["ticket_type"] == "service_request"


# ── bulk get ───────────────────────────────────────────────────────────────────

def test_bulk_get_requires_auth(client):
    resp = client.get("/ticket-types?ticket_iids=1,2,3")
    assert resp.status_code == 401


def test_bulk_get_defaults(client, user_cookies):
    resp = client.get("/ticket-types?ticket_iids=100,101,102", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert all(t["ticket_type"] == "incident" for t in data)


def test_bulk_get_invalid_ids(client, user_cookies):
    resp = client.get("/ticket-types?ticket_iids=abc,def", cookies=user_cookies)
    assert resp.status_code == 422


def test_bulk_get_with_existing(client, admin_cookies, user_cookies):
    client.put("/ticket-types/20", json={"ticket_type": "change"}, cookies=admin_cookies)
    resp = client.get("/ticket-types?ticket_iids=20,21", cookies=user_cookies)
    assert resp.status_code == 200
    data = {item["ticket_iid"]: item["ticket_type"] for item in resp.json()}
    assert data[20] == "change"
    assert data[21] == "incident"
