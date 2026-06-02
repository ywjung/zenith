"""Tests for /notification-rules — 사용자별 알림 규칙 CRUD + IDOR 가드 검증."""
from tests.conftest import make_token


def _cookies(username: str, user_id: str = "42") -> dict:
    return {"itsm_token": make_token(role="user", user_id=user_id, username=username)}


_RULE = {"name": "긴급 알림", "match_priorities": ["high", "critical"], "notify_email": True}


def test_list_requires_auth(client):
    assert client.get("/notification-rules/").status_code == 401


def test_create_and_list(client):
    c = _cookies("alice")
    r = client.post("/notification-rules/", json=_RULE, cookies=c)
    assert r.status_code == 201
    assert r.json()["name"] == "긴급 알림"
    rid = r.json()["id"]

    lst = client.get("/notification-rules/", cookies=c)
    assert lst.status_code == 200
    assert any(x["id"] == rid for x in lst.json()["rules"])


def test_rules_scoped_per_user(client):
    client.post("/notification-rules/", json=_RULE, cookies=_cookies("alice"))
    # bob은 alice의 규칙을 보지 못함
    lst = client.get("/notification-rules/", cookies=_cookies("bob"))
    assert lst.status_code == 200
    assert lst.json()["rules"] == []


def test_update_own_rule(client):
    c = _cookies("alice")
    rid = client.post("/notification-rules/", json=_RULE, cookies=c).json()["id"]
    r = client.patch(f"/notification-rules/{rid}", json={"enabled": False}, cookies=c)
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_update_other_users_rule_forbidden_idor(client):
    rid = client.post("/notification-rules/", json=_RULE, cookies=_cookies("alice")).json()["id"]
    # bob이 alice의 규칙을 수정 시도 → 404 (소유권 필터로 IDOR 차단)
    r = client.patch(f"/notification-rules/{rid}", json={"enabled": False}, cookies=_cookies("bob"))
    assert r.status_code == 404


def test_delete_other_users_rule_forbidden_idor(client):
    rid = client.post("/notification-rules/", json=_RULE, cookies=_cookies("alice")).json()["id"]
    r = client.delete(f"/notification-rules/{rid}", cookies=_cookies("bob"))
    assert r.status_code == 404
    # alice의 규칙은 여전히 존재
    lst = client.get("/notification-rules/", cookies=_cookies("alice"))
    assert any(x["id"] == rid for x in lst.json()["rules"])


def test_delete_own_rule(client):
    c = _cookies("alice")
    rid = client.post("/notification-rules/", json=_RULE, cookies=c).json()["id"]
    assert client.delete(f"/notification-rules/{rid}", cookies=c).status_code == 204
    assert client.get("/notification-rules/", cookies=c).json()["rules"] == []


def test_create_rule_limit_20(client):
    c = _cookies("heavy")
    for i in range(20):
        assert client.post("/notification-rules/", json={"name": f"r{i}"}, cookies=c).status_code == 201
    # 21번째는 거부
    r = client.post("/notification-rules/", json={"name": "over"}, cookies=c)
    assert r.status_code == 400


def test_create_rule_name_required(client):
    r = client.post("/notification-rules/", json={"name": ""}, cookies=_cookies("alice"))
    assert r.status_code == 422
