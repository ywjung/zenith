"""Tests for /admin/ip-allowlist endpoints."""


def test_list_requires_admin(client, user_cookies):
    resp = client.get("/admin/ip-allowlist", cookies=user_cookies)
    assert resp.status_code == 403


def test_list_empty(client, admin_cookies):
    resp = client.get("/admin/ip-allowlist", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_requires_admin(client, user_cookies):
    resp = client.post("/admin/ip-allowlist", json={"cidr": "10.0.0.0/8"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_create_success(client, admin_cookies):
    resp = client.post(
        "/admin/ip-allowlist",
        json={"cidr": "192.168.1.0/24", "label": "사무실", "is_active": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["cidr"] == "192.168.1.0/24"
    assert data["label"] == "사무실"
    assert data["is_active"] is True


def test_create_invalid_cidr(client, admin_cookies):
    resp = client.post(
        "/admin/ip-allowlist",
        json={"cidr": "not-an-ip"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


def test_create_duplicate_cidr(client, admin_cookies):
    client.post("/admin/ip-allowlist", json={"cidr": "10.0.0.0/8"}, cookies=admin_cookies)
    resp = client.post("/admin/ip-allowlist", json={"cidr": "10.0.0.0/8"}, cookies=admin_cookies)
    assert resp.status_code == 409


def test_update_not_found(client, admin_cookies):
    resp = client.patch("/admin/ip-allowlist/9999", json={"is_active": False}, cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_success(client, admin_cookies):
    create = client.post(
        "/admin/ip-allowlist",
        json={"cidr": "172.16.0.0/12", "label": "원래 레이블"},
        cookies=admin_cookies,
    )
    eid = create.json()["id"]
    resp = client.patch(
        f"/admin/ip-allowlist/{eid}",
        json={"label": "수정된 레이블", "is_active": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["label"] == "수정된 레이블"
    assert resp.json()["is_active"] is False


def test_delete_not_found(client, admin_cookies):
    resp = client.delete("/admin/ip-allowlist/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_success(client, admin_cookies):
    create = client.post("/admin/ip-allowlist", json={"cidr": "1.2.3.0/24"}, cookies=admin_cookies)
    eid = create.json()["id"]
    resp = client.delete(f"/admin/ip-allowlist/{eid}", cookies=admin_cookies)
    assert resp.status_code == 204
    items = client.get("/admin/ip-allowlist", cookies=admin_cookies).json()
    assert not any(e["id"] == eid for e in items)


def test_get_my_ip(client, admin_cookies):
    resp = client.get("/admin/ip-allowlist/my-ip", cookies=admin_cookies)
    assert resp.status_code == 200
    assert "ip" in resp.json()


def test_get_my_ip_requires_admin(client, user_cookies):
    resp = client.get("/admin/ip-allowlist/my-ip", cookies=user_cookies)
    assert resp.status_code == 403


def test_single_host_cidr(client, admin_cookies):
    """Single-host CIDR (x.x.x.x/32) should be accepted."""
    resp = client.post("/admin/ip-allowlist", json={"cidr": "8.8.8.8/32"}, cookies=admin_cookies)
    assert resp.status_code == 201
    assert resp.json()["cidr"] == "8.8.8.8/32"
