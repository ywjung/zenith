"""Unit tests for ticket router utility functions (pure functions, no HTTP)."""
from unittest.mock import patch, MagicMock


# ── _sanitize_comment ─────────────────────────────────────────────────────────

def test_sanitize_comment_empty_string():
    """Empty comment returns '' (covers line 255)."""
    from app.routers.tickets import _sanitize_comment
    assert _sanitize_comment("") == ""


def test_sanitize_comment_strips_html():
    from app.routers.tickets import _sanitize_comment
    result = _sanitize_comment("<script>alert(1)</script>hello")
    assert "<script>" not in result
    assert "hello" in result


def test_sanitize_comment_truncates_long():
    from app.routers.tickets import _sanitize_comment
    long_text = "a" * 60000
    result = _sanitize_comment(long_text)
    assert len(result) <= 50000


# ── _parse_labels ─────────────────────────────────────────────────────────────

def test_parse_labels_normal():
    from app.routers.tickets import _parse_labels
    labels = ["cat::network", "prio::high", "status::open"]
    result = _parse_labels(labels)
    assert result["category"] == "network"
    assert result["priority"] == "high"
    assert result["status"] == "open"


def test_parse_labels_corrupt_priority_enum():
    """Corrupt 'PriorityEnum.MEDIUM' style label → normalized to 'medium' (covers line 315)."""
    from app.routers.tickets import _parse_labels
    labels = ["prio::PriorityEnum.MEDIUM"]
    result = _parse_labels(labels)
    assert result["priority"] == "medium"


def test_parse_labels_corrupt_status_enum():
    """Corrupt 'StatusEnum.IN_PROGRESS' style label → normalized to 'in_progress' (covers line 321)."""
    from app.routers.tickets import _parse_labels
    labels = ["status::StatusEnum.IN_PROGRESS"]
    result = _parse_labels(labels)
    assert result["status"] == "in_progress"


# ── _extract_meta ─────────────────────────────────────────────────────────────

def test_extract_meta_plain_text_format():
    """Plain text format '신청자:' (no bold) parsed (covers line 343)."""
    from app.routers.tickets import _extract_meta
    desc = "신청자: 홍길동\n**이메일:** hong@example.com\n---\n내용"
    meta = _extract_meta(desc)
    assert meta["employee_name"] == "홍길동"


def test_extract_meta_department_and_location():
    """**부서:** and **위치:** fields (covers lines 347, 349)."""
    from app.routers.tickets import _extract_meta
    desc = "**신청자:** 홍길동\n**이메일:** hong@example.com\n**부서:** IT팀\n**위치:** 서울\n---\n내용"
    meta = _extract_meta(desc)
    assert meta["department"] == "IT팀"
    assert meta["location"] == "서울"


def test_extract_meta_created_by():
    """**작성자:** field (covers line 351)."""
    from app.routers.tickets import _extract_meta
    desc = "**신청자:** A\n**작성자:** agent1\n---\n내용"
    meta = _extract_meta(desc)
    assert meta["created_by_username"] == "agent1"


# ── _dispatch_notification ────────────────────────────────────────────────────

def test_dispatch_notification_celery_path():
    """When REDIS_URL != 'memory://', dispatches via Celery .delay() (covers lines 49-50)."""
    from app.routers.tickets import _dispatch_notification
    mock_bg = MagicMock()
    mock_task = MagicMock()
    mock_fn = MagicMock()

    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.CELERY_BROKER_URL = None
        mock_cfg.return_value.REDIS_URL = "redis://localhost:6379"
        _dispatch_notification(mock_bg, mock_task, mock_fn, "arg1")

    mock_task.delay.assert_called_once_with("arg1")
    mock_fn.assert_not_called()


def test_dispatch_notification_celery_exception_falls_back():
    """Celery .delay() raises → swallows, falls back to BackgroundTasks (covers lines 51-52)."""
    from app.routers.tickets import _dispatch_notification
    mock_bg = MagicMock()
    mock_task = MagicMock()
    mock_task.delay.side_effect = Exception("celery error")
    mock_fn = MagicMock()

    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.CELERY_BROKER_URL = None
        mock_cfg.return_value.REDIS_URL = "redis://localhost:6379"
        _dispatch_notification(mock_bg, mock_task, mock_fn, "arg1")

    mock_bg.add_task.assert_called_once_with(mock_fn, "arg1")


