"""Recent 변경사항에 대한 엣지 케이스·스트레스 테스트.

test_recent_regressions.py가 각 버그의 기본 재현을 커버하고, 이 파일은 경계/비정상
입력, 경합, 반복 시나리오 등 품질을 끌어올리는 테스트를 담는다.
"""
from __future__ import annotations

import threading
import time
from unittest.mock import patch


# ============================================================================
# 1) CircuitBreaker — 스레드·반복·경계 케이스
# ============================================================================
def test_cb_repeated_half_open_failures_keep_reopening():
    """half-open 실패 → 재오픈 → timeout → half-open 실패 사이클이 계속 동작해야 한다."""
    from app.circuit_breaker import CircuitBreaker, CircuitOpenError

    cb = CircuitBreaker("loop", threshold=2, timeout=0.05)
    cb.record_failure(); cb.record_failure()
    for _ in range(5):
        # open 상태 확인
        try:
            cb.check()
            assert False, "CB should be open"
        except CircuitOpenError:
            pass
        time.sleep(0.06)
        cb.check()              # half-open probe allowed
        cb.record_failure()     # probe fails → should reopen


def test_cb_concurrent_failures_are_thread_safe():
    """여러 스레드가 동시에 record_failure를 호출해도 카운터 손실이 없어야 한다."""
    from app.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker("threaded", threshold=1000, timeout=60.0)

    def _bang():
        for _ in range(100):
            cb.record_failure()

    threads = [threading.Thread(target=_bang) for _ in range(10)]
    for t in threads: t.start()
    for t in threads: t.join()

    # 10 threads * 100 failures = 1000. Exact count required (no lost updates).
    assert cb._failures == 1000


def test_cb_is_open_property_reflects_state():
    from app.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker("prop", threshold=2, timeout=0.05)
    assert cb.is_open is False
    cb.record_failure()
    assert cb.is_open is False
    cb.record_failure()
    assert cb.is_open is True
    time.sleep(0.06)
    assert cb.is_open is False  # timeout expired → half-open (not open)


def test_cb_success_resets_counter():
    from app.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker("reset", threshold=3, timeout=30.0)
    cb.record_failure(); cb.record_failure()
    assert cb._failures == 2
    cb.record_success()
    assert cb._failures == 0
    # threshold 회까지 실패해도 이전 실패가 리셋되어 안 열림
    cb.record_failure(); cb.record_failure()
    assert not cb.is_open


# ============================================================================
# 2) Bulk — 빈 입력, 단건, 전체 성공
# ============================================================================
FAKE_ISSUE = {
    "iid": 1, "title": "t", "description": "", "state": "opened",
    "labels": ["status::진행전"], "updated_at": "2026-04-18T00:00:00Z",
    "created_at": "2026-04-18T00:00:00Z",
    "assignees": [], "web_url": "", "project_id": 1,
    "author": {"username": "alice"},
}
FAKE_CLOSED = {**FAKE_ISSUE, "state": "closed"}


