"""Tests for /dashboard/config endpoint."""


def test_get_config_requires_auth(client):
    resp = client.get("/dashboard/config")
    assert resp.status_code == 401


def test_get_config_returns_defaults(client, user_cookies):
    resp = client.get("/dashboard/config", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "widgets" in data
    assert isinstance(data["widgets"], list)
    assert len(data["widgets"]) > 0


def test_update_config_requires_auth(client):
    resp = client.put("/dashboard/config", json={"widgets": []})
    assert resp.status_code == 401


def test_update_config_success(client, user_cookies):
    widgets = [
        {"id": "stats_bar", "visible": True, "order": 0},
        {"id": "my_tickets", "visible": False, "order": 1},
    ]
    resp = client.put("/dashboard/config", json={"widgets": widgets}, cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "widgets" in data
    assert len(data["widgets"]) == 2


def test_update_config_persists(client, user_cookies):
    """Saved config should be returned on subsequent GET."""
    widgets = [{"id": "custom_widget", "visible": True, "order": 99}]
    client.put("/dashboard/config", json={"widgets": widgets}, cookies=user_cookies)
    resp = client.get("/dashboard/config", cookies=user_cookies)
    assert resp.status_code == 200
    ids = [w["id"] for w in resp.json()["widgets"]]
    assert "custom_widget" in ids


def test_update_config_truncates_at_20(client, user_cookies):
    """Maximum 20 widgets are stored."""
    widgets = [{"id": f"w{i}", "visible": True, "order": i} for i in range(25)]
    resp = client.put("/dashboard/config", json={"widgets": widgets}, cookies=user_cookies)
    assert resp.status_code == 200
    assert len(resp.json()["widgets"]) <= 20


def test_update_config_empty_widgets(client, user_cookies):
    resp = client.put("/dashboard/config", json={"widgets": []}, cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["widgets"] == []