def test_dispatch_notification_memory_uses_background_tasks():
    """REDIS_URL = 'memory://' → uses BackgroundTasks."""
    from app.routers.tickets import _dispatch_notification
    mock_bg = MagicMock()
    mock_task = MagicMock()
    mock_fn = MagicMock()

    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.CELERY_BROKER_URL = None
        mock_cfg.return_value.REDIS_URL = "memory://"
        _dispatch_notification(mock_bg, mock_task, mock_fn, "arg1")

    mock_task.delay.assert_not_called()
    mock_bg.add_task.assert_called_once_with(mock_fn, "arg1")


# ── _invalidate_ticket_list_cache ─────────────────────────────────────────────

def test_invalidate_ticket_list_cache_no_redis():
    """When Redis is None, no-op."""
    from app.routers.tickets import _invalidate_ticket_list_cache
    with patch("app.routers.tickets.helpers._get_redis", return_value=None):
        _invalidate_ticket_list_cache()  # should not raise


def test_invalidate_ticket_list_cache_with_project_id():
    """With project_id, also invalidates 'all' cache (covers lines 71, 76-77)."""
    from app.routers.tickets import _invalidate_ticket_list_cache
    mock_r = MagicMock()
    mock_r.scan.return_value = (0, [])
    with patch("app.routers.tickets.helpers._get_redis", return_value=mock_r):
        _invalidate_ticket_list_cache("123")
    # Should call incr for both project and 'all'
    assert mock_r.incr.call_count >= 2


def test_invalidate_ticket_list_cache_no_project_id():
    """Without project_id, only invalidates 'all'."""
    from app.routers.tickets import _invalidate_ticket_list_cache
    mock_r = MagicMock()
    mock_r.scan.return_value = (0, [])
    with patch("app.routers.tickets.helpers._get_redis", return_value=mock_r):
        _invalidate_ticket_list_cache()
    mock_r.incr.assert_called_once()


# ── _detect_mime_from_bytes ───────────────────────────────────────────────────

def test_detect_mime_jpeg():
    from app.routers.tickets import _detect_mime_from_bytes
    jpeg_bytes = b"\xff\xd8\xff" + b"\x00" * 100
    result = _detect_mime_from_bytes(jpeg_bytes)
    assert result == "image/jpeg"


def test_detect_mime_png():
    from app.routers.tickets import _detect_mime_from_bytes
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    result = _detect_mime_from_bytes(png_bytes)
    assert result == "image/png"


def test_detect_mime_pdf():
    from app.routers.tickets import _detect_mime_from_bytes
    pdf_bytes = b"%PDF-1.4" + b"\x00" * 100
    result = _detect_mime_from_bytes(pdf_bytes)
    assert result == "application/pdf"


def test_detect_mime_webp():
    """RIFF + WEBP magic bytes → image/webp (covers lines 115-117)."""
    from app.routers.tickets import _detect_mime_from_bytes
    # RIFF....WEBP
    webp_bytes = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 100
    result = _detect_mime_from_bytes(webp_bytes)
    assert result == "image/webp"


def test_detect_mime_riff_not_webp():
    """RIFF without WEBP marker → returns None (covers line 118)."""
    from app.routers.tickets import _detect_mime_from_bytes
    riff_bytes = b"RIFF\x00\x00\x00\x00AVI " + b"\x00" * 100
    result = _detect_mime_from_bytes(riff_bytes)
    assert result is None


def test_detect_mime_unknown_uses_magic_fallback():
    """Unknown magic bytes → tries python-magic (covers lines 121-131)."""
    from app.routers.tickets import _detect_mime_from_bytes
    unknown_bytes = b"\x00\x01\x02\x03" * 100

    import sys
    # Ensure magic module is mocked to return a mime type
    mock_magic = MagicMock()
    mock_magic.from_buffer.return_value = "application/octet-stream"
    with patch.dict(sys.modules, {"magic": mock_magic}):
        result = _detect_mime_from_bytes(unknown_bytes)
    assert result == "application/octet-stream"


# ── _validate_magic_bytes ─────────────────────────────────────────────────────

def test_validate_magic_bytes_zip_for_docx():
    """ZIP magic bytes for docx declared mime → passes (covers lines 159-160)."""
    from app.routers.tickets import _validate_magic_bytes
    zip_bytes = b"PK\x03\x04" + b"\x00" * 100
    _validate_magic_bytes(
        zip_bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )  # should not raise