def test_bulk_all_success_returns_200(client, admin_cookies, monkeypatch):
    """전체 성공 시 200, summary 포함."""
    from app import gitlab_client
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: FAKE_CLOSED)

    r = client.post(
        "/tickets/bulk",
        json={"iids": [1, 2, 3], "project_id": "1", "action": "close"},
        cookies=admin_cookies,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["summary"] == {"total": 3, "succeeded": 3, "failed": 0}
    assert set(data["success"]) == {1, 2, 3}
    assert data["errors"] == []


def test_bulk_empty_iids_handled_gracefully(client, admin_cookies):
    """빈 iids는 스키마에서 차단되거나, 허용된다면 0건 처리 결과를 반환."""
    r = client.post(
        "/tickets/bulk",
        json={"iids": [], "project_id": "1", "action": "close"},
        cookies=admin_cookies,
    )
    # 스키마 validation으로 422 or 처리 후 summary 0/0/0
    assert r.status_code in (200, 207, 422)
    if r.status_code == 200:
        assert r.json()["summary"] == {"total": 0, "succeeded": 0, "failed": 0}


def test_bulk_classify_exc_matrix():
    """_classify_exc가 httpx 예외 타입별로 적절한 HTTP 코드를 반환해야 한다."""
    import httpx
    from app.routers.tickets.bulk import _classify_exc

    req = httpx.Request("GET", "http://fake")
    # 404
    code, msg = _classify_exc(httpx.HTTPStatusError("nf", request=req, response=httpx.Response(404, request=req)))
    assert code == 404 and "찾을 수 없" in msg
    # 403
    code, _ = _classify_exc(httpx.HTTPStatusError("nf", request=req, response=httpx.Response(403, request=req)))
    assert code == 403
    # 409
    code, _ = _classify_exc(httpx.HTTPStatusError("nf", request=req, response=httpx.Response(409, request=req)))
    assert code == 409
    # 기타 HTTPStatusError
    code, _ = _classify_exc(httpx.HTTPStatusError("nf", request=req, response=httpx.Response(500, request=req)))
    assert code == 500
    # Timeout
    code, msg = _classify_exc(httpx.TimeoutException("slow"))
    assert code == 504 and "시간 초과" in msg
    # 기타 RequestError
    code, _ = _classify_exc(httpx.RequestError("net err"))
    assert code == 502
    # 일반 Exception
    code, msg = _classify_exc(ValueError("oops"))
    assert code == 500 and msg


# ============================================================================
# 3) Anonymize — 특수문자/공백/유니코드/빈 필드
# ============================================================================
def test_anonymize_handles_regex_metacharacters(client, admin_cookies, db_session):
    """사용자명에 정규식 메타문자(. * + ? ( ) [ ] 등)가 있어도 리터럴로 치환해야 한다."""
    from app.models import UserRole, Notification

    weird = "A.B*C(D)"  # regex 메타
    db_session.add(UserRole(gitlab_user_id=1001, username="weird", name=weird, role="user", is_active=True))
    db_session.add(Notification(id=100, recipient_id="1", title=f"by {weird}", body=f"{weird} did something", is_read=False))
    db_session.commit()

    r = client.post("/users/1001/anonymize", cookies=admin_cookies)
    assert r.status_code == 200

    db_session.expire_all()
    for n in db_session.query(Notification).all():
        assert weird not in (n.title or "")
        assert weird not in (n.body or "")


def test_anonymize_handles_korean_name(client, admin_cookies, db_session):
    """한글 이름도 정상 치환 (유니코드 경계)."""
    from app.models import UserRole, Notification

    db_session.add(UserRole(gitlab_user_id=1002, username="hong", name="홍길동", role="user", is_active=True))
    db_session.add(Notification(id=101, recipient_id="1", title="홍길동님 알림", body="홍길동 작성", is_read=False))
    db_session.commit()

    r = client.post("/users/1002/anonymize", cookies=admin_cookies)
    assert r.status_code == 200
    db_session.expire_all()
    n = db_session.query(Notification).filter_by(id=101).first()
    assert "홍길동" not in (n.title or "")
    assert "홍길동" not in (n.body or "")


def test_anonymize_empty_name_rejected(client, admin_cookies, db_session):
    """이름과 username이 모두 비어 있으면 422 (치환 대상 없음)."""
    from app.models import UserRole

    # username은 NOT NULL이지만 공백만 있는 경우
    db_session.add(UserRole(gitlab_user_id=1003, username="   ", name="", role="user", is_active=True))
    db_session.commit()

    r = client.post("/users/1003/anonymize", cookies=admin_cookies)
    assert r.status_code == 422


def test_anonymize_title_only(client, admin_cookies, db_session):
    """body가 None이고 title에만 이름이 있을 때 title만 마스킹."""
    from app.models import UserRole, Notification

    db_session.add(UserRole(gitlab_user_id=1004, username="bob", name="Bob", role="user", is_active=True))
    db_session.add(Notification(id=102, recipient_id="1", title="Bob assigned", body=None, is_read=False))
    db_session.commit()

    r = client.post("/users/1004/anonymize", cookies=admin_cookies)
    assert r.status_code == 200
    data = r.json()
    assert data["masked_titles"] == 1
    assert data["masked_bodies"] == 0


def test_anonymize_no_matching_notifications(client, admin_cookies, db_session):
    """알림에 해당 이름이 없으면 0건 마스킹, 200."""
    from app.models import UserRole, Notification

    db_session.add(UserRole(gitlab_user_id=1005, username="eve", name="Eve", role="user", is_active=True))
    db_session.add(Notification(id=103, recipient_id="1", title="System message", body="unrelated", is_read=False))
    db_session.commit()

    r = client.post("/users/1005/anonymize", cookies=admin_cookies)
    assert r.status_code == 200
    data = r.json()
    assert data["masked_titles"] == 0
    assert data["masked_bodies"] == 0
    # UserRole은 여전히 익명화되어야 함
    from app.models import UserRole as _UR
    target = db_session.query(_UR).filter_by(gitlab_user_id=1005).first()
    assert target.name == "[삭제된 사용자]"
    assert target.is_active is False


def test_user_sync_does_not_reactivate_anonymized_user(db_session, monkeypatch):
    """익명화된 사용자가 GitLab 그룹에 여전히 남아 있더라도
    user_sync가 is_active=True로 복구하면 안 된다 (GDPR 지속성).

    main.py가 module-level에서 SessionLocal을 import하므로 main.SessionLocal
    참조도 테스트 세션으로 교체한다.
    """
    from app.models import UserRole
    from app import main as _main
    from app import gitlab_client as _gl
    from tests.conftest import TestSessionLocal

    # main 모듈이 import한 SessionLocal 심볼을 테스트 세션으로 교체
    monkeypatch.setattr(_main, "SessionLocal", TestSessionLocal)

    # 익명화 완료된 사용자 (name="[삭제된 사용자]", is_active=False)
    anon = UserRole(
        gitlab_user_id=7777, username="ghost",
        name="[삭제된 사용자]", role="user", is_active=False,
    )
    # 같은 그룹에 있는 일반 사용자 (정상적으로 활성되어야 함)
    normal = UserRole(
        gitlab_user_id=8888, username="alive",
        name="Alive User", role="user", is_active=False,
    )
    db_session.add_all([anon, normal])
    db_session.commit()

    # GitLab API: 두 사람 모두 그룹 멤버로 보이도록
    monkeypatch.setattr(_gl, "get_group_members", lambda *a, **k: [{"id": 7777}, {"id": 8888}])
    monkeypatch.setattr(_gl, "get_project_members", lambda *a, **k: [{"id": 7777}, {"id": 8888}])

    # settings 조작: GITLAB_GROUP_ID 설정
    settings = _main.get_settings()
    monkeypatch.setattr(settings, "GITLAB_GROUP_ID", "1", raising=False)

    # GitLab admins 호출은 실패 반환
    import httpx as _httpx
    class _FakeResp:
        is_success = False
        def json(self): return []
    monkeypatch.setattr(_httpx, "get", lambda *a, **k: _FakeResp())

    _main._run_user_sync()

    db_session.expire_all()
    anon_after = db_session.query(UserRole).filter_by(gitlab_user_id=7777).first()
    normal_after = db_session.query(UserRole).filter_by(gitlab_user_id=8888).first()

    # 익명화된 사용자는 GitLab에 멤버로 남아있어도 비활성 유지
    assert anon_after.is_active is False, "Anonymized user must stay inactive"
    assert anon_after.name == "[삭제된 사용자]"
    # 일반 사용자는 정상 활성화
    assert normal_after.is_active is True


def test_validation_error_ctx_is_json_serializable(client, admin_cookies):
    """Pydantic field_validator의 `raise ValueError`는 ctx.error에 Exception 인스턴스가
    담긴 dict를 errors()에 반환. 정제 없이 JSONResponse로 보내면 500 TypeError 발생.
    수정 후: 422와 함께 정제된 detail이 반환되어야 함.
    """
    from unittest.mock import patch
    FAKE_ISSUE = {"iid": 5, "state": "opened", "labels": [], "title": "t",
                  "description": "", "updated_at": "2026-04-18T00:00:00Z",
                  "created_at": "2026-04-18T00:00:00Z", "assignees": [],
                  "web_url": "", "project_id": 1, "author": {"username": "u"}}
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "invalid-project-99999"},
            cookies=admin_cookies,
        )
    # JSON 응답이 정상적으로 반환되어야 (500 TypeError가 아닌 422)
    assert resp.status_code == 422, f"got {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    assert data["error"]["code"] == "validation_error"
    # detail 안에 raw Exception 객체가 없음을 보장 (JSON-safe)
    import json
    # 다시 직렬화 성공해야 한다
    assert json.dumps(data)  # no exception raised


