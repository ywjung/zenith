"""
Tests for GitLab webhook endpoint — signature verification, log injection prevention (MED-03/LOW-05).
"""
import hashlib
import hmac
import json
from unittest.mock import patch, MagicMock

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


# ── 시크릿 설정 시 유효한 요청 ────────────────────────────────────────────

def _make_headers(secret: str, event: str = "Issue Hook", uuid: str = "test-uuid-001"):
    return {
        "X-Gitlab-Token": secret,
        "X-Gitlab-Event": event,
        "X-Gitlab-Event-Uuid": uuid,
    }


def test_webhook_correct_token_accepted(client):
    """올바른 시크릿으로 요청하면 200."""
    secret = "my_valid_secret_abc123"
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.REDIS_URL = "memory://"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps({"object_kind": "issue", "object_attributes": {"action": "open"}, "changes": {}}).encode(),
            headers=_make_headers(secret, "Issue Hook", "uuid-valid-001"),
        )
    assert resp.status_code in (200, 202)
    assert resp.json()["status"] in ("ok", "duplicate")


def test_webhook_wrong_token_rejected(client):
    """잘못된 시크릿은 401."""
    secret = "correct_secret_here"
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        resp = client.post(
            "/webhooks/gitlab",
            content=b"{}",
            headers=_make_headers("wrong_secret", "Issue Hook", "uuid-wrong"),
        )
    assert resp.status_code == 401


def test_webhook_invalid_json_returns_400(client):
    """잘못된 JSON — 400."""
    secret = "test_secret_for_json"
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=b"NOT_JSON",
            headers=_make_headers(secret, "Issue Hook", "uuid-bad-json"),
        )
    assert resp.status_code == 400


def test_webhook_payload_too_large(client):
    """10MB 초과 — 413."""
    secret = "test_secret_large"
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        large = b"x" * (10 * 1024 * 1024 + 1)
        resp = client.post(
            "/webhooks/gitlab",
            content=large,
            headers=_make_headers(secret, "Issue Hook", "uuid-large"),
        )
    assert resp.status_code == 413


# ── _verify_signature 단위 테스트 ─────────────────────────────────────────

def test_verify_signature_correct():
    from app.routers.webhooks import _verify_signature
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = "mysecret"
        assert _verify_signature(b"body", "mysecret") is True


def test_verify_signature_wrong_token():
    from app.routers.webhooks import _verify_signature
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = "mysecret"
        assert _verify_signature(b"body", "wrongsecret") is False


def test_verify_signature_no_secret_configured():
    """시크릿 미설정 — fail-closed (False 반환)."""
    from app.routers.webhooks import _verify_signature
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = ""
        assert _verify_signature(b"body", "") is False


# ── helper 단위 테스트 ────────────────────────────────────────────────────

def test_extract_email_from_description():
    from app.routers.webhooks import _extract_email_from_description
    desc = "**신청자:** 홍길동\n**이메일:** hong@example.com\n\n내용"
    assert _extract_email_from_description(desc) == "hong@example.com"


def test_extract_email_not_found():
    from app.routers.webhooks import _extract_email_from_description
    assert _extract_email_from_description("이메일 없는 내용") is None


def test_extract_email_empty_string():
    from app.routers.webhooks import _extract_email_from_description
    assert _extract_email_from_description("") is None


# ── _parse_submitter_username ─────────────────────────────────────────────────

def test_parse_submitter_username_found():
    from app.routers.webhooks import _parse_submitter_username
    desc = "**작성자:** testuser\n---\n내용"
    assert _parse_submitter_username(desc) == "testuser"


def test_parse_submitter_username_not_found():
    from app.routers.webhooks import _parse_submitter_username
    assert _parse_submitter_username("no author here") is None


def test_parse_submitter_username_empty_value():
    from app.routers.webhooks import _parse_submitter_username
    assert _parse_submitter_username("**작성자:**  \n내용") is None


# ── endpoint: various event types ────────────────────────────────────────────

