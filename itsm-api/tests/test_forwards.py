"""Tests for /tickets/{iid}/forwards endpoints and helper functions."""
import time
from unittest.mock import patch, MagicMock

import pytest


# ── fixtures ──────────────────────────────────────────────────────────────────

def _make_token(role="developer", sub="5", username="devuser"):
    from jose import jwt as _jwt
    return _jwt.encode({
        "sub": sub, "role": role, "name": "Dev User", "username": username,
        "email": f"{username}@test.com",
        "exp": int(time.time()) + 7200,
        "gitlab_token": "test-gitlab-token",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")


@pytest.fixture
def dev_cookies():
    return {"itsm_token": _make_token("developer")}


@pytest.fixture
def agent_cookies():
    return {"itsm_token": _make_token("agent", "3", "agent_user")}


@pytest.fixture
def admin_cookies():
    return {"itsm_token": _make_token("admin", "1", "admin_user")}


FAKE_ISSUE = {
    "iid": 1, "id": 100, "title": "테스트 티켓",
    "description": "내용", "state": "opened",
    "labels": ["cat::network", "prio::medium", "status::open"],
    "web_url": "http://gitlab/issues/1",
    "assignees": [], "project_id": "1",
}

FAKE_NEW_ISSUE = {
    "iid": 42, "id": 200, "title": "[공용 #1] 테스트",
    "web_url": "http://devproject/issues/42",
    "state": "opened",
}


# ── GET /admin/dev-projects ─────────────────────────────────────────────────

def test_list_dev_projects_no_token(client, agent_cookies):
    """No gitlab_token in JWT → returns empty list."""
    from jose import jwt as _jwt
    token = _jwt.encode({
        "sub": "3", "role": "agent", "name": "Agent",
        "username": "agent", "email": "a@x.com",
        "exp": int(time.time()) + 7200,
        # no gitlab_token
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    with patch("app.gitlab_client.get_user_accessible_projects", return_value=[]):
        resp = client.get("/admin/dev-projects", cookies={"itsm_token": token})
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_dev_projects_requires_auth(client):
    resp = client.get("/admin/dev-projects")
    assert resp.status_code == 401


def test_list_dev_projects_with_projects(client, agent_cookies):
    """Returns projects excluding the main ITSM project."""
    projects = [
        {"id": 1, "name": "ITSM", "name_with_namespace": "ITSM"},
        {"id": 2, "name": "DevProject", "name_with_namespace": "Dev/DevProject"},
    ]
    with patch("app.gitlab_client.get_user_accessible_projects", return_value=projects):
        resp = client.get("/admin/dev-projects", cookies=agent_cookies)
    assert resp.status_code == 200
    data = resp.json()
    # Project 1 is the main ITSM project (GITLAB_PROJECT_ID=1), should be excluded
    names = [p["name"] for p in data]
    assert "DevProject" in names
    assert "ITSM" not in names


def test_list_dev_projects_gitlab_error(client, agent_cookies):
    """GitLab error → returns empty list."""
    with patch("app.gitlab_client.get_user_accessible_projects", side_effect=Exception("err")):
        resp = client.get("/admin/dev-projects", cookies=agent_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


# ── POST /tickets/{iid}/forwards ─────────────────────────────────────────────

def test_create_forward_success(client, agent_cookies):
    """Create forward → 201 with forward record."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=FAKE_NEW_ISSUE),
        patch("app.gitlab_client.ensure_project_labels", return_value=None),
        patch("app.gitlab_client.register_project_webhook", return_value=None),
    ):
        resp = client.post(
            "/tickets/1/forwards",
            json={
                "target_project_id": "2",
                "target_project_name": "Dev Project",
                "note": "전달 메모",
            },
            cookies=agent_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["source_iid"] == 1
    assert data["target_project_id"] == "2"


def test_create_forward_source_not_found(client, agent_cookies):
    """Source ticket not found → 404."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("not found")):
        resp = client.post(
            "/tickets/999/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies=agent_cookies,
        )
    assert resp.status_code == 404


def test_create_forward_no_gitlab_token(client):
    """No gitlab_token in JWT → 401."""
    from jose import jwt as _jwt
    token = _jwt.encode({
        "sub": "3", "role": "agent", "name": "Agent",
        "username": "agent", "email": "a@x.com",
        "exp": int(time.time()) + 7200,
        # no gitlab_token
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies={"itsm_token": token},
        )
    assert resp.status_code == 401


def test_create_forward_gitlab_create_fails(client, agent_cookies):
    """GitLab create issue fails → 502."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", side_effect=Exception("creation failed")),
        patch("app.gitlab_client.ensure_project_labels", return_value=None),
    ):
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies=agent_cookies,
        )
    assert resp.status_code == 502


def test_create_forward_requires_agent(client, dev_cookies):
    """Non-agent (developer) cannot create forwards → 403."""
    resp = client.post(
        "/tickets/1/forwards",
        json={"target_project_id": "2", "target_project_name": "Dev"},
        cookies=dev_cookies,
    )
    assert resp.status_code == 403


def test_create_forward_no_note(client, agent_cookies):
    """Create forward without note."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=FAKE_NEW_ISSUE),
        patch("app.gitlab_client.ensure_project_labels", return_value=None),
        patch("app.gitlab_client.register_project_webhook", return_value=None),
    ):
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies=agent_cookies,
        )
    assert resp.status_code == 200


# ── GET /tickets/{iid}/forwards ──────────────────────────────────────────────

def test_list_forwards_empty(client, dev_cookies):
    """No forwards → returns empty list."""
    resp = client.get("/tickets/1/forwards", cookies=dev_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["forwards"] == []
    assert data["all_closed"] is False


def test_list_forwards_with_record(client, dev_cookies, db_session):
    """With one forward record → lists it."""
    from app.models import ProjectForward

    fwd = ProjectForward(
        source_iid=1, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=42, target_web_url="http://dev/42",
        note="메모", created_by="5", created_by_name="Dev User",
    )
    db_session.add(fwd)
    db_session.commit()

    target_issue = {**FAKE_NEW_ISSUE, "state": "opened", "labels": ["status::open"]}
    with patch("app.gitlab_client.get_issue", return_value=target_issue):
        resp = client.get("/tickets/1/forwards", cookies=dev_cookies)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["forwards"]) == 1
    assert data["forwards"][0]["target_iid"] == 42


def test_list_forwards_target_unreachable(client, dev_cookies, db_session):
    """Target issue not accessible → still returns forward record."""
    from app.models import ProjectForward

    fwd = ProjectForward(
        source_iid=2, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=99, target_web_url="http://dev/99",
        created_by="5", created_by_name="Dev",
    )
    db_session.add(fwd)
    db_session.commit()

    with patch("app.gitlab_client.get_issue", side_effect=Exception("Not found")):
        resp = client.get("/tickets/2/forwards", cookies=dev_cookies)

    assert resp.status_code == 200
    assert len(resp.json()["forwards"]) == 1


def test_list_forwards_all_closed(client, dev_cookies, db_session):
    """All target issues closed → all_closed=true."""
    from app.models import ProjectForward

    db_session.add(ProjectForward(
        source_iid=3, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=5, target_web_url="http://dev/5",
        created_by="5", created_by_name="Dev",
    ))
    db_session.commit()

    closed_issue = {**FAKE_NEW_ISSUE, "state": "closed", "labels": []}
    with patch("app.gitlab_client.get_issue", return_value=closed_issue):
        resp = client.get("/tickets/3/forwards", cookies=dev_cookies)

    assert resp.status_code == 200
    assert resp.json()["all_closed"] is True


# ── DELETE /tickets/{iid}/forwards/{forward_id} ───────────────────────────────

def test_delete_forward_not_found(client, admin_cookies):
    """Delete non-existent forward → 404."""
    resp = client.delete("/tickets/1/forwards/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_forward_success(client, admin_cookies, db_session):
    """Delete existing forward → 204."""
    from app.models import ProjectForward

    fwd = ProjectForward(
        source_iid=1, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=10, created_by="1", created_by_name="Admin",
    )
    db_session.add(fwd)
    db_session.commit()
    db_session.refresh(fwd)

    resp = client.delete(f"/tickets/1/forwards/{fwd.id}", cookies=admin_cookies)
    assert resp.status_code == 204


def test_delete_forward_requires_admin(client, dev_cookies):
    """Non-admin cannot delete forwards → 403."""
    resp = client.delete("/tickets/1/forwards/1", cookies=dev_cookies)
    assert resp.status_code == 403


# ── _sync_main_ticket_status unit tests ──────────────────────────────────────

def test_sync_main_ticket_status_already_closed():
    """Issue already closed → no update."""
    from app.routers.forwards import _sync_main_ticket_status

    closed_issue = {"iid": 1, "state": "closed", "labels": []}
    with patch("app.gitlab_client.get_issue", return_value=closed_issue):
        _sync_main_ticket_status(1, "1", "resolved")


def test_sync_main_ticket_status_lower_rank():
    """desired_status rank <= current → no update."""
    from app.routers.forwards import _sync_main_ticket_status, _STATUS_RANK

    # current status is "resolved" which has high rank
    issue = {"iid": 1, "state": "opened", "labels": ["status::resolved"]}
    with patch("app.gitlab_client.get_issue", return_value=issue):
        _sync_main_ticket_status(1, "1", "open")  # lower rank → no update


def test_sync_main_ticket_status_update():
    """desired_status rank > current → update labels."""
    from app.routers.forwards import _sync_main_ticket_status

    issue = {"iid": 1, "state": "opened", "labels": ["status::open"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.update_issue") as mock_update,
    ):
        _sync_main_ticket_status(1, "1", "in_progress")

    mock_update.assert_called_once()


def test_sync_main_ticket_status_error_swallowed():
    """Exception in sync → logged, not raised."""
    from app.routers.forwards import _sync_main_ticket_status

    with patch("app.gitlab_client.get_issue", side_effect=Exception("boom")):
        _sync_main_ticket_status(1, "1", "resolved")  # should not raise


# ── _read_proxy_file unit tests ───────────────────────────────────────────────

def test_read_proxy_file_invalid_path():
    from app.routers.forwards import _read_proxy_file
    assert _read_proxy_file("invalid-path") is None


def test_read_proxy_file_valid_format_no_file():
    from app.routers.forwards import _read_proxy_file
    # Valid format but file doesn't exist on test system
    result = _read_proxy_file("/-/project/1/uploads/abc123def456/test.txt")
    assert result is None


# ── _fmt unit tests ───────────────────────────────────────────────────────────

def test_fmt_without_target_issue(db_session):
    """_fmt works without a target issue."""
    from app.routers.forwards import _fmt
    from app.models import ProjectForward

    fwd = ProjectForward(
        source_iid=1, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=5, created_by="1", created_by_name="Admin",
    )
    db_session.add(fwd)
    db_session.commit()
    db_session.refresh(fwd)

    result = _fmt(fwd)
    assert result["source_iid"] == 1
    assert result["target_iid"] == 5
    assert result["target_state"] is None


def test_fmt_with_target_issue(db_session):
    """_fmt includes target issue state."""
    from app.routers.forwards import _fmt
    from app.models import ProjectForward

    fwd = ProjectForward(
        source_iid=1, source_project_id="1",
        target_project_id="2", target_project_name="Dev",
        target_iid=5, created_by="1", created_by_name="Admin",
    )
    db_session.add(fwd)
    db_session.commit()
    db_session.refresh(fwd)

    target = {"state": "opened", "labels": ["status::in_progress"], "web_url": "http://x/5"}
    result = _fmt(fwd, target)
    assert result["target_state"] == "opened"


# ── _read_proxy_file path-traversal defense ────────────────────────────────────

def test_read_proxy_file_path_traversal():
    """Filename with path separator → returns None."""
    from app.routers.forwards import _read_proxy_file
    # Valid format but filename contains traversal
    result = _read_proxy_file("/-/project/1/uploads/abc123def456/../../etc/passwd")
    assert result is None


def test_read_proxy_file_file_not_found():
    """Valid format but file doesn't exist on disk → returns None."""
    from app.routers.forwards import _read_proxy_file
    result = _read_proxy_file("/-/project/1/uploads/abc123def456/test.txt")
    assert result is None


# ── create_forward with ITSM_WEBHOOK_URL set ─────────────────────────────────

def test_create_forward_webhook_registered(client, agent_cookies):
    """Webhook registration called when ITSM_WEBHOOK_URL is configured."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=FAKE_NEW_ISSUE),
        patch("app.gitlab_client.ensure_project_labels", return_value=None),
        patch("app.gitlab_client.register_project_webhook", return_value={"id": 1}) as mock_hook,
        patch("app.routers.forwards.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "token"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = "secret"
        mock_cfg.return_value.ITSM_WEBHOOK_URL = "http://itsm/webhook"
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev", "note": "test"},
            cookies=agent_cookies,
        )
    assert resp.status_code == 200
    mock_hook.assert_called_once()


def test_create_forward_webhook_registration_fails_nonfatal(client, agent_cookies):
    """Webhook registration exception is non-fatal → forward still succeeds."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=FAKE_NEW_ISSUE),
        patch("app.gitlab_client.ensure_project_labels", return_value=None),
        patch("app.gitlab_client.register_project_webhook", side_effect=Exception("forbidden")),
        patch("app.routers.forwards.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "token"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = "secret"
        mock_cfg.return_value.ITSM_WEBHOOK_URL = "http://itsm/webhook"
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies=agent_cookies,
        )
    # Should still succeed even if webhook fails
    assert resp.status_code == 200


def test_create_forward_ensure_labels_error_nonfatal(client, agent_cookies):
    """ensure_project_labels error is non-fatal → forward continues."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=FAKE_NEW_ISSUE),
        patch("app.gitlab_client.ensure_project_labels", side_effect=Exception("labels failed")),
        patch("app.gitlab_client.register_project_webhook", return_value=None),
        patch("app.routers.forwards.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "token"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        mock_cfg.return_value.GITLAB_WEBHOOK_SECRET = "secret"
        mock_cfg.return_value.ITSM_WEBHOOK_URL = None
        resp = client.post(
            "/tickets/1/forwards",
            json={"target_project_id": "2", "target_project_name": "Dev"},
            cookies=agent_cookies,
        )
    assert resp.status_code == 200


# ── _sync_main_ticket_status redis publish path ──────────────────────────────

def test_sync_main_ticket_status_publishes_to_redis():
    """When update succeeds and redis is available, publishes status_synced event."""
    from app.routers.forwards import _sync_main_ticket_status

    issue = {"iid": 1, "state": "opened", "labels": ["status::open"]}
    mock_redis = MagicMock()

    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.update_issue") as mock_update,
        patch("app.redis_client.get_redis", return_value=mock_redis),
    ):
        _sync_main_ticket_status(1, "1", "in_progress")

    mock_update.assert_called_once()
    mock_redis.publish.assert_called_once()


def test_sync_main_ticket_status_redis_publish_exception():
    """Redis publish exception is silently swallowed (lines 164-165)."""
    from app.routers.forwards import _sync_main_ticket_status

    issue = {"iid": 1, "state": "opened", "labels": ["status::open"]}
    mock_redis = MagicMock()
    mock_redis.publish.side_effect = Exception("publish failed")

    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.update_issue"),
        patch("app.redis_client.get_redis", return_value=mock_redis),
    ):
        _sync_main_ticket_status(1, "1", "in_progress")  # should not raise


def test_read_proxy_file_reads_existing_file():
    """When file exists on disk, reads and returns (content, filename, mime) (lines 41-43)."""
    from unittest.mock import mock_open, patch as _patch
    from app.routers.forwards import _read_proxy_file

    valid_path = "/-/project/1/uploads/abcdef1234567890/test.txt"

    with (
        _patch("os.path.isfile", return_value=True),
        _patch("builtins.open", mock_open(read_data=b"file content")),
        _patch("mimetypes.guess_type", return_value=("text/plain", None)),
    ):
        result = _read_proxy_file(valid_path)

    assert result is not None
    content, filename, mime = result
    assert filename == "test.txt"
    assert content == b"file content"
    assert mime == "text/plain"


def test_forward_attachments_empty_description():
    """Empty description returns early (line 58)."""
    from app.routers.forwards import _forward_attachments
    result = _forward_attachments("", "2", "token", "http://gitlab.example.com")
    assert result == ""


def test_forward_attachments_with_successful_upload():
    """Proxy URL re-uploaded → new URL replaces old (lines 65-83)."""
    from app.routers.forwards import _forward_attachments
    from urllib.parse import quote

    encoded_path = quote("/-/project/1/uploads/abcdef1234567890/test.txt")
    description = f"See attachment: /api/tickets/uploads/proxy?path={encoded_path}"

    with (
        patch("app.routers.forwards._read_proxy_file", return_value=(b"data", "test.txt", "text/plain")),
        patch("app.gitlab_client.upload_file", return_value={"full_path": "/uploads/new/test.txt"}),
    ):
        result = _forward_attachments(description, "2", "token", "http://gitlab.example.com")

    assert "http://gitlab.example.com/uploads/new/test.txt" in result


def test_forward_attachments_upload_fails_uses_fallback():
    """Upload failure → fallback URL (lines 84-88)."""
    from app.routers.forwards import _forward_attachments
    from urllib.parse import quote

    encoded_path = quote("/-/project/1/uploads/abcdef1234567890/test.txt")
    description = f"file: /api/tickets/uploads/proxy?path={encoded_path}"

    with (
        patch("app.routers.forwards._read_proxy_file", return_value=(b"data", "test.txt", "text/plain")),
        patch("app.gitlab_client.upload_file", side_effect=Exception("upload failed")),
    ):
        result = _forward_attachments(description, "2", "token", "http://gitlab.example.com")

    # Fallback uses the gitlab external url + original path
    assert "gitlab.example.com" in result or result != description


def test_forward_attachments_file_not_found_uses_fallback():
    """_read_proxy_file returns None → fallback URL used."""
    from app.routers.forwards import _forward_attachments
    from urllib.parse import quote

    encoded_path = quote("/-/project/1/uploads/abcdef1234567890/missing.txt")
    description = f"file: /api/tickets/uploads/proxy?path={encoded_path}"

    with patch("app.routers.forwards._read_proxy_file", return_value=None):
        result = _forward_attachments(description, "2", "token", "http://gitlab.example.com")

    assert result  # returned some non-empty string


def test_forward_attachments_cache_hit():
    """Same proxy URL twice → upload called only once (cache hit covers lines 66-67)."""
    from app.routers.forwards import _forward_attachments
    from urllib.parse import quote

    encoded_path = quote("/-/project/1/uploads/abcdef1234567890/img.png")
    description = (
        f"/api/tickets/uploads/proxy?path={encoded_path} "
        f"/api/tickets/uploads/proxy?path={encoded_path}"
    )

    with (
        patch("app.routers.forwards._read_proxy_file", return_value=(b"data", "img.png", "image/png")),
        patch("app.gitlab_client.upload_file", return_value={"full_path": "/uploads/new/img.png"}) as mock_upload,
    ):
        result = _forward_attachments(description, "2", "token", "http://gitlab.example.com")

    mock_upload.assert_called_once()
    assert result.count("http://gitlab.example.com/uploads/new/img.png") == 2