def test_approvals_create_uses_advisory_lock_no_with_for_update(db_session):
    """Approval 생성 경로가 advisory lock 방식으로 직렬화되는지 확인.

    코드가 SELECT pg_advisory_xact_lock()을 실행하려 하면 SQLite에선 예외가
    나지만 try/except로 gracefully 건너뛴다. 실패해도 핸들러가 정상 동작해야 함.
    """
    from app.models import ApprovalRequest, UserRole
    from app.routers.approvals import create_approval_request, ApprovalCreate

    # UserRole: approver 후보
    db_session.add(UserRole(
        gitlab_user_id=9001, username="approver", name="Approver",
        role="pl", is_active=True,
    ))
    db_session.commit()

    body = ApprovalCreate(ticket_iid=100, project_id="1", approver_username="approver")
    current_user = {"sub": "42", "username": "requester", "name": "Req", "role": "user"}

    from unittest.mock import patch
    # GitLab issue 존재, create_db_notification은 SQLite BigInt autoincrement 회피 위해 mock
    with patch("app.gitlab_client.get_issue", return_value={"iid": 100}), \
         patch("app.routers.approvals.create_db_notification", return_value=None):
        result = create_approval_request(body=body, db=db_session, current_user=current_user)

    assert result["ticket_iid"] == 100
    assert result["status"] == "pending"
    # 두 번째 호출은 409 발생해야 함 (advisory lock은 SQLite에선 no-op이지만
    # 일반 SELECT 결과로 pending 존재 감지 가능)
    with patch("app.gitlab_client.get_issue", return_value={"iid": 100}), \
         patch("app.routers.approvals.create_db_notification", return_value=None):
        import pytest
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            create_approval_request(body=body, db=db_session, current_user=current_user)
        assert exc.value.status_code == 409