def _webhook_headers(secret, event, uuid="evt-001"):
    return {
        "X-Gitlab-Token": secret,
        "X-Gitlab-Event": event,
        "X-Gitlab-Event-Uuid": uuid,
        "Content-Type": "application/json",
    }


def test_issue_hook_dispatched(client):
    """Issue Hook event accepted and returns ok."""
    secret = "secret_issue_hook"
    payload = {
        "object_kind": "issue",
        "object_attributes": {"iid": 1, "action": "open", "title": "T", "description": ""},
        "project": {"id": 1},
        "labels": [],
        "changes": {},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps(payload).encode(),
            headers=_webhook_headers(secret, "Issue Hook", "issue-open-001"),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] in ("ok", "duplicate")


def test_note_hook_dispatched(client):
    """Note Hook event accepted."""
    secret = "secret_note"
    payload = {
        "object_kind": "note",
        "object_attributes": {"noteable_type": "Issue", "note": "댓글", "confidential": False},
        "issue": {"iid": 1, "title": "테스트", "description": "", "assignees": []},
        "project_id": 1,
        "user": {"id": 99, "name": "Test", "username": "tester", "bot": False},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps(payload).encode(),
            headers=_webhook_headers(secret, "Note Hook", "note-001"),
        )
    assert resp.status_code == 200


def test_mr_hook_dispatched(client):
    """Merge Request Hook dispatched."""
    secret = "secret_mr"
    payload = {
        "object_kind": "merge_request",
        "object_attributes": {"iid": 5, "action": "open", "title": "Fixes #1", "description": "", "url": "http://x"},
        "project": {"id": 1},
        "user": {"name": "Dev", "username": "dev"},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps(payload).encode(),
            headers=_webhook_headers(secret, "Merge Request Hook", "mr-001"),
        )
    assert resp.status_code == 200


def test_push_hook_dispatched(client):
    """Push Hook dispatched."""
    secret = "secret_push"
    payload = {
        "object_kind": "push",
        "ref": "refs/heads/main",
        "project": {"id": 1, "name": "ITSM"},
        "commits": [{"id": "abc12345", "message": "Fixes #1 - bug fix", "url": "http://x"}],
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps(payload).encode(),
            headers=_webhook_headers(secret, "Push Hook", "push-001"),
        )
    assert resp.status_code == 200


