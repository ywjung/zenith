"""Tests for the customer self-service portal endpoints."""
from unittest.mock import patch

FAKE_ISSUE = {
    "iid": 10,
    "title": "포털 테스트 티켓",
    "description": "**신청자:** 홍길동 (hong@example.com)\n\n---\n\n문제 내용",
    "state": "opened",
    "labels": ["status::open", "prio::medium", "cat::other"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "web_url": "http://gitlab/issues/10",
}

VALID_PORTAL_PAYLOAD = {
    "name": "홍길동",
    "email": "hong@example.com",
    "title": "프린터가 작동하지 않아요",
    "content": "1층 회의실 프린터가 급지 오류를 반복합니다.",
    "category": "hardware",
    "priority": "medium",
}


# ── /portal/submit ──────────────────────────────────────────────────────────

def test_portal_submit_creates_ticket(client):
    with (
        patch("app.gitlab_client.create_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.ensure_labels"),
        patch("app.routers.portal.send_email"),
        patch("app.routers.portal.evaluate_rules", return_value=None),
        patch("app.routers.portal.sla_module.create_sla_record"),
    ):
        resp = client.post("/portal/submit", json=VALID_PORTAL_PAYLOAD)
    assert resp.status_code == 200
    data = resp.json()
    assert "ticket_iid" in data
    assert "token" in data
    assert "track_url" in data


def test_portal_submit_invalid_email(client):
    payload = {**VALID_PORTAL_PAYLOAD, "email": "not-an-email"}
    resp = client.post("/portal/submit", json=payload)
    assert resp.status_code == 422


def test_portal_submit_title_too_short(client):
    payload = {**VALID_PORTAL_PAYLOAD, "title": ""}
    resp = client.post("/portal/submit", json=payload)
    assert resp.status_code == 422


def test_portal_submit_invalid_category_falls_back(client):
    """허용되지 않은 카테고리는 기본값으로 폴백되어야 한다."""
    payload = {**VALID_PORTAL_PAYLOAD, "category": "invalid_cat"}
    with (
        patch("app.gitlab_client.create_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.ensure_labels"),
        patch("app.routers.portal.send_email"),
        patch("app.routers.portal.evaluate_rules", return_value=None),
        patch("app.routers.portal.sla_module.create_sla_record"),
    ):
        resp = client.post("/portal/submit", json=payload)
    assert resp.status_code == 200


def test_portal_submit_gitlab_error(client):
    with (
        patch("app.gitlab_client.create_issue", side_effect=Exception("gitlab down")),
        patch("app.gitlab_client.ensure_labels"),
    ):
        resp = client.post("/portal/submit", json=VALID_PORTAL_PAYLOAD)
    assert resp.status_code == 502


# ── /portal/track/{token} ──────────────────────────────────────────────────

def test_portal_track_invalid_token_returns_404(client):
    resp = client.get("/portal/track/invalid-token-that-does-not-exist")
    assert resp.status_code == 404


def test_portal_track_valid_token(client):
    """토큰으로 포털 제출 후 추적 가능해야 한다."""
    with (
        patch("app.gitlab_client.create_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.ensure_labels"),
        patch("app.routers.portal.send_email"),
        patch("app.routers.portal.evaluate_rules", return_value=None),
        patch("app.routers.portal.sla_module.create_sla_record"),
    ):
        submit_resp = client.post("/portal/submit", json=VALID_PORTAL_PAYLOAD)
    assert submit_resp.status_code == 200
    token = submit_resp.json()["token"]

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        track_resp = client.get(f"/portal/track/{token}")
    assert track_resp.status_code == 200
    data = track_resp.json()
    assert data["ticket_iid"] == FAKE_ISSUE["iid"]
    assert "status" in data


# ── helpers ──────────────────────────────────────────────────────────────────

def test_build_description_includes_name_and_email():
    from app.routers.portal import _build_description
    result = _build_description("홍길동", "hong@example.com", "문제 내용")
    assert "홍길동" in result
    assert "hong@example.com" in result
    assert "문제 내용" in result


def test_parse_status_extracts_from_labels():
    from app.routers.portal import _parse_status
    assert _parse_status(["status::open", "prio::high"]) == "open"
    assert _parse_status(["status::resolved"]) == "resolved"
    assert _parse_status(["prio::medium"]) == "open"  # fallback


# ── error paths ───────────────────────────────────────────────────────────────

def test_portal_submit_sla_exception_non_fatal(client):
    """SLA record creation failure is non-fatal (lines 117-118)."""
    with (
        patch("app.gitlab_client.create_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.ensure_labels"),
        patch("app.routers.portal.send_email"),
        patch("app.routers.portal.evaluate_rules", return_value=None),
        patch("app.routers.portal.sla_module.create_sla_record", side_effect=Exception("SLA error")),
    ):
        resp = client.post("/portal/submit", json=VALID_PORTAL_PAYLOAD)
    assert resp.status_code == 200
    assert "ticket_iid" in resp.json()


def test_send_confirmation_email_exception_swallowed():
    """_send_confirmation swallows email exceptions (lines 166-167)."""
    from app.routers.portal import _send_confirmation
    with patch("app.routers.portal.send_email", side_effect=Exception("SMTP error")):
        _send_confirmation("test@example.com", "홍길동", 1, "http://example.com/track/tok")
    # No exception raised


def test_portal_track_gitlab_error_returns_502(client, db_session):
    """When get_issue raises, portal_track returns 502 (lines 190-192)."""
    import hashlib
    from datetime import datetime, timezone, timedelta
    from app.models import GuestToken

    raw_token = "test_track_token_502"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24)
    db_session.add(GuestToken(
        token=token_hash,
        email="hong@example.com",
        ticket_iid=10,
        project_id="1",
        expires_at=expires,
    ))
    db_session.commit()

    with patch("app.gitlab_client.get_issue", side_effect=Exception("gitlab down")):
        resp = client.get(f"/portal/track/{raw_token}")
    assert resp.status_code == 502
