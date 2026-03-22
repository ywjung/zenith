"""Tests for /faq endpoints."""


# ── list ───────────────────────────────────────────────────────────────────────

def test_list_faq_requires_auth(client):
    resp = client.get("/faq")
    assert resp.status_code == 401


def test_list_faq_empty(client, user_cookies):
    resp = client.get("/faq", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_faq_active_only_by_default(client, admin_cookies, user_cookies):
    client.post("/faq", json={"question": "활성 질문", "answer": "활성 답변", "is_active": True}, cookies=admin_cookies)
    client.post("/faq", json={"question": "비활성 질문", "answer": "비활성 답변", "is_active": False}, cookies=admin_cookies)
    resp = client.get("/faq", cookies=user_cookies)
    questions = [i["question"] for i in resp.json()]
    assert "활성 질문" in questions
    assert "비활성 질문" not in questions


def test_list_faq_agent_can_see_inactive(client, admin_cookies):
    client.post("/faq", json={"question": "비활성 항목", "answer": "답변", "is_active": False}, cookies=admin_cookies)
    resp = client.get("/faq?active_only=false", cookies=admin_cookies)
    questions = [i["question"] for i in resp.json()]
    assert "비활성 항목" in questions


def test_list_faq_category_filter(client, admin_cookies, user_cookies):
    client.post("/faq", json={"question": "VPN 관련 질문", "answer": "VPN 답변", "category": "network"}, cookies=admin_cookies)
    client.post("/faq", json={"question": "인쇄 관련 질문", "answer": "인쇄 답변", "category": "hardware"}, cookies=admin_cookies)
    resp = client.get("/faq?category=network", cookies=user_cookies)
    questions = [i["question"] for i in resp.json()]
    assert "VPN 관련 질문" in questions
    assert "인쇄 관련 질문" not in questions


# ── create ─────────────────────────────────────────────────────────────────────

def test_create_faq_requires_agent(client, user_cookies):
    resp = client.post("/faq", json={"question": "질문", "answer": "답변"}, cookies=user_cookies)
    assert resp.status_code == 403


def test_create_faq_success(client, admin_cookies):
    payload = {"question": "비밀번호를 잊었어요", "answer": "IT 헬프데스크에 문의하세요", "category": "account"}
    resp = client.post("/faq", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["question"] == "비밀번호를 잊었어요"
    assert data["category"] == "account"
    assert data["is_active"] is True


def test_create_faq_empty_question_fails(client, admin_cookies):
    resp = client.post("/faq", json={"question": "", "answer": "답변"}, cookies=admin_cookies)
    assert resp.status_code == 422


# ── bulk create ────────────────────────────────────────────────────────────────

def test_bulk_create_faq(client, admin_cookies):
    items = [
        {"question": f"질문 {i}", "answer": f"답변 {i}"} for i in range(3)
    ]
    resp = client.post("/faq/bulk", json={"items": items}, cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["created"] == 3
    assert data["skipped"] == 0


def test_bulk_create_skips_duplicates(client, admin_cookies):
    client.post("/faq", json={"question": "중복 질문", "answer": "답변"}, cookies=admin_cookies)
    resp = client.post(
        "/faq/bulk",
        json={"items": [{"question": "중복 질문", "answer": "답변"}, {"question": "새 질문", "answer": "새 답변"}]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["created"] == 1
    assert data["skipped"] == 1


# ── get single ─────────────────────────────────────────────────────────────────

def test_get_faq_requires_auth(client):
    resp = client.get("/faq/1")
    assert resp.status_code == 401


def test_get_faq_not_found(client, user_cookies):
    resp = client.get("/faq/9999", cookies=user_cookies)
    assert resp.status_code == 404


def test_get_faq_success(client, admin_cookies, user_cookies):
    create = client.post("/faq", json={"question": "특정 질문", "answer": "특정 답변"}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.get(f"/faq/{faq_id}", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["question"] == "특정 질문"


def test_get_inactive_faq_hidden_from_user(client, admin_cookies, user_cookies):
    create = client.post("/faq", json={"question": "비활성 단일", "answer": "답변", "is_active": False}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.get(f"/faq/{faq_id}", cookies=user_cookies)
    assert resp.status_code == 404


def test_get_inactive_faq_visible_to_admin(client, admin_cookies):
    create = client.post("/faq", json={"question": "비활성 어드민", "answer": "답변", "is_active": False}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.get(f"/faq/{faq_id}", cookies=admin_cookies)
    assert resp.status_code == 200


# ── update ─────────────────────────────────────────────────────────────────────

def test_update_faq_not_found(client, admin_cookies):
    resp = client.put("/faq/9999", json={"question": "없음"}, cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_faq_success(client, admin_cookies):
    create = client.post("/faq", json={"question": "원본 질문", "answer": "원본 답변"}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.put(f"/faq/{faq_id}", json={"question": "수정된 질문", "is_active": False}, cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["question"] == "수정된 질문"
    assert data["is_active"] is False


# ── delete ─────────────────────────────────────────────────────────────────────

def test_delete_faq_not_found(client, admin_cookies):
    resp = client.delete("/faq/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_faq_success(client, admin_cookies):
    create = client.post("/faq", json={"question": "삭제 질문", "answer": "삭제 답변"}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.delete(f"/faq/{faq_id}", cookies=admin_cookies)
    assert resp.status_code == 204
    resp2 = client.get(f"/faq/{faq_id}", cookies=admin_cookies)
    assert resp2.status_code == 404


def test_update_faq_answer_category_order(client, admin_cookies):
    """Updating answer, category, and order_num covers lines 152, 154, 156."""
    create = client.post("/faq", json={"question": "원본 질문", "answer": "원본 답변"}, cookies=admin_cookies)
    faq_id = create.json()["id"]
    resp = client.put(
        f"/faq/{faq_id}",
        json={"answer": "수정된 답변", "category": "network", "order_num": 5},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["answer"] == "수정된 답변"
    assert data["category"] == "network"
    assert data["order_num"] == 5