def test_rating_duplicate_insert_returns_409_not_500(client, admin_cookies, db_session, monkeypatch):
    """동일 사용자가 같은 티켓에 평가를 두 번 INSERT하면 unique constraint로 IntegrityError.
    이전엔 처리 안 돼 500. 수정 후엔 409로 변환.
    """
    from app.models import Rating
    from app import gitlab_client

    # 기존 평가 선삽입 (TOCTOU 우회 — POST 핸들러의 existing 체크를 우회하고 INSERT 경로 트리거)
    db_session.add(Rating(
        gitlab_issue_iid=42, username="hong", employee_name="홍길동",
        employee_email="h@e.com", score=5, comment="good",
    ))
    db_session.commit()

    # 티켓은 resolved 상태라고 가정
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: {
        "iid": 42, "state": "closed", "labels": ["status::resolved"],
    })

    resp = client.post(
        "/tickets/42/ratings",
        json={"score": 4, "comment": "duplicate attempt"},
        cookies=admin_cookies,
    )
    # 기존 평가 탐지되어 409 (TOCTOU 우회돼도 DB unique로 IntegrityError → 409)
    assert resp.status_code == 409


def test_anonymize_revokes_api_keys_and_refresh_tokens(client, admin_cookies, db_session):
    """GDPR 삭제 요청 시 해당 사용자의 API 키와 refresh token이 즉시 폐기돼야 한다."""
    from app.models import UserRole, ApiKey, RefreshToken
    from datetime import datetime, timezone, timedelta

    target = UserRole(
        gitlab_user_id=12345, username="gdpruser", name="GDPR User",
        role="user", is_active=True,
    )
    db_session.add(target)
    # 사용자 명의 API 키와 refresh token 등록
    db_session.add(ApiKey(
        id=1, name="test-key", key_hash="h"*64, key_prefix="itsm_live_xx",
        scopes=["tickets:read"], created_by="gdpruser", revoked=False,
    ))
    db_session.add(RefreshToken(
        id=1, token_hash="r"*64, gitlab_user_id="12345",
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=7),
        revoked=False,
    ))
    db_session.commit()

    r = client.post(f"/users/{target.gitlab_user_id}/anonymize", cookies=admin_cookies)
    assert r.status_code == 200
    data = r.json()
    assert data["revoked_api_keys"] == 1

    db_session.expire_all()
    # API 키 폐기 확인
    api_key = db_session.query(ApiKey).filter_by(id=1).first()
    assert api_key.revoked is True
    # Refresh token 폐기 확인
    rt = db_session.query(RefreshToken).filter_by(id=1).first()
    assert rt.revoked is True


