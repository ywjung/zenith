"""Tests for /push — Web Push 구독 CRUD + 사용자 스코프/IDOR 가드 검증."""
from tests.conftest import make_token


def _cookies(username: str, user_id: str = "42") -> dict:
    return {"itsm_token": make_token(role="user", user_id=user_id, username=username)}


def _sub(endpoint: str) -> dict:
    return {"endpoint": endpoint, "p256dh": "BPk_test_key", "auth": "auth_test"}


def test_vapid_key_is_public(client):
    # 인증 없이 접근 가능해야 함(401 아님). VAPID 미설정 시 503, 설정 시 200.
    r = client.get("/push/vapid-public-key")
    assert r.status_code in (200, 503)


def test_subscribe_requires_auth(client):
    assert client.post("/push/subscribe", json=_sub("https://x/ep1")).status_code == 401


def test_subscribe_and_status(client):
    c = _cookies("alice")
    r = client.post("/push/subscribe", json=_sub("https://push/ep-alice"), cookies=c)
    assert r.status_code == 201
    st = client.get("/push/status", cookies=c)
    assert st.status_code == 200
    assert st.json()["subscriptions"] == 1


def test_subscribe_same_endpoint_upserts(client):
    c = _cookies("alice")
    client.post("/push/subscribe", json=_sub("https://push/ep-dup"), cookies=c)
    client.post("/push/subscribe", json=_sub("https://push/ep-dup"), cookies=c)
    # 동일 endpoint는 upsert → 구독 수 1 유지
    assert client.get("/push/status", cookies=c).json()["subscriptions"] == 1


def test_status_scoped_per_user(client):
    client.post("/push/subscribe", json=_sub("https://push/ep-a"), cookies=_cookies("alice"))
    # bob은 자기 구독만 카운트
    assert client.get("/push/status", cookies=_cookies("bob")).json()["subscriptions"] == 0


def test_unsubscribe_own(client):
    c = _cookies("alice")
    client.post("/push/subscribe", json=_sub("https://push/ep-rm"), cookies=c)
    r = client.request("DELETE", "/push/unsubscribe", json=_sub("https://push/ep-rm"), cookies=c)
    assert r.status_code == 200
    assert client.get("/push/status", cookies=c).json()["subscriptions"] == 0


def test_unsubscribe_other_users_endpoint_noop_idor(client):
    # alice 구독을 bob이 해제 시도 → username 필터로 삭제되지 않음(IDOR 방지)
    client.post("/push/subscribe", json=_sub("https://push/ep-alice2"), cookies=_cookies("alice"))
    r = client.request("DELETE", "/push/unsubscribe", json=_sub("https://push/ep-alice2"), cookies=_cookies("bob"))
    assert r.status_code == 200  # 멱등 응답
    # alice의 구독은 그대로 남아있어야 함
    assert client.get("/push/status", cookies=_cookies("alice")).json()["subscriptions"] == 1