def test_validate_magic_bytes_ole2_for_doc():
    """OLE2 magic bytes for doc declared mime → passes (covers lines 161-162)."""
    from app.routers.tickets import _validate_magic_bytes
    ole2_bytes = b"\xd0\xcf\x11\xe0" + b"\x00" * 100
    _validate_magic_bytes(ole2_bytes, "application/msword")  # should not raise


def test_validate_magic_bytes_executable_blocked():
    """MZ (Windows PE) magic bytes → 400 (covers lines 141-144)."""
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _validate_magic_bytes

    with patch("app.routers.tickets.helpers._detect_mime_from_bytes", return_value=None):
        with pytest.raises(HTTPException) as exc:
            _validate_magic_bytes(b"MZ\x00\x00" + b"\x00" * 100, "application/octet-stream")
    assert exc.value.status_code == 400


def test_validate_magic_bytes_pdf_ok():
    """PDF magic bytes with declared pdf mime → passes."""
    from app.routers.tickets import _validate_magic_bytes
    pdf_bytes = b"%PDF-1.4" + b"\x00" * 100
    _validate_magic_bytes(pdf_bytes, "application/pdf")  # should not raise


def test_validate_magic_bytes_disallowed_detected_raises():
    """Detected mime not in ALLOWED_MIME_TYPES → 400 (covers lines 163-164)."""
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _validate_magic_bytes

    # Patch _detect_mime_from_bytes to return a disallowed type
    with patch("app.routers.tickets.helpers._detect_mime_from_bytes", return_value="video/mp4"):
        with pytest.raises(HTTPException) as exc:
            _validate_magic_bytes(b"\x00" * 100, "video/mp4")
    assert exc.value.status_code == 400


# ── list tickets as non-admin user ────────────────────────────────────────────

def test_list_tickets_as_user(client, user_cookies):
    """Non-admin user uses get_all_issues (covers lines 426-432)."""
    from unittest.mock import patch
    fake = {
        "iid": 5, "title": "제목", "description": "", "state": "opened",
        "labels": ["cat::network", "prio::medium", "status::open"],
        "created_at": "2024-01-01T00:00:00Z", "updated_at": "2024-01-01T00:00:00Z",
        "web_url": "http://gitlab/issues/5",
    }
    with patch("app.gitlab_client.get_all_issues", return_value=[fake]):
        resp = client.get("/tickets/", cookies=user_cookies)
    assert resp.status_code == 200


def test_list_tickets_with_project_filter(client, admin_cookies):
    """List tickets with project_id filter."""
    from unittest.mock import patch
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/tickets/?project_id=1", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_user_own_only(client, user_cookies):
    """User with own=true filter."""
    from unittest.mock import patch
    with patch("app.gitlab_client.get_all_issues", return_value=[]):
        resp = client.get("/tickets/?own=true", cookies=user_cookies)
    assert resp.status_code == 200


# ── _get_issue_requester ──────────────────────────────────────────────────────

def test_get_issue_requester_from_created_by():
    """**작성자:** present → use as username (covers line 454)."""
    from app.routers.tickets import _get_issue_requester
    issue = {
        "description": "**신청자:** 홍길동\n**작성자:** agent1\n---\n내용",
        "author": {"username": "admin", "name": "Admin"},
    }
    username, name = _get_issue_requester(issue)
    assert username == "agent1"


def test_get_issue_requester_bot_with_employee_name():
    """Bot author + employee_name in meta → uses employee_name (covers line 455-457)."""
    from app.routers.tickets import _get_issue_requester
    issue = {
        "description": "**신청자:** 홍길동\n---\n내용",
        "author": {"username": "gitlab-bot", "name": "GitLab Bot"},
    }
    username, name = _get_issue_requester(issue)
    assert username == "홍길동"


def test_get_issue_requester_regular_author():
    """Regular (non-bot) author → uses author username (line 459)."""
    from app.routers.tickets import _get_issue_requester
    issue = {
        "description": "내용",
        "author": {"username": "kim", "name": "김철수"},
    }
    username, name = _get_issue_requester(issue)
    assert username == "kim"


# ── _can_requester_modify ─────────────────────────────────────────────────────