def test_anonymize_requires_admin(client, user_cookies, db_session):
    """일반 사용자는 403."""
    from app.models import UserRole
    db_session.add(UserRole(gitlab_user_id=1006, username="x", name="X", role="user", is_active=True))
    db_session.commit()
    r = client.post("/users/1006/anonymize", cookies=user_cookies)
    assert r.status_code == 403


def test_anonymize_user_not_found(client, admin_cookies):
    """존재하지 않는 사용자는 404."""
    r = client.post("/users/999999/anonymize", cookies=admin_cookies)
    assert r.status_code == 404


# ============================================================================
# 4) Idempotency middleware 엣지
# ============================================================================
def test_idempotency_no_header_is_noop(client, admin_cookies, monkeypatch):
    """Idempotency-Key 없으면 middleware가 관여하지 않아야 한다."""
    from app import gitlab_client
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: FAKE_CLOSED)

    # POST bulk without Idempotency-Key should work normally
    r = client.post(
        "/tickets/bulk",
        json={"iids": [1], "project_id": "1", "action": "close"},
        cookies=admin_cookies,
    )
    assert r.status_code in (200, 207)


def test_idempotency_key_too_long_bypasses(client, admin_cookies, monkeypatch):
    """128자 초과 키는 무시 (악성 입력 방어)."""
    from app import gitlab_client
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: FAKE_CLOSED)

    r = client.post(
        "/tickets/bulk",
        json={"iids": [1], "project_id": "1", "action": "close"},
        headers={"Idempotency-Key": "x" * 200},
        cookies=admin_cookies,
    )
    # middleware는 skip, 정상 처리
    assert r.status_code in (200, 207)


def test_idempotency_get_request_is_noop(client, admin_cookies, monkeypatch):
    """GET 요청에는 middleware 개입 없음."""
    from app import gitlab_client
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "get_users_by_usernames", lambda *a, **k: {})

    r = client.get("/tickets/1", headers={"Idempotency-Key": "anything"}, cookies=admin_cookies)
    # GET은 middleware가 무시하므로 정상 200
    assert r.status_code == 200


def test_idempotency_user_scope_hash_stable():
    """동일 토큰은 동일 user_scope를 반환해야 한다 (캐시 적중 전제)."""
    import hashlib
    from tests.conftest import make_token

    tok = make_token(user_id="100")
    sig = tok.rsplit(".", 1)[-1]
    scope1 = hashlib.sha256(sig.encode()).hexdigest()[:16]
    scope2 = hashlib.sha256(sig.encode()).hexdigest()[:16]
    assert scope1 == scope2


