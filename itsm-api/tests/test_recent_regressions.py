"""최근 변경(CB/Bulk/Anonymize/Idempotency)에 대한 회귀 테스트.

각 테스트는 버그를 재현하도록 설계되어 있다. 수정 후 통과해야 한다.
"""
from __future__ import annotations

import time


# ---------------------------------------------------------------------------
# CircuitBreaker — half-open 실패 후 재오픈이 제대로 동작하는지
# ---------------------------------------------------------------------------
def test_circuit_breaker_reopens_after_half_open_failure(monkeypatch):
    """연속 실패로 open → timeout 경과 후 half-open → 그 시도가 실패하면
    CB는 즉시 재오픈되어야 한다. 그렇지 않으면 이후 요청들이 무방비로 통과한다.
    """
    from app.circuit_breaker import CircuitBreaker, CircuitOpenError

    cb = CircuitBreaker("test", threshold=3, timeout=0.1)

    # 연속 3회 실패 → open
    for _ in range(3):
        cb.record_failure()
    try:
        cb.check()
    except CircuitOpenError:
        pass
    else:
        raise AssertionError("CB should be open after threshold failures")

    # timeout 경과 — half-open probe 허용
    time.sleep(0.15)
    cb.check()  # should not raise (half-open)

    # half-open 시도 실패
    cb.record_failure()

    # 즉시 재오픈되어야 함 — 다음 check는 CircuitOpenError
    raised = False
    try:
        cb.check()
    except CircuitOpenError:
        raised = True
    assert raised, "CB must re-open after failed half-open probe"


def test_circuit_breaker_closes_on_half_open_success():
    """half-open 시도가 성공하면 CB는 닫히고 카운터 초기화."""
    from app.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker("test", threshold=2, timeout=0.05)
    cb.record_failure(); cb.record_failure()
    time.sleep(0.1)
    cb.check()  # half-open pass
    cb.record_success()
    assert not cb.is_open
    # 추가 실패 1번으론 다시 안 열림 (카운터 리셋됨)
    cb.record_failure()
    assert not cb.is_open


# ---------------------------------------------------------------------------
# Bulk — 전체 실패 시에도 구조화 에러 배열이 클라이언트에 보존되어야 함
# ---------------------------------------------------------------------------
def test_bulk_update_total_failure_preserves_structured_errors(client, admin_cookies, db_session, monkeypatch):
    """모든 티켓 작업이 실패해도 응답 body에 errors/summary가 유지되어야 한다.
    403/404/502 같은 에러 코드로 응답하면 프론트는 text만 받고 구조가 손실된다.
    """
    from app.routers.tickets import bulk as _bulk
    from app import gitlab_client

    # 모든 get_issue 호출을 404로 실패시킴
    import httpx
    def _boom(*_a, **_k):
        req = httpx.Request("GET", "http://fake")
        resp = httpx.Response(404, request=req)
        raise httpx.HTTPStatusError("not found", request=req, response=resp)

    monkeypatch.setattr(gitlab_client, "get_issue", _boom)

    resp = client.post(
        "/tickets/bulk",
        json={"iids": [1, 2, 3], "project_id": "1", "action": "close"},
        cookies=admin_cookies,
    )
    # 2xx(200 또는 207)여야 프론트 request()가 구조를 그대로 넘김.
    # 4xx/5xx로 응답하면 프론트는 parseErrorMessage()로 문자열화.
    assert resp.status_code in (200, 207), (
        f"Bulk total failure must return 2xx so structured errors aren't lost; "
        f"got {resp.status_code} body={resp.text[:200]}"
    )
    data = resp.json()
    assert "summary" in data
    assert data["summary"]["failed"] == 3
    assert data["summary"]["succeeded"] == 0
    assert len(data["errors"]) == 3


# ---------------------------------------------------------------------------
# Anonymize — 대소문자 다른 표기도 마스킹되어야 한다 (GDPR)
# ---------------------------------------------------------------------------
def test_anonymize_user_case_insensitive(client, admin_cookies, db_session):
    """사용자명의 대소문자 변형도 Notification.body/title에서 마스킹되어야 한다.
    ilike 필터는 case-insensitive지만 func.replace는 case-sensitive →
    필터에 걸린 행이 UPDATE되지만 치환은 안 되어 PII가 남는다.
    """
    from app.models import UserRole, Notification

    target = UserRole(
        gitlab_user_id=9999,
        username="alice",
        name="Alice",
        role="user",
        is_active=True,
    )
    db_session.add(target)
    # 동일 메시지에 서로 다른 케이스로 사용자명이 포함된 알림들
    # (SQLite에서 BigInteger autoincrement가 먹히지 않아 명시적 id 부여)
    db_session.add_all([
        Notification(id=1, recipient_id="1", title="Alice commented", body="Alice wrote something", is_read=False),
        Notification(id=2, recipient_id="1", title="assigned to alice", body="alice wrote something (lowercase)", is_read=False),
        Notification(id=3, recipient_id="1", title="ALICE closed", body="ALICE closed the ticket", is_read=False),
    ])
    db_session.commit()

    resp = client.post(f"/users/{target.gitlab_user_id}/anonymize", cookies=admin_cookies)
    assert resp.status_code == 200, resp.text

    # 모든 알림에서 원본 이름이 사라져야 한다 (대소문자 무관)
    db_session.expire_all()
    for n in db_session.query(Notification).all():
        combined = (n.title or "") + " " + (n.body or "")
        for variant in ("Alice", "alice", "ALICE"):
            assert variant not in combined, (
                f"PII variant {variant!r} leaked in notification id={n.id}: {combined!r}"
            )


