"""Tests for /quick-replies and /filters endpoints."""


# ── quick replies ──────────────────────────────────────────────────────────────

def test_list_quick_replies_requires_auth(client):
    resp = client.get("/quick-replies")
    assert resp.status_code == 401


def test_list_quick_replies_empty(client, user_cookies):
    resp = client.get("/quick-replies", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_quick_reply_requires_agent(client, user_cookies):
    resp = client.post("/quick-replies", json={"name": "테스트", "content": "내용"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_create_quick_reply_success(client, admin_cookies):
    payload = {"name": "재시작 요청", "content": "PC 재시작을 요청드립니다.", "category": "hardware"}
    resp = client.post("/quick-replies", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "재시작 요청"
    assert data["category"] == "hardware"


def test_list_quick_replies_with_category_filter(client, admin_cookies, user_cookies):
    client.post("/quick-replies", json={"name": "네트워크 답변", "content": "내용", "category": "network"}, cookies=admin_cookies)
    client.post("/quick-replies", json={"name": "하드웨어 답변", "content": "내용", "category": "hardware"}, cookies=admin_cookies)
    resp = client.get("/quick-replies?category=network", cookies=user_cookies)
    names = [r["name"] for r in resp.json()]
    assert "네트워크 답변" in names
    assert "하드웨어 답변" not in names


def test_update_quick_reply_not_found(client, admin_cookies):
    resp = client.put("/quick-replies/9999", json={"name": "없음", "content": "없음"}, cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_quick_reply_success(client, admin_cookies):
    create = client.post("/quick-replies", json={"name": "원본", "content": "원본 내용"}, cookies=admin_cookies)
    rid = create.json()["id"]
    resp = client.put(f"/quick-replies/{rid}", json={"name": "수정됨", "content": "수정된 내용"}, cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["name"] == "수정됨"


def test_delete_quick_reply_not_found(client, admin_cookies):
    resp = client.delete("/quick-replies/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_quick_reply_success(client, admin_cookies, user_cookies):
    create = client.post("/quick-replies", json={"name": "삭제 대상", "content": "삭제됩니다"}, cookies=admin_cookies)
    rid = create.json()["id"]
    resp = client.delete(f"/quick-replies/{rid}", cookies=admin_cookies)
    assert resp.status_code == 204
    # Verify it's gone
    items = client.get("/quick-replies", cookies=user_cookies).json()
    assert not any(r["id"] == rid for r in items)


def test_create_quick_reply_empty_name_fails(client, admin_cookies):
    resp = client.post("/quick-replies", json={"name": "", "content": "내용"}, cookies=admin_cookies)
    assert resp.status_code == 422


# ── saved filters ──────────────────────────────────────────────────────────────

def test_list_filters_requires_auth(client):
    resp = client.get("/filters/")
    assert resp.status_code == 401


def test_list_filters_empty(client, user_cookies):
    resp = client.get("/filters/", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_filter_success(client, user_cookies):
    payload = {"name": "내 필터", "filters": {"status": "open", "priority": "high"}}
    resp = client.post("/filters/", json=payload, cookies=user_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "내 필터"
    assert data["filters"]["status"] == "open"


def test_create_filter_duplicate_name_fails(client, user_cookies):
    payload = {"name": "중복 필터", "filters": {}}
    client.post("/filters/", json=payload, cookies=user_cookies)
    resp = client.post("/filters/", json=payload, cookies=user_cookies)
    assert resp.status_code == 409


def test_list_filters_returns_own_filters(client, user_cookies):
    """Each user sees their own filters."""
    client.post("/filters/", json={"name": "첫 번째 필터", "filters": {}}, cookies=user_cookies)
    client.post("/filters/", json={"name": "두 번째 필터", "filters": {}}, cookies=user_cookies)
    resp = client.get("/filters/", cookies=user_cookies)
    names = [f["name"] for f in resp.json()]
    assert "첫 번째 필터" in names
    assert "두 번째 필터" in names


def test_delete_filter_not_found(client, user_cookies):
    resp = client.delete("/filters/9999", cookies=user_cookies)
    assert resp.status_code == 404


def test_delete_filter_success(client, user_cookies):
    create = client.post("/filters/", json={"name": "삭제용 필터", "filters": {}}, cookies=user_cookies)
    fid = create.json()["id"]
    resp = client.delete(f"/filters/{fid}", cookies=user_cookies)
    assert resp.status_code == 204
    items = client.get("/filters/", cookies=user_cookies).json()
    assert not any(f["id"] == fid for f in items)


def test_delete_nonexistent_filter_returns_404(client, user_cookies):
    """Deleting a filter that doesn't exist returns 404."""
    resp = client.delete("/filters/99999", cookies=user_cookies)
    assert resp.status_code == 404