def test_pipeline_hook_dispatched(client):
    """Pipeline Hook dispatched."""
    secret = "secret_pipeline"
    payload = {
        "object_kind": "pipeline",
        "object_attributes": {"id": 10, "status": "failed", "ref": "main"},
        "project": {"id": 1, "name": "ITSM"},
        "commits": [{"id": "abc12345", "message": "Fixes #1"}],
        "merge_request": None,
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.REDIS_URL = "memory://"
        resp = client.post(
            "/webhooks/gitlab",
            content=json.dumps(payload).encode(),
            headers=_webhook_headers(secret, "Pipeline Hook", "pipeline-001"),
        )
    assert resp.status_code == 200


# ── _handle_issue_hook unit tests ─────────────────────────────────────────────

def _issue_payload(action="open", state="opened", iid=1, project_id=1, labels=None):
    return {
        "object_kind": "issue",
        "object_attributes": {
            "iid": iid, "action": action, "state": state,
            "title": "Test issue", "description": "내용",
        },
        "project": {"id": project_id},
        "labels": labels or [],
        "changes": {},
        "user": {"name": "User", "username": "user1"},
    }


def test_handle_issue_hook_main_project_open():
    """Issue open on main project triggers _handle_external_issue for external issues."""
    from app.routers.webhooks import _handle_issue_hook

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._handle_external_issue") as mock_ext,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(_issue_payload("open", project_id=1))

    mock_ext.assert_called_once()


def test_handle_issue_hook_main_project_open_itsm_created():
    """Issue open but description has **신청자:** → not external, skip _handle_external_issue."""
    from app.routers.webhooks import _handle_issue_hook

    payload = _issue_payload("open", project_id=1)
    payload["object_attributes"]["description"] = "**신청자:** 홍길동\n내용"

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._handle_external_issue") as mock_ext,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(payload)

    mock_ext.assert_not_called()


def test_handle_issue_hook_main_project_close():
    """Issue close marks SLA resolved."""
    from app.routers.webhooks import _handle_issue_hook

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module") as mock_sla,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        _handle_issue_hook(_issue_payload("close", state="closed", project_id=1))

    mock_sla.mark_resolved.assert_called_once()


def test_handle_issue_hook_main_project_update():
    """Issue update calls _handle_issue_update."""
    from app.routers.webhooks import _handle_issue_hook

    payload = _issue_payload("update", project_id=1)
    payload["changes"] = {"title": {"previous": "old", "current": "new"}}

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._handle_issue_update") as mock_upd,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(payload)

    mock_upd.assert_called_once()


def test_handle_issue_hook_other_project():
    """Issue from other project calls _sync_forwarded_issue."""
    from app.routers.webhooks import _handle_issue_hook

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._sync_forwarded_issue") as mock_sync,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(_issue_payload("open", project_id=999))

    mock_sync.assert_called_once()


# ── _handle_issue_update unit tests ──────────────────────────────────────────

def test_handle_issue_update_bot_skipped():
    """Bot actor → return early."""
    from app.routers.webhooks import _handle_issue_update

    payload = {
        "user": {"username": "itsm-bot", "name": "ITSM Bot"},
        "changes": {"title": {"previous": "A", "current": "B"}},
        "object_attributes": {"description": ""},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_BOT_USERNAME = "itsm-bot"
        _handle_issue_update(1, "1", payload)
    # No exception, returned early


def test_handle_issue_update_no_changes():
    """Empty changes dict → return early."""
    from app.routers.webhooks import _handle_issue_update

    payload = {"user": {"username": "user1", "name": "User"}, "changes": {}, "object_attributes": {}}
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        _handle_issue_update(1, "1", payload)


def test_handle_issue_update_with_changes():
    """Various changes → log and notify."""
    from app.routers.webhooks import _handle_issue_update

    payload = {
        "user": {"username": "user1", "name": "User 1"},
        "changes": {
            "title": {"previous": "Old Title", "current": "New Title"},
            "description": {"previous": "", "current": "new desc"},
            "assignees": {"current": [{"username": "dev1"}]},
            "labels": {"current": [{"title": "status::in_progress"}]},
        },
        "object_attributes": {"description": "**작성자:** hong\n내용"},
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value="42"),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.create_db_notification"),
    ):
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        _handle_issue_update(1, "1", payload)


# ── _handle_note_hook unit tests ──────────────────────────────────────────────

def test_handle_note_hook_no_iid():
    """Note without iid → returns early."""
    from app.routers.webhooks import _handle_note_hook

    payload = {
        "object_attributes": {"noteable_type": "Issue", "note": "hi"},
        "issue": {},  # no iid
        "project_id": 1,
        "user": {"name": "U", "username": "u"},
    }
    _handle_note_hook(payload)


def test_handle_note_hook_bot_skipped():
    """Bot author → return early."""
    from app.routers.webhooks import _handle_note_hook

    payload = {
        "object_attributes": {"noteable_type": "Issue", "note": "bot msg"},
        "issue": {"iid": 1, "title": "T", "description": "", "assignees": []},
        "project_id": 1,
        "user": {"id": 0, "name": "Bot", "username": "gitlab-bot", "bot": True},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        _handle_note_hook(payload)


def test_handle_note_hook_regular_comment():
    """Regular comment → SLA mark, notification."""
    from app.routers.webhooks import _handle_note_hook

    payload = {
        "object_attributes": {"noteable_type": "Issue", "note": "좋은 댓글입니다.", "confidential": False},
        "issue": {
            "iid": 5, "title": "테스트 티켓",
            "description": "**신청자:** hong\n**이메일:** hong@example.com",
            "assignees": [{"id": 99}],
        },
        "project_id": 1,
        "user": {"id": 10, "name": "Commenter", "username": "commenter", "bot": False},
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module") as mock_sla,
        patch("app.routers.webhooks.notify_comment_added"),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value="42"),
    ):
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        _handle_note_hook(payload)

    mock_sla.mark_first_response.assert_called()


def test_handle_note_hook_internal_note():
    """Internal (confidential) note → no email notification."""
    from app.routers.webhooks import _handle_note_hook

    payload = {
        "object_attributes": {"noteable_type": "Issue", "note": "내부 메모", "confidential": True},
        "issue": {"iid": 3, "title": "T", "description": "", "assignees": []},
        "project_id": 1,
        "user": {"id": 10, "name": "Agent", "username": "agent", "bot": False},
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.routers.webhooks.notify_comment_added") as mock_notify,
        patch("app.routers.webhooks.create_db_notification"),
    ):
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        _handle_note_hook(payload)

    # Internal note should not call notify_comment_added
    mock_notify.assert_not_called()


# ── _handle_mr_hook unit tests ────────────────────────────────────────────────

def _mr_payload(action="merge", iid=5, description="Closes #1", project_id=1):
    return {
        "object_kind": "merge_request",
        "object_attributes": {
            "iid": iid, "action": action,
            "title": "Fix bug", "description": description,
            "url": "http://gitlab/mr/5",
            "merge_status": "can_be_merged",
        },
        "project": {"id": project_id},
        "user": {"name": "Dev", "username": "dev1"},
    }


def test_handle_mr_hook_merge_no_refs():
    """MR merge with no ticket references → just logs."""
    from app.routers.webhooks import _handle_mr_hook

    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(_mr_payload("merge", description="no ticket refs"))


def test_handle_mr_hook_merge_with_ref():
    """MR merge with Closes #1 → auto-resolve ticket."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {
        "iid": 1, "labels": ["status::open"], "description": "",
        "assignees": [],
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.gitlab_client.update_issue"),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value=None),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(_mr_payload("merge", description="Closes #1"))


def test_handle_mr_hook_open_with_ref():
    """MR open with ticket reference → notify assignees."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {
        "iid": 1, "labels": [], "description": "",
        "assignees": [{"id": 42}],
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.create_db_notification"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(_mr_payload("open", description="Fixes #1"))


def test_handle_mr_hook_approved():
    """MR approved → notify assignees."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {"iid": 1, "labels": [], "description": "", "assignees": [{"id": 10}]}
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.create_db_notification"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(_mr_payload("approved", description="Fixes #1"))


def test_handle_mr_hook_update_conflict():
    """MR update with cannot_be_merged → notify."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {"iid": 1, "labels": [], "description": "", "assignees": [{"id": 10}]}
    payload = _mr_payload("update", description="Fixes #1")
    payload["object_attributes"]["merge_status"] = "cannot_be_merged"

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.create_db_notification"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(payload)


def test_handle_mr_hook_already_resolved():
    """MR merge with ticket already resolved → skip."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {"iid": 1, "labels": ["status::resolved"], "description": "", "assignees": []}
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(_mr_payload("merge", description="Closes #1"))


# ── _handle_push_hook unit tests ──────────────────────────────────────────────

def test_handle_push_hook_no_refs():
    """Push with no ticket refs → returns early."""
    from app.routers.webhooks import _handle_push_hook

    payload = {
        "ref": "refs/heads/main",
        "project": {"id": 1, "name": "proj"},
        "commits": [{"id": "abc12345", "message": "regular commit", "url": "http://x"}],
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_push_hook(payload)


def test_handle_push_hook_with_refs():
    """Push with Fixes #1 → add comment."""
    from app.routers.webhooks import _handle_push_hook

    payload = {
        "ref": "refs/heads/feature-branch",
        "project": {"id": 1, "name": "ITSM"},
        "commits": [{"id": "abc12345", "message": "Fixes #1 bug fix", "url": "http://x"}],
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value={"iid": 1}),
        patch("app.gitlab_client.add_note"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_push_hook(payload)


def test_handle_push_hook_gitlab_error_swallowed():
    """GitLab error for ticket lookup is caught per-ticket."""
    from app.routers.webhooks import _handle_push_hook

    payload = {
        "ref": "refs/heads/main",
        "project": {"id": 1, "name": "proj"},
        "commits": [{"id": "abc12345", "message": "Closes #99 feature", "url": "http://x"}],
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", side_effect=Exception("Not found")),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_push_hook(payload)  # should not raise


# ── _handle_pipeline_hook unit tests ─────────────────────────────────────────

def test_handle_pipeline_hook_success_status():
    """Pipeline success → returns immediately (only failed pipelines matter)."""
    from app.routers.webhooks import _handle_pipeline_hook

    payload = {
        "object_attributes": {"id": 1, "status": "success", "ref": "main"},
        "project": {"id": 1, "name": "proj"},
        "commits": [],
        "merge_request": None,
    }
    _handle_pipeline_hook(payload)


def test_handle_pipeline_hook_failed_no_refs():
    """Pipeline failed but no commit refs → no action."""
    from app.routers.webhooks import _handle_pipeline_hook

    payload = {
        "object_attributes": {"id": 1, "status": "failed", "ref": "main"},
        "project": {"id": 1, "name": "proj"},
        "commits": [{"id": "abc", "message": "no ticket refs"}],
        "merge_request": None,
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_pipeline_hook(payload)


def test_handle_pipeline_hook_failed_with_refs():
    """Pipeline failed with ticket refs → add failure comment."""
    from app.routers.webhooks import _handle_pipeline_hook

    payload = {
        "object_attributes": {"id": 42, "status": "failed", "ref": "feature/x"},
        "project": {"id": 1, "name": "ITSM"},
        "commits": [{"id": "abc12345", "message": "Fixes #7 feature"}],
        "merge_request": None,
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value={"iid": 7}),
        patch("app.gitlab_client.add_note"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_pipeline_hook(payload)


def test_handle_pipeline_hook_with_mr_refs():
    """Pipeline failed, MR description has Closes #N."""
    from app.routers.webhooks import _handle_pipeline_hook

    payload = {
        "object_attributes": {"id": 5, "status": "failed", "ref": "main"},
        "project": {"id": 1, "name": "proj"},
        "commits": [],
        "merge_request": {"title": "Feature", "description": "Closes #3"},
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value={"iid": 3}),
        patch("app.gitlab_client.add_note"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_pipeline_hook(payload)


# ── _sync_forwarded_issue unit tests ─────────────────────────────────────────

def test_sync_forwarded_issue_no_record():
    """No forward record → returns silently."""
    from app.routers.webhooks import _sync_forwarded_issue

    with patch("app.routers.webhooks.SessionLocal") as mock_sl:
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _sync_forwarded_issue("999", 5, {"object_attributes": {"state": "opened"}, "labels": []})


def test_sync_forwarded_issue_with_record():
    """Forward record found → sync main ticket status."""
    from app.routers.webhooks import _sync_forwarded_issue

    mock_fwd = MagicMock()
    mock_fwd.source_iid = 1
    mock_fwd.source_project_id = "1"

    with (
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.forwards._sync_main_ticket_status") as mock_sync,
        patch("app.routers.forwards._FORWARD_TO_ITSM", {"closed": "resolved"}),
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_fwd
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        payload = {
            "object_attributes": {"state": "closed"},
            "labels": [],
        }
        _sync_forwarded_issue("999", 5, payload)

    mock_sync.assert_called_once_with(1, "1", "resolved")


# ── _get_gitlab_user_id_by_username unit tests ────────────────────────────────

def test_get_gitlab_user_id_empty_username():
    from app.routers.webhooks import _get_gitlab_user_id_by_username
    assert _get_gitlab_user_id_by_username("") is None


def test_get_gitlab_user_id_found(db_session):
    from app.routers.webhooks import _get_gitlab_user_id_by_username
    from app.models import UserRole
    db_session.add(UserRole(
        username="testuser",
        gitlab_user_id=42,
        role="user",
        name="Test",
    ))
    db_session.commit()

    # The function uses its own SessionLocal, so we mock it to use our db_session
    with patch("app.routers.webhooks.SessionLocal") as mock_sl:
        mock_sl.return_value.__enter__ = MagicMock(return_value=db_session)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        result = _get_gitlab_user_id_by_username("testuser")

    assert result == "42"


def test_get_gitlab_user_id_not_found():
    from app.routers.webhooks import _get_gitlab_user_id_by_username
    with patch("app.routers.webhooks.SessionLocal") as mock_sl:
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        result = _get_gitlab_user_id_by_username("nobody")
    assert result is None

# ── _is_duplicate unit tests ──────────────────────────────────────────────────

def test_is_duplicate_empty_uuid_returns_false():
    """Empty UUID → return False immediately (line 73)."""
    from app.routers.webhooks import _is_duplicate
    assert _is_duplicate("") is False


def test_is_duplicate_redis_none_returns_false():
    """When get_redis returns None → return False (line 78)."""
    from app.routers.webhooks import _is_duplicate
    with patch("app.redis_client.get_redis", return_value=None):
        assert _is_duplicate("some-uuid") is False


def test_is_duplicate_redis_exception_returns_false():
    """When redis raises → catch and return False (lines 82-84)."""
    from app.routers.webhooks import _is_duplicate
    from unittest.mock import MagicMock
    mock_r = MagicMock()
    mock_r.set.side_effect = Exception("redis down")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        assert _is_duplicate("some-uuid") is False


def test_is_duplicate_redis_returns_none_means_duplicate():
    """When r.set returns None → already exists → return True (line 81)."""
    from app.routers.webhooks import _is_duplicate
    from unittest.mock import MagicMock
    mock_r = MagicMock()
    mock_r.set.return_value = None  # key existed → duplicate
    with patch("app.redis_client.get_redis", return_value=mock_r):
        assert _is_duplicate("existing-uuid") is True


def test_webhook_duplicate_uuid_returns_duplicate(client):
    """When _is_duplicate returns True → 200 with status=duplicate (lines 103-104)."""
    secret = "my_valid_secret_abc123"
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._is_duplicate", return_value=True),
    ):
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = secret
        resp = client.post(
            "/webhooks/gitlab",
            content=b'{"object_kind": "issue"}',
            headers=_make_headers(secret, "Issue Hook", "dup-uuid-001"),
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "duplicate"


def test_handle_issue_hook_with_status_label():
    """status:: label parsed in open/update action (lines 161-162)."""
    from app.routers.webhooks import _handle_issue_hook

    payload = _issue_payload("open", project_id=1)
    payload["labels"] = [{"title": "status::in_progress"}]

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._handle_external_issue"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(payload)
    # Just verifying no exception


def test_handle_issue_hook_exception_swallowed():
    """Exception inside _handle_issue_hook is caught (lines 169-170)."""
    from app.routers.webhooks import _handle_issue_hook

    payload = _issue_payload("open", project_id=1)
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._handle_external_issue", side_effect=RuntimeError("boom")),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_issue_hook(payload)  # should not raise


def test_handle_issue_update_no_changed_fields_returns_early():
    """When no field changes → changed_fields empty → early return (line 212)."""
    from app.routers.webhooks import _handle_issue_update

    payload = {
        "user": {"username": "user1", "name": "User"},
        "changes": {"irrelevant_key": {"previous": "a", "current": "b"}},
        "object_attributes": {},
    }
    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        _handle_issue_update(1, "1", payload)  # should return early without exception


def test_handle_issue_update_exception_swallowed():
    """Exception in _handle_issue_update caught (lines 234-235)."""
    from app.routers.webhooks import _handle_issue_update

    payload = {
        "user": {"username": "user1", "name": "User"},
        "changes": {"title": {"previous": "A", "current": "B"}},
        "object_attributes": {"description": "**작성자:** user1\n내용"},
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", side_effect=RuntimeError("boom")),
    ):
        mock_cfg.return_value.GITLAB_BOT_USERNAME = ""
        _handle_issue_update(1, "1", payload)  # should not raise


def test_handle_external_issue_with_labels():
    """_handle_external_issue parses prio:: and cat:: labels (lines 251-254)."""
    from app.routers.webhooks import _handle_external_issue

    payload = {
        "labels": [
            {"title": "prio::high"},
            {"title": "cat::network"},
        ],
        "object_attributes": {"title": "외부 이슈", "description": ""},
        "user": {"name": "외부 사용자", "username": "ext_user"},
    }
    with (
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.routers.webhooks.notify_ticket_created"),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_external_issue(5, "1", payload.get("object_attributes", {}), payload)


def test_handle_external_issue_with_auto_assign():
    """_handle_external_issue with matching assignment rule → notify + gitlab update (lines 264-276)."""
    from app.routers.webhooks import _handle_external_issue
    from unittest.mock import MagicMock

    mock_rule = MagicMock()
    mock_rule.assignee_gitlab_id = "99"

    payload = {
        "labels": [],
        "object_attributes": {"title": "이슈", "description": ""},
        "user": {"name": "User", "username": "user"},
    }
    with (
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.assignment.evaluate_rules", return_value=mock_rule),
        patch("app.gitlab_client.update_issue"),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks.notify_ticket_created"),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_external_issue(5, "1", payload.get("object_attributes", {}), payload)


def test_handle_external_issue_auto_assign_exception_swallowed():
    """Auto-assign gitlab update raises → warning logged, no crash (lines 275-276)."""
    from app.routers.webhooks import _handle_external_issue

    mock_rule = MagicMock()
    mock_rule.assignee_gitlab_id = "99"

    payload = {
        "labels": [],
        "object_attributes": {"title": "이슈", "description": ""},
        "user": {"name": "User", "username": "user"},
    }
    with (
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.assignment.evaluate_rules", return_value=mock_rule),
        patch("app.gitlab_client.update_issue", side_effect=Exception("gitlab error")),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks.notify_ticket_created"),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_external_issue(5, "1", payload.get("object_attributes", {}), payload)
    # No exception raised — warning swallowed


def test_sync_forwarded_issue_opened_with_status_label():
    """_sync_forwarded_issue with opened state and status:: label (lines 327-331)."""
    from app.routers.webhooks import _sync_forwarded_issue

    mock_fwd = MagicMock()
    mock_fwd.source_iid = 1
    mock_fwd.source_project_id = "1"

    with (
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.forwards._sync_main_ticket_status") as mock_sync,
        patch("app.routers.forwards._FORWARD_TO_ITSM", {"in_progress": "in_progress"}),
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = mock_fwd
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        payload = {
            "object_attributes": {"state": "opened"},
            "labels": [{"title": "status::in_progress"}],
        }
        _sync_forwarded_issue("999", 5, payload)

    mock_sync.assert_called_once_with(1, "1", "in_progress")


def test_handle_mr_hook_plain_hash_ref():
    """MR merge with plain #N (no Closes keyword) hits fallback regex (line 506)."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {"iid": 1, "labels": ["status::open"], "description": "", "assignees": []}
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.gitlab_client.update_issue"),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value=None),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(_mr_payload("merge", description="Working on issue #1 (plain hash, no keyword)"))


def test_handle_mr_hook_approved_exception_swallowed():
    """MR approved where get_issue raises → exception swallowed (lines 542-543)."""
    from app.routers.webhooks import _handle_mr_hook

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", side_effect=Exception("not found")),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(_mr_payload("approved", description="Fixes #1"))


def test_handle_mr_hook_update_conflict_exception_swallowed():
    """MR update with conflict where get_issue raises → swallowed (lines 563-564)."""
    from app.routers.webhooks import _handle_mr_hook

    payload = _mr_payload("update", description="Fixes #1")
    payload["object_attributes"]["merge_status"] = "cannot_be_merged"

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", side_effect=Exception("not found")),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(payload)


def test_handle_mr_hook_unknown_action_returns_early():
    """Unknown MR action returns early at line 569."""
    from app.routers.webhooks import _handle_mr_hook

    with patch("app.routers.webhooks.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(_mr_payload("reopen", description="Fixes #1"))


def test_handle_mr_hook_merge_with_submitter_notification():
    """MR merge with submitter found → CSAT notification (line 608)."""
    from app.routers.webhooks import _handle_mr_hook

    fake_issue = {
        "iid": 1,
        "labels": ["status::open"],
        "description": "**신청자:** requester\n**작성자:** requester\n내용",
        "assignees": [],
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value=fake_issue),
        patch("app.gitlab_client.update_issue"),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.webhooks.SessionLocal") as mock_sl,
        patch("app.routers.webhooks.sla_module"),
        patch("app.routers.webhooks.create_db_notification"),
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value="42"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _handle_mr_hook(_mr_payload("merge", description="Closes #1"))


def test_handle_mr_hook_merge_exception_per_ticket():
    """MR merge where get_issue raises → per-ticket exception swallowed (lines 617-618)."""
    from app.routers.webhooks import _handle_mr_hook

    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", side_effect=Exception("ticket not found")),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_mr_hook(_mr_payload("merge", description="Closes #1"))


def test_handle_push_hook_max_iid_limit():
    """Push with 50+ ticket IIDs hits MAX_IIDS_PER_PUSH limit (lines 652, 658)."""
    from app.routers.webhooks import _handle_push_hook

    # 48 commits with 1 IID each
    commits = [
        {"id": f"abc{i:05d}", "message": f"Closes #{i} fix", "url": "http://x"}
        for i in range(1, 49)
    ]
    # Commit 49: 3 IIDs → inner break at IID 51 (line 658)
    commits.append({
        "id": "abc00049",
        "message": "Closes #49 Closes #50 Closes #51",
        "url": "http://x",
    })
    # Commit 50: outer break since len(referenced) == 50 (line 652)
    commits.append({"id": "abc00050", "message": "Closes #52", "url": "http://x"})

    payload = {
        "ref": "refs/heads/main",
        "project": {"id": 1, "name": "proj"},
        "commits": commits,
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value={"iid": 1}),
        patch("app.gitlab_client.add_note"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_push_hook(payload)


def test_handle_push_hook_exception_outer():
    """Outer exception in _handle_push_hook caught (lines 678-679)."""
    from app.routers.webhooks import _handle_push_hook

    with patch("app.routers.webhooks.get_settings", side_effect=Exception("config error")):
        _handle_push_hook({"ref": "refs/heads/main", "project": {}, "commits": []})


def test_handle_pipeline_hook_iid_limit():
    """Pipeline with 50+ ticket IIDs hits MAX_IIDS_PER_PUSH limit (lines 711, 716)."""
    from app.routers.webhooks import _handle_pipeline_hook

    commits = [
        {"id": f"abc{i:05d}", "message": f"Closes #{i}", "url": "http://x"}
        for i in range(1, 49)
    ]
    commits.append({"id": "abc00049", "message": "Closes #49 Closes #50 Closes #51", "url": "http://x"})
    commits.append({"id": "abc00050", "message": "Closes #52", "url": "http://x"})

    payload = {
        "object_attributes": {"id": 1, "status": "failed", "ref": "main"},
        "project": {"id": 1, "name": "proj"},
        "commits": commits,
        "merge_request": None,
    }
    with (
        patch("app.routers.webhooks.get_settings") as mock_cfg,
        patch("app.gitlab_client.get_issue", return_value={"iid": 1}),
        patch("app.gitlab_client.add_note"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        _handle_pipeline_hook(payload)


def test_handle_pipeline_hook_exception_outer():
    """Outer exception in _handle_pipeline_hook caught (lines 742-743)."""
    from app.routers.webhooks import _handle_pipeline_hook

    with patch("app.routers.webhooks.get_settings", side_effect=Exception("config error")):
        _handle_pipeline_hook({
            "object_attributes": {"id": 1, "status": "failed", "ref": "main"},
            "project": {},
            "commits": [],
            "merge_request": None,
        })