def test_can_requester_modify_open_and_same_user():
    """Status 'open' + username matches → True (covers lines 466-471)."""
    from app.routers.tickets import _can_requester_modify
    issue = {
        "state": "opened",
        "labels": ["status::open"],
        "description": "**신청자:** hong\n**작성자:** hong\n---\n내용",
        "author": {"username": "hong"},
    }
    user = {"username": "hong"}
    assert _can_requester_modify(issue, user) is True


def test_can_requester_modify_non_open():
    """Non-open status → False."""
    from app.routers.tickets import _can_requester_modify
    issue = {
        "state": "opened",
        "labels": ["status::in_progress"],
        "description": "",
        "author": {"username": "hong"},
    }
    user = {"username": "hong"}
    assert _can_requester_modify(issue, user) is False


# ── _is_issue_assigned_to_user ────────────────────────────────────────────────

def test_is_issue_assigned_to_user_by_id():
    """Assignee id matches user sub → True (covers lines 476-490)."""
    from app.routers.tickets import _is_issue_assigned_to_user
    issue = {"assignees": [{"id": 42, "username": "hong"}]}
    user = {"sub": "42", "username": "other"}
    assert _is_issue_assigned_to_user(issue, user) is True


def test_is_issue_assigned_to_user_by_username():
    """Assignee username matches user username → True."""
    from app.routers.tickets import _is_issue_assigned_to_user
    issue = {"assignees": [{"id": 99, "username": "hong"}]}
    user = {"sub": "42", "username": "hong"}
    assert _is_issue_assigned_to_user(issue, user) is True


def test_is_issue_not_assigned():
    """No matching assignee → False."""
    from app.routers.tickets import _is_issue_assigned_to_user
    issue = {"assignees": [{"id": 10, "username": "other"}]}
    user = {"sub": "42", "username": "hong"}
    assert _is_issue_assigned_to_user(issue, user) is False


def test_is_issue_no_assignees():
    """Empty assignees → False."""
    from app.routers.tickets import _is_issue_assigned_to_user
    issue = {"assignees": []}
    user = {"sub": "42", "username": "hong"}
    assert _is_issue_assigned_to_user(issue, user) is False


# ── _strip_image_metadata ─────────────────────────────────────────────────────

def test_strip_image_metadata_non_strippable_returns_unchanged():
    """GIF mime → not in _STRIPPABLE → returns content as-is (covers line 175-177)."""
    from app.routers.tickets import _strip_image_metadata
    content = b"GIF89a" + b"\x00" * 50
    result = _strip_image_metadata(content, "image/gif")
    assert result == content


def test_strip_image_metadata_exception_returns_original():
    """Pillow fails with non-ImportError → fail-open returns original (covers 199-201)."""
    import sys
    from app.routers.tickets import _strip_image_metadata

    mock_pil = MagicMock()
    mock_pil.Image.open.side_effect = Exception("corrupt image")
    with patch.dict(sys.modules, {"PIL": mock_pil, "PIL.Image": mock_pil.Image}):
        content = b"\xff\xd8\xff" + b"\x00" * 50
        result = _strip_image_metadata(content, "image/jpeg")
    assert result == content


# ── _scan_with_clamav ─────────────────────────────────────────────────────────

def test_scan_with_clamav_disabled():
    """CLAMAV_ENABLED=False → skip scan (covers line 212-213)."""
    from app.routers.tickets import _scan_with_clamav
    with patch("app.routers.tickets.helpers.get_settings") as mock_cfg:
        mock_cfg.return_value.CLAMAV_ENABLED = False
        _scan_with_clamav(b"content", "test.txt")  # should not raise


def test_scan_with_clamav_connection_fails_strict_mode():
    """ClamAV connection fails in strict mode → 503 (covers lines 218-238)."""
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _scan_with_clamav

    with (
        patch("app.routers.tickets.helpers.get_settings") as mock_cfg,
        patch("socket.create_connection", side_effect=Exception("connection refused")),
    ):
        mock_cfg.return_value.CLAMAV_ENABLED = True
        mock_cfg.return_value.CLAMAV_STRICT = True
        mock_cfg.return_value.CLAMAV_HOST = "clamav"
        mock_cfg.return_value.CLAMAV_PORT = 3310
        with pytest.raises(HTTPException) as exc:
            _scan_with_clamav(b"content", "test.txt")
    assert exc.value.status_code == 503