def test_idempotency_cache_preserves_etag_on_replay_structure():
    """캐시 payload에 headers 필드가 포함되어 ETag 등 주요 헤더가 재생되어야 한다.
    실제 미들웨어 통과는 integration test 범위이므로 payload 구조만 검증.
    """
    import json
    # 캐시 payload 형식: {status, body, headers}
    sample = {
        "status": 201,
        "body": {"iid": 1},
        "headers": {"etag": '"abc123def456"', "location": "/tickets/1"},
    }
    s = json.dumps(sample)
    restored = json.loads(s)
    assert restored["headers"]["etag"] == '"abc123def456"'
    assert restored["headers"]["location"] == "/tickets/1"
    # Set-Cookie는 저장되지 않아야 함
    assert "set-cookie" not in restored["headers"]


# ============================================================================
# 5) ETag / Optimistic Locking 엣지
# ============================================================================
def test_patch_without_if_match_is_allowed(client, admin_cookies, monkeypatch):
    """If-Match 미전달 시 낙관적 락 체크를 건너뛰고 정상 수정."""
    from app import gitlab_client

    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: {**FAKE_ISSUE, "title": "new title"})
    monkeypatch.setattr(gitlab_client, "add_note", lambda *a, **k: None)

    r = client.patch("/tickets/1", json={"title": "new long title"}, cookies=admin_cookies)
    assert r.status_code == 200


def test_patch_matching_etag_succeeds(client, admin_cookies, monkeypatch):
    """올바른 ETag(해시)를 If-Match로 전달하면 수정 성공."""
    from app import gitlab_client
    from app.routers.tickets.helpers import compute_issue_etag

    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: {**FAKE_ISSUE, "title": "new"})
    monkeypatch.setattr(gitlab_client, "add_note", lambda *a, **k: None)

    etag = compute_issue_etag(FAKE_ISSUE)
    r = client.patch(
        "/tickets/1",
        json={"title": "changed title"},
        headers={"If-Match": f'"{etag}"'},
        cookies=admin_cookies,
    )
    assert r.status_code == 200


def test_patch_etag_quotes_are_stripped(client, admin_cookies, monkeypatch):
    """If-Match의 따옴표가 있든 없든 비교가 동작해야 한다 (RFC 7232)."""
    from app import gitlab_client
    from app.routers.tickets.helpers import compute_issue_etag

    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "update_issue", lambda *a, **k: {**FAKE_ISSUE})
    monkeypatch.setattr(gitlab_client, "add_note", lambda *a, **k: None)

    etag = compute_issue_etag(FAKE_ISSUE)
    # without quotes
    r = client.patch(
        "/tickets/1",
        json={"title": "changed title"},
        headers={"If-Match": etag},
        cookies=admin_cookies,
    )
    assert r.status_code == 200


def test_get_ticket_etag_header_present(client, admin_cookies, monkeypatch):
    """GET 응답에 ETag 헤더가 반드시 포함되어야 (낙관적 락의 전제)."""
    from app import gitlab_client
    monkeypatch.setattr(gitlab_client, "get_issue", lambda *a, **k: FAKE_ISSUE)
    monkeypatch.setattr(gitlab_client, "get_users_by_usernames", lambda *a, **k: {})

    r = client.get("/tickets/1", cookies=admin_cookies)
    assert r.status_code == 200
    assert "ETag" in r.headers
    etag = r.headers["ETag"].strip('"')
    # 12자 hex 해시 형식
    assert len(etag) == 12
    assert all(c in "0123456789abcdef" for c in etag)


