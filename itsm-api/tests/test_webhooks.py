"""
Tests for GitLab webhook endpoint — signature verification, log injection prevention (MED-03/LOW-05).
"""
import hashlib
import hmac
import json
from unittest.mock import patch

NOTE_PAYLOAD = {
    "object_kind": "note",
    "user": {"name": "관리자", "username": "admin"},
    "object_attributes": {
        "noteable_type": "Issue",
        "noteable_id": 1,
        "note": "티켓이 처리되었습니다.",
        "noteable_iid": 1,
    },
    "issue": {
        "iid": 1,
        "title": "테스트 티켓",
        "state": "opened",
        "labels": ["status::open"],
    },
}


# ── signature / auth ──────────────────────────────────────────────────────────

def test_webhook_missing_token_returns_non_500(client):
    """No token should not cause a 500."""
    resp = client.post("/webhooks/gitlab", json=NOTE_PAYLOAD)
    assert resp.status_code != 500


# ── log injection prevention (MED-03 / LOW-05) ────────────────────────────────

def test_crlf_in_user_name_does_not_cause_500(client):
    """CRLF가 포함된 페이로드를 처리할 때 서버가 500을 반환하면 안 된다."""
    malicious_payload = {
        **NOTE_PAYLOAD,
        "user": {
            "name": "악의적\r\n사용자",
            "username": "evil\nuser",
        },
    }
    resp = client.post("/webhooks/gitlab", json=malicious_payload)
    assert resp.status_code != 500


def test_oversized_note_body_does_not_cause_500(client):
    """매우 긴 note body를 처리할 때 500이 발생하면 안 된다."""
    long_payload = {
        **NOTE_PAYLOAD,
        "object_attributes": {
            **NOTE_PAYLOAD["object_attributes"],
            "note": "A" * 100_000,
        },
    }
    resp = client.post("/webhooks/gitlab", json=long_payload)
    assert resp.status_code != 500


# ── _safe_str helper (unit test) ──────────────────────────────────────────────

def test_safe_str_strips_crlf():
    from app.routers.webhooks import _safe_str  # type: ignore[attr-defined]
    assert "\r" not in _safe_str("hello\r\nworld")
    assert "\n" not in _safe_str("hello\nworld")


def test_safe_str_truncates_to_max_len():
    from app.routers.webhooks import _safe_str  # type: ignore[attr-defined]
    result = _safe_str("A" * 1000, max_len=200)
    assert len(result) <= 200


def test_safe_str_removes_control_chars():
    from app.routers.webhooks import _safe_str  # type: ignore[attr-defined]
    result = _safe_str("\x00\x01\x1f테스트\x7f")
    assert "\x00" not in result
    assert "\x1f" not in result
    assert "테스트" in result