def test_scan_with_clamav_connection_fails_non_strict():
    """ClamAV connection fails in non-strict mode → passes through (fail-open)."""
    from app.routers.tickets import _scan_with_clamav

    with (
        patch("app.routers.tickets.helpers.get_settings") as mock_cfg,
        patch("socket.create_connection", side_effect=Exception("connection refused")),
    ):
        mock_cfg.return_value.CLAMAV_ENABLED = True
        mock_cfg.return_value.CLAMAV_STRICT = False
        mock_cfg.return_value.CLAMAV_HOST = "clamav"
        mock_cfg.return_value.CLAMAV_PORT = 3310
        _scan_with_clamav(b"content", "test.txt")  # should not raise


def test_scan_with_clamav_clean_file():
    """ClamAV returns OK → no exception (covers lines 222-231)."""
    from app.routers.tickets import _scan_with_clamav
    import socket

    mock_socket = MagicMock()
    mock_socket.recv.return_value = b"stream: OK"
    mock_socket.__enter__ = MagicMock(return_value=mock_socket)
    mock_socket.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.routers.tickets.helpers.get_settings") as mock_cfg,
        patch("socket.create_connection", return_value=mock_socket),
    ):
        mock_cfg.return_value.CLAMAV_ENABLED = True
        mock_cfg.return_value.CLAMAV_STRICT = True
        mock_cfg.return_value.CLAMAV_HOST = "clamav"
        mock_cfg.return_value.CLAMAV_PORT = 3310
        _scan_with_clamav(b"content", "test.txt")  # should not raise


def test_scan_with_clamav_virus_found():
    """ClamAV returns FOUND → 400 (covers lines 233+)."""
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _scan_with_clamav

    mock_socket = MagicMock()
    mock_socket.recv.return_value = b"stream: Eicar-Test-Signature FOUND"
    mock_socket.__enter__ = MagicMock(return_value=mock_socket)
    mock_socket.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.routers.tickets.helpers.get_settings") as mock_cfg,
        patch("socket.create_connection", return_value=mock_socket),
    ):
        mock_cfg.return_value.CLAMAV_ENABLED = True
        mock_cfg.return_value.CLAMAV_STRICT = True
        mock_cfg.return_value.CLAMAV_HOST = "clamav"
        mock_cfg.return_value.CLAMAV_PORT = 3310
        with pytest.raises(HTTPException) as exc:
            _scan_with_clamav(b"malware", "test.txt")
    assert exc.value.status_code == 400


# ── _detect_mime_from_bytes: ImportError and exception paths ──────────────────

def test_detect_mime_import_error_raises_503():
    """python-magic not installed → ImportError → 503 (covers lines 124-129)."""
    import sys
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _detect_mime_from_bytes

    unknown_bytes = b"\x00\x01\x02\x03" * 100
    with patch.dict(sys.modules, {"magic": None}):
        with pytest.raises(HTTPException) as exc:
            _detect_mime_from_bytes(unknown_bytes)
    assert exc.value.status_code == 503


def test_detect_mime_magic_exception_returns_none():
    """python-magic raises non-ImportError exception → returns None (covers lines 130-132)."""
    import sys
    from app.routers.tickets import _detect_mime_from_bytes

    mock_magic = MagicMock()
    mock_magic.from_buffer.side_effect = Exception("magic error")
    unknown_bytes = b"\x00\x01\x02\x03" * 100
    with patch.dict(sys.modules, {"magic": mock_magic}):
        result = _detect_mime_from_bytes(unknown_bytes)
    assert result is None


# ── _validate_magic_bytes: executable ELF and non-executable unknown ──────────

def test_validate_magic_bytes_elf_blocked():
    """ELF magic bytes → 400 (covers lines 141-144)."""
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _validate_magic_bytes

    with patch("app.routers.tickets.helpers._detect_mime_from_bytes", return_value=None):
        with pytest.raises(HTTPException) as exc:
            _validate_magic_bytes(b"\x7fELF" + b"\x00" * 100, "application/octet-stream")
    assert exc.value.status_code == 400


def test_validate_magic_bytes_unknown_non_executable_passes():
    """Unknown mime, no executable pattern → passes through → return (covers line 145)."""
    from app.routers.tickets import _validate_magic_bytes

    with patch("app.routers.tickets.helpers._detect_mime_from_bytes", return_value=None):
        _validate_magic_bytes(b"\xCA\xFE\xBA\xBE" + b"\x00" * 100, "text/plain")
        # should not raise


# ── _strip_image_metadata: Pillow import error ───────────────────────────────