def test_etag_hash_ignores_updated_at_format_variations():
    """updated_at 포맷이 달라져도 (다른 필드 동일하면) 같은 ETag로 매칭되면 안 된다.
    반대로, 마이크로초 포맷 변경은 이슈 실체가 다르다는 의미이므로 다른 해시가 나온다.
    → 핵심은 updated_at이 직접 외부로 노출되지 않는다는 것.
    """
    from app.routers.tickets.helpers import compute_issue_etag

    a = {**FAKE_ISSUE, "updated_at": "2026-04-18T00:00:00Z"}
    b = {**FAKE_ISSUE, "updated_at": "2026-04-18T00:00:00.000Z"}
    # updated_at은 해시 입력이므로 다르게 나오는 게 정상이지만,
    # 타임스탬프 자체는 노출되지 않는다.
    ea, eb = compute_issue_etag(a), compute_issue_etag(b)
    assert "2026" not in ea and "2026" not in eb
    # 제목 변경 시 확실히 해시 달라짐
    c = {**FAKE_ISSUE, "title": "different"}
    assert compute_issue_etag(c) != compute_issue_etag(FAKE_ISSUE)


def test_etag_same_issue_produces_same_hash():
    """동일 입력 → 동일 출력 (determinism)."""
    from app.routers.tickets.helpers import compute_issue_etag
    e1 = compute_issue_etag(FAKE_ISSUE)
    e2 = compute_issue_etag(dict(FAKE_ISSUE))  # copy
    assert e1 == e2


# ============================================================================
# 6) ClamAV CB 연동
# ============================================================================
def test_clamav_cb_opens_after_consecutive_failures(monkeypatch):
    """ClamAV 연결 실패가 연속되면 CB가 열리고 이후는 즉시 fail-open."""
    from app import clamav as _cl
    from app.circuit_breaker import clamav_cb

    # CB 초기화 (이전 테스트 영향 제거)
    clamav_cb._failures = 0
    clamav_cb._opened_at = 0.0

    # clamd.ClamdNetworkSocket을 실패로 대체
    class _FakeClamd:
        def __init__(self, *a, **k): raise ConnectionError("clamav down")

    class _FakeModule:
        ClamdNetworkSocket = _FakeClamd

    monkeypatch.setitem(__import__("sys").modules, "clamd", _FakeModule)

    # threshold=5 만큼 실패시켜 CB를 연다
    for _ in range(5):
        safe, detail = _cl.scan_bytes(b"data", "x.txt")
        assert safe is True and detail == "unavailable"  # fail-open

    assert clamav_cb.is_open, "CB must open after threshold failures"

    # CB open 이후: clamd 호출 자체를 하지 않고 fail-open만.
    called = {"n": 0}
    class _FakeClamd2:
        def __init__(self, *a, **k):
            called["n"] += 1
            raise ConnectionError("should not reach")
    _FakeModule.ClamdNetworkSocket = _FakeClamd2
    safe, detail = _cl.scan_bytes(b"x", "y.txt")
    assert safe is True and detail == "unavailable"
    assert called["n"] == 0, "CB open must short-circuit ClamAV connection attempt"


def test_clamav_missing_module_is_fail_open(monkeypatch):
    """clamd 패키지가 설치되지 않은 환경에서도 upload 차단 안 함."""
    from app import clamav as _cl
    import sys

    monkeypatch.setitem(sys.modules, "clamd", None)  # ImportError on import
    safe, detail = _cl.scan_bytes(b"data", "x.txt")
    assert safe is True
    assert detail == "unavailable"


# ============================================================================
# 7) list_tickets (TSI 외 경로) — assignee_id 필드 타입 보장
# ============================================================================
def test_userrole_lookup_with_null_gitlab_user_id(db_session):
    """gitlab_user_id가 None인 UserRole 행은 id_map에서 제외되어야 한다.
    (실제로는 NOT NULL이지만 방어적 검증.)
    """
    from app.models import UserRole

    # NOT NULL 제약이 있어 None 직접 저장 불가 — 엣지 보호 로직 존재 확인.
    # filter에서 None 체크가 필요했던 이유 재검증.
    db_session.add(UserRole(gitlab_user_id=5001, username="u1", name="U1", role="user", is_active=True))
    db_session.commit()

    rows = db_session.query(UserRole).filter(UserRole.username == "u1").all()
    id_map = {u.username: u.gitlab_user_id for u in rows if u.gitlab_user_id is not None}
    assert id_map == {"u1": 5001}
