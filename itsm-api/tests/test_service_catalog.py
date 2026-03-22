"""Tests for /service-catalog endpoints."""


# ── public list ────────────────────────────────────────────────────────────────

def test_public_list_no_auth_required(client):
    resp = client.get("/service-catalog/public")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_public_list_empty(client):
    resp = client.get("/service-catalog/public")
    assert resp.json() == []


def test_public_list_shows_active_only(client, admin_cookies):
    client.post("/service-catalog", json={"name": "활성 서비스", "is_active": True}, cookies=admin_cookies)
    client.post("/service-catalog", json={"name": "비활성 서비스", "is_active": False}, cookies=admin_cookies)
    resp = client.get("/service-catalog/public")
    names = [i["name"] for i in resp.json()]
    assert "활성 서비스" in names
    assert "비활성 서비스" not in names


# ── authenticated list ─────────────────────────────────────────────────────────

def test_list_requires_auth(client):
    resp = client.get("/service-catalog")
    assert resp.status_code == 401


def test_list_includes_inactive(client, admin_cookies):
    client.post("/service-catalog", json={"name": "비활성 아이템", "is_active": False}, cookies=admin_cookies)
    resp = client.get("/service-catalog", cookies=admin_cookies)
    names = [i["name"] for i in resp.json()]
    assert "비활성 아이템" in names


# ── create ─────────────────────────────────────────────────────────────────────

def test_create_requires_admin(client, user_cookies):
    resp = client.post("/service-catalog", json={"name": "테스트"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_create_success(client, admin_cookies):
    payload = {
        "name": "네트워크 설정 요청",
        "description": "네트워크 관련 서비스",
        "category": "network",
        "is_active": True,
        "order": 1,
    }
    resp = client.post("/service-catalog", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "네트워크 설정 요청"
    assert data["is_active"] is True
    assert data["order"] == 1


def test_create_with_fields_schema(client, admin_cookies):
    schema = [{"field": "urgency", "type": "select", "options": ["low", "high"]}]
    resp = client.post(
        "/service-catalog",
        json={"name": "커스텀 폼", "fields_schema": schema},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    assert resp.json()["fields_schema"] == schema


# ── update ─────────────────────────────────────────────────────────────────────

def test_update_requires_admin(client, user_cookies):
    resp = client.patch("/service-catalog/1", json={"name": "수정"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_update_not_found(client, admin_cookies):
    resp = client.patch("/service-catalog/9999", json={"name": "없음"}, cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_success(client, admin_cookies):
    create = client.post("/service-catalog", json={"name": "원본"}, cookies=admin_cookies)
    item_id = create.json()["id"]
    resp = client.patch(f"/service-catalog/{item_id}", json={"name": "수정된 이름", "is_active": False}, cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["name"] == "수정된 이름"
    assert resp.json()["is_active"] is False


# ── delete ─────────────────────────────────────────────────────────────────────

def test_delete_requires_admin(client, user_cookies):
    resp = client.delete("/service-catalog/1", cookies=user_cookies)
    assert resp.status_code == 403


def test_delete_not_found(client, admin_cookies):
    resp = client.delete("/service-catalog/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_success(client, admin_cookies):
    create = client.post("/service-catalog", json={"name": "삭제 대상"}, cookies=admin_cookies)
    item_id = create.json()["id"]
    resp = client.delete(f"/service-catalog/{item_id}", cookies=admin_cookies)
    assert resp.status_code == 204
    # Verify it's gone from the list
    items = client.get("/service-catalog", cookies=admin_cookies).json()
    assert not any(i["id"] == item_id for i in items)