def test_strip_image_metadata_pil_import_error_raises_503():
    """Pillow not installed → ImportError → 503 (covers lines 192-196)."""
    import sys
    import pytest
    from fastapi import HTTPException
    from app.routers.tickets import _strip_image_metadata

    with patch.dict(sys.modules, {"PIL": None, "PIL.Image": None}):
        with pytest.raises(HTTPException) as exc:
            _strip_image_metadata(b"\xff\xd8\xff" + b"\x00" * 50, "image/jpeg")
    assert exc.value.status_code == 503


# ── _issue_to_response: with web_url containing project path ─────────────────

def test_issue_to_response_extracts_project_path():
    """Issue with web_url containing project path → project_path extracted (covers line 375)."""
    from app.routers.tickets import _issue_to_response
    issue = {
        "iid": 1,
        "title": "테스트 티켓",
        "description": "**신청자:** 홍\n---\n내용",
        "state": "opened",
        "labels": ["cat::network", "prio::medium", "status::open"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "web_url": "http://gitlab.example.com/mygroup/myproject/-/issues/1",
        "author": {"id": 1, "username": "admin"},
        "assignees": [],
    }
    result = _issue_to_response(issue)
    assert result["project_path"] == "mygroup/myproject"


# ── ticket list: tickets with project_id (for SLA enrichment) ────────────────

def test_list_tickets_with_project_id_in_issue(client, admin_cookies):
    """Tickets with project_id triggers SLA enrichment (covers lines 421, 426-432)."""
    fake = {
        "iid": 10,
        "title": "제목",
        "description": "",
        "state": "opened",
        "labels": ["cat::network", "prio::medium", "status::open"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "web_url": "http://gitlab/issues/10",
        "project_id": "1",
    }
    with patch("app.gitlab_client.get_issues", return_value=([fake], 1)):
        resp = client.get("/tickets/", cookies=admin_cookies)
    assert resp.status_code == 200


# ── stats endpoint for user/developer role (in-memory path) ──────────────────

FAKE_ISSUE = {
    "iid": 1,
    "title": "프린터가 작동하지 않아요",
    "description": "",
    "state": "opened",
    "labels": ["cat::hardware", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "web_url": "http://gitlab/issues/1",
}


def test_get_stats_as_user(client, user_cookies):
    """User role uses in-memory path for stats (covers lines 555-599)."""
    with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]):
        resp = client.get("/tickets/stats", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "open" in data or "all" in data


def test_get_stats_user_filter_own(client):
    """User with username sees only own tickets (covers line 558-560)."""
    import time
    from jose import jwt as _jwt
    token = _jwt.encode({
        "sub": "42", "role": "user", "username": "hong", "name": "홍",
        "exp": int(time.time()) + 3600, "gitlab_token": "tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    issue_mine = {**FAKE_ISSUE, "description": "**신청자:** hong\n---\n내용", "iid": 2}
    issue_other = {**FAKE_ISSUE, "description": "**신청자:** other\n---\n내용", "iid": 3}

    with patch("app.gitlab_client.get_all_issues", return_value=[issue_mine, issue_other]):
        resp = client.get("/tickets/stats", cookies={"itsm_token": token})
    assert resp.status_code == 200
    # Only mine is counted
    data = resp.json()
    assert data["all"] == 1


# ── /tickets/requesters endpoint ──────────────────────────────────────────────

def test_requesters_requires_developer_role(client, user_cookies):
    """user role → 403 (covers line 669-670)."""
    resp = client.get("/tickets/requesters", cookies=user_cookies)
    assert resp.status_code == 403


def test_requesters_success(client, admin_cookies):
    """Admin gets requesters list (covers lines 681-705)."""
    issue_with_creator = {
        **FAKE_ISSUE,
        "description": "**신청자:** 홍길동\n**작성자:** hong\n---\n내용",
    }
    with (
        patch("app.gitlab_client.get_all_issues", return_value=[issue_with_creator]),
        patch("app.gitlab_client.get_users_by_usernames", return_value={"hong": "홍길동"}),
    ):
        resp = client.get("/tickets/requesters", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_requesters_gitlab_error(client, admin_cookies):
    """GitLab error in requesters → 502 (covers lines 706-708)."""
    with patch("app.gitlab_client.get_all_issues", side_effect=Exception("err")):
        resp = client.get("/tickets/requesters", cookies=admin_cookies)
    assert resp.status_code == 502