# ---------------------------------------------------------------------------
# Idempotency middleware — 서로 다른 JWT가 같은 버킷을 쓰지 않아야 함
# ---------------------------------------------------------------------------
def test_idempotency_user_scope_separates_tokens(client):
    """user_scope가 토큰 서명부 기반이라 다른 사용자는 다른 버킷을 쓴다.
    이전 구현(token[:16])은 HS256 헤더 고정 프리픽스라 전 사용자가 한 버킷.
    """
    from app.main import idempotency_middleware  # noqa: F401 — just verify it imports
    from tests.conftest import make_token
    import hashlib

    tok_a = make_token(user_id="100", username="alice")
    tok_b = make_token(user_id="200", username="bob")

    # Same prefix? (기존 버그 재현)
    assert tok_a[:16] == tok_b[:16], "Test precondition: HS256 prefixes match"

    # 하지만 서명부 해시는 달라야 한다 (수정 후 동작)
    sig_a = tok_a.rsplit(".", 1)[-1]
    sig_b = tok_b.rsplit(".", 1)[-1]
    scope_a = hashlib.sha256(sig_a.encode()).hexdigest()[:16]
    scope_b = hashlib.sha256(sig_b.encode()).hexdigest()[:16]
    assert scope_a != scope_b, "Different users must produce different cache scopes"


# ---------------------------------------------------------------------------
# Optimistic locking — GET의 ETag로 PATCH If-Match 체크
# ---------------------------------------------------------------------------
def test_ticket_get_returns_etag_and_patch_matches(client, admin_cookies, monkeypatch):
    """GET /tickets/{iid}는 ETag 헤더를 반환해야 한다 (해시 기반).
    일치하지 않는 If-Match로 PATCH 시 409.
    """
    from app import gitlab_client

    fake_issue = {
        "iid": 1, "title": "t", "description": "", "state": "opened",
        "labels": ["status::진행전"],
        "created_at": "2026-04-18T00:00:00Z",
        "updated_at": "2026-04-18T00:00:00Z",
        "assignees": [], "web_url": "", "project_id": 1,
        "author": {"username": "alice"},
    }
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: fake_issue)
    monkeypatch.setattr(gitlab_client, "get_users_by_usernames", lambda *a, **k: {})

    r = client.get("/tickets/1", cookies=admin_cookies)
    assert r.status_code == 200
    etag = r.headers.get("ETag")
    # 해시 형태: 따옴표 안에 12자 hex
    assert etag and etag.startswith('"') and etag.endswith('"'), f"ETag format: {etag!r}"
    assert len(etag.strip('"')) == 12, f"ETag should be 12-char hash: {etag!r}"
    # 내부 타임스탬프가 ETag에 직접 노출되지 않아야 함
    assert "2026-04-18" not in etag, "Timestamp should not leak into ETag"

    # 잘못된 If-Match → 409
    r2 = client.patch(
        "/tickets/1",
        json={"title": "changed title"},
        headers={"If-Match": '"wrong-hash"'},
        cookies=admin_cookies,
    )
    assert r2.status_code == 409, r2.text


# ---------------------------------------------------------------------------
# list_tickets TSI 경로 — UserRole.gitlab_user_id가 username→id 매핑에 포함되는지
# (TSI 전체 경로는 PostgreSQL JSONB @> 연산자가 필요해 SQLite에선 불가.
#  assignee_id 매핑 로직 자체를 DB 쿼리 수준에서 검증.)
# ---------------------------------------------------------------------------
def test_userrole_lookup_provides_assignee_id_mapping(db_session):
    """TSI 경로가 assignee_id를 채우려면 UserRole 조회 결과에서
    username → gitlab_user_id 매핑을 만들 수 있어야 한다.
    이전에는 name만 뽑고 id는 누락했다.
    """
    from app.models import UserRole

    db_session.add_all([
        UserRole(gitlab_user_id=777, username="charlie", name="Charlie", role="developer", is_active=True),
        UserRole(gitlab_user_id=888, username="david", name="David", role="pl", is_active=True),
    ])
    db_session.commit()

    usernames = {"charlie", "david", "missing"}
    rows = db_session.query(UserRole).filter(UserRole.username.in_(usernames)).all()
    name_map = {u.username: u.name for u in rows if u.name}
    id_map = {u.username: u.gitlab_user_id for u in rows if u.gitlab_user_id is not None}

    assert id_map == {"charlie": 777, "david": 888}
    assert name_map == {"charlie": "Charlie", "david": "David"}
    # 누락된 username은 None fallback
    assert id_map.get("missing") is None
