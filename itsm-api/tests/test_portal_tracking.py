"""Tests for enhanced portal tracking endpoint (priority, category, SLA, comments, expires_at)."""
import hashlib
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

FAKE_ISSUE_LABELS = {
    "iid": 11,
    "title": "라벨 테스트 티켓",
    "description": "**신청자:** 이민준 (mj@example.com)\n\n---\n\n내용",
    "state": "opened",
    "labels": ["status::in_progress", "prio::high", "cat::network"],
    "created_at": "2024-03-01T10:00:00Z",
    "updated_at": "2024-03-01T12:00:00Z",
    "web_url": "http://gitlab/issues/11",
}

FAKE_NOTES = [
    {
        "id": 1001,
        "body": "담당자가 확인 중입니다.",
        "author": {"name": "김담당", "username": "kim"},
        "created_at": "2024-03-01T11:00:00Z",
        "internal": False,
        "system": False,
    },
    {
        "id": 1002,
        "body": "내부 메모입니다.",
        "author": {"name": "관리자", "username": "admin"},
        "created_at": "2024-03-01T11:30:00Z",
        "internal": True,
        "system": False,
    },
    {
        "id": 1003,
        "body": "Label added: status::in_progress",
        "author": {"name": "system", "username": "system"},
        "created_at": "2024-03-01T12:00:00Z",
        "internal": False,
        "system": True,
    },
]


def _create_guest_token(db_session, ticket_iid: int, project_id: str = "1",
                         days: int = 7, raw_token: str = "test_enhanced_token") -> str:
    """DB에 게스트 토큰을 직접 생성해 테스트용 토큰 문자열을 반환한다."""
    from app.models import GuestToken

    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=days)
    guest = GuestToken(
        token=token_hash,
        email="mj@example.com",
        ticket_iid=ticket_iid,
        project_id=project_id,
        expires_at=expires,
    )
    db_session.add(guest)
    db_session.commit()
    return raw_token


# ── priority / category parsing ───────────────────────────────────────────────

def test_portal_track_returns_priority_and_category(client, db_session):
    """priority 및 category 레이블이 응답에 포함돼야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11)

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["priority"] == "high"
    assert data["category"] == "network"
    assert data["status"] == "in_progress"


def test_portal_track_no_priority_label_returns_none(client, db_session):
    """prio:: 레이블 없으면 priority는 null이어야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_no_prio")
    issue = {**FAKE_ISSUE_LABELS, "labels": ["status::open", "cat::hardware"]}

    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["priority"] is None
    assert data["category"] == "hardware"


# ── public comments filtering ─────────────────────────────────────────────────

def test_portal_track_returns_only_public_comments(client, db_session):
    """internal 댓글과 system 메모는 제외하고 공개 댓글만 반환해야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_comments")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=FAKE_NOTES),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    comments = data["comments"]
    # internal(id=1002)와 system(id=1003)은 제외돼야 한다
    assert len(comments) == 1
    assert comments[0]["id"] == 1001
    assert comments[0]["body"] == "담당자가 확인 중입니다."
    assert comments[0]["author_name"] == "김담당"


def test_portal_track_notes_error_returns_empty_comments(client, db_session):
    """get_notes 실패 시 comments는 빈 리스트로 반환돼야 한다 (비치명적)."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_notes_err")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", side_effect=Exception("GitLab API error")),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    assert resp.json()["comments"] == []


# ── expires_at ────────────────────────────────────────────────────────────────

def test_portal_track_includes_expires_at(client, db_session):
    """응답에 expires_at (게스트 토큰 만료 시각) 이 포함돼야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, days=5,
                                    raw_token="tok_expiry")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["expires_at"] is not None
    # 만료 시각이 현재보다 미래여야 한다 (naive datetime으로 비교)
    expires_str = data["expires_at"].rstrip("Z").split("+")[0]
    expires = datetime.fromisoformat(expires_str)
    assert expires > datetime.now()


# ── SLA fields ────────────────────────────────────────────────────────────────

def test_portal_track_no_sla_record_returns_null_sla(client, db_session):
    """SLARecord가 없으면 sla_deadline=null, sla_breached=false 이어야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_no_sla")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["sla_deadline"] is None
    assert data["sla_breached"] is False


def test_portal_track_with_sla_record(client, db_session):
    """SLARecord가 있으면 sla_deadline과 sla_breached가 응답에 반영돼야 한다."""
    from app.models import SLARecord

    deadline = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=8)
    sla = SLARecord(
        gitlab_issue_iid=11,
        project_id="1",
        priority="high",
        sla_deadline=deadline,
        breached=False,
    )
    db_session.add(sla)
    db_session.commit()

    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_with_sla")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["sla_deadline"] is not None
    assert data["sla_breached"] is False


def test_portal_track_breached_sla(client, db_session):
    """sla_breached=True 인 SLARecord가 있으면 응답에 sla_breached=true가 반환돼야 한다."""
    from app.models import SLARecord

    deadline = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    sla = SLARecord(
        gitlab_issue_iid=11,
        project_id="1",
        priority="high",
        sla_deadline=deadline,
        breached=True,
    )
    db_session.add(sla)
    db_session.commit()

    raw_token = _create_guest_token(db_session, ticket_iid=11, raw_token="tok_breached")

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE_LABELS),
        patch("app.gitlab_client.get_notes", return_value=[]),
    ):
        resp = client.get(f"/portal/track/{raw_token}")

    assert resp.status_code == 200
    assert resp.json()["sla_breached"] is True


# ── POST /portal/extend/{token} ───────────────────────────────────────────────

def test_portal_extend_token_increases_expiry(client, db_session):
    """토큰 연장 요청 시 expires_at이 증가해야 한다."""
    raw_token = _create_guest_token(db_session, ticket_iid=11, days=1,
                                    raw_token="tok_extend_test")

    from app.models import GuestToken
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    before = db_session.query(GuestToken).filter_by(token=token_hash).first()
    original_expiry = before.expires_at

    resp = client.post(f"/portal/extend/{raw_token}")
    assert resp.status_code == 200

    db_session.expire_all()
    after = db_session.query(GuestToken).filter_by(token=token_hash).first()
    assert after.expires_at > original_expiry


def test_portal_extend_invalid_token_returns_404(client):
    """존재하지 않는 토큰 연장은 404를 반환해야 한다."""
    resp = client.post("/portal/extend/nonexistent_token_xyz")
    assert resp.status_code == 404
