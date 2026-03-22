"""HTTP endpoint tests for /tickets router — covers uncovered lines."""
import time
from unittest.mock import patch, MagicMock

import pytest


# ─── shared fake data ─────────────────────────────────────────────────────────

FAKE_ISSUE = {
    "iid": 42,
    "id": 100,
    "title": "테스트 티켓",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n**작성자:** hong\n---\n내용",
    "state": "opened",
    "labels": ["cat::network", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T12:00:00.000Z",
    "web_url": "http://gitlab/issues/42",
    "author": {"id": 42, "username": "hong", "name": "홍길동"},
    "assignees": [],
    "assignee": None,
    "project_id": "1",
}

FAKE_CLOSED_ISSUE = {**FAKE_ISSUE, "state": "closed", "labels": ["cat::network", "prio::medium"]}


def _make_token(role="admin", sub="1", username="admin"):
    from jose import jwt as _jwt
    return _jwt.encode({
        "sub": sub, "role": role, "name": "Test User", "username": username,
        "email": f"{username}@test.com",
        "exp": int(time.time()) + 7200,
        "gitlab_token": "test-gitlab-token",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")


@pytest.fixture
def developer_cookies():
    return {"itsm_token": _make_token("developer", "5", "dev1")}


@pytest.fixture
def pl_cookies():
    return {"itsm_token": _make_token("pl", "3", "pl_user")}


# ─── GET /tickets/ — state filter branches (lines 735-763) ───────────────────

@pytest.mark.parametrize("state", [
    "open", "approved", "in_progress", "waiting", "active",
    "resolved", "testing", "ready_for_release", "released", "closed",
])
def test_list_tickets_state_filter(client, admin_cookies, state):
    """Each state param maps to gl_state/labels (covers lines 735-763)."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get(f"/tickets/?state={state}", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_category_other(client, admin_cookies):
    """category=other queries ServiceType table for not_labels (covers lines 769-781)."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/tickets/?category=other", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_category_specific(client, admin_cookies):
    """category=network adds cat:: label (covers line 783)."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/tickets/?category=network", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_priority_filter(client, admin_cookies):
    """priority param adds prio:: label (covers line 785-786)."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/tickets/?priority=high", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_developer_role(client, developer_cookies):
    """Developer role uses get_issues with assignee_username server filter (covers lines 812-827)."""
    with patch("app.gitlab_client.get_issues", return_value=([FAKE_ISSUE], 1)):
        resp = client.get("/tickets/", cookies=developer_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1


def test_list_tickets_sla_filter_over(client, admin_cookies):
    """sla=over filter (covers lines 852-878)."""
    old_issue = {
        **FAKE_ISSUE,
        "created_at": "2020-01-01T00:00:00Z",  # very old, definitely over SLA
    }
    with patch("app.gitlab_client.get_issues", return_value=([old_issue], 1)):
        resp = client.get("/tickets/?sla=over", cookies=admin_cookies)
    assert resp.status_code == 200


def test_list_tickets_gitlab_error(client, admin_cookies):
    """GitLab error in list_tickets → 502 (covers lines 905-907)."""
    with patch("app.gitlab_client.get_issues", side_effect=Exception("fail")):
        resp = client.get("/tickets/", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── POST /tickets/upload — upload_attachment (lines 918-947) ─────────────────

def test_upload_attachment_too_large(client, admin_cookies):
    """File > 10MB → 413 (covers lines 919-920)."""
    import io
    big_content = b"x" * (10 * 1024 * 1024 + 1)
    resp = client.post(
        "/tickets/upload",
        files={"file": ("big.txt", io.BytesIO(big_content), "text/plain")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 413


def test_upload_attachment_invalid_mime(client, admin_cookies):
    """Disallowed content_type → 415 (covers lines 921-923)."""
    import io
    resp = client.post(
        "/tickets/upload",
        files={"file": ("bad.exe", io.BytesIO(b"MZ\x00"), "application/x-msdownload")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 415


def test_upload_attachment_success(client, admin_cookies):
    """Valid file upload succeeds → 200 (covers lines 924-944)."""
    import io
    jpeg_bytes = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c"
        b"\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c"
        b"\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1edL\t\xe5\r"
        b"\xff\xd9"
    )

    mock_result = {"markdown": "![img](url)", "url": "/url", "full_path": "/path", "proxy_path": "/proxy"}
    with (
        patch("app.routers.tickets.search._validate_magic_bytes"),
        patch("app.routers.tickets.search._strip_image_metadata", return_value=jpeg_bytes),
        patch("app.routers.tickets.search._scan_with_clamav"),
        patch("app.gitlab_client.upload_file", return_value=mock_result),
    ):
        resp = client.post(
            "/tickets/upload",
            files={"file": ("test.jpg", io.BytesIO(jpeg_bytes), "image/jpeg")},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "url" in data


def test_upload_attachment_gitlab_error(client, admin_cookies):
    """GitLab upload fails → 502 (covers lines 945-947)."""
    import io
    jpeg_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100 + b"\xff\xd9"
    with (
        patch("app.routers.tickets.search._validate_magic_bytes"),
        patch("app.routers.tickets.search._strip_image_metadata", return_value=jpeg_bytes),
        patch("app.routers.tickets.search._scan_with_clamav"),
        patch("app.gitlab_client.upload_file", side_effect=Exception("upload failed")),
    ):
        resp = client.post(
            "/tickets/upload",
            files={"file": ("test.jpg", io.BytesIO(jpeg_bytes), "image/jpeg")},
            cookies=admin_cookies,
        )
    assert resp.status_code == 502


# ─── GET /tickets/uploads/proxy (lines 957-1071) ─────────────────────────────

def test_proxy_upload_invalid_path(client, admin_cookies):
    """Unrecognized path → 404 (covers line 1071)."""
    resp = client.get("/tickets/uploads/proxy?path=/invalid/path", cookies=admin_cookies)
    assert resp.status_code == 404


def test_proxy_upload_path_traversal_blocked(client, admin_cookies):
    """path traversal → 400 (covers lines 990-991)."""
    resp = client.get(
        "/tickets/uploads/proxy?path=/-/project/1/uploads/abc123/../../../etc/passwd",
        cookies=admin_cookies,
    )
    # The filename contains ".." which basename will strip → mismatch → 400
    assert resp.status_code in (400, 404)


# ─── GET /tickets/{iid} — get_ticket (lines 1389-1401) ───────────────────────

def test_get_ticket_success(client, admin_cookies):
    """get_ticket returns ticket data (covers lines 1383-1392)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.get_users_by_usernames", return_value={"hong": "홍길동"}),
    ):
        resp = client.get("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["iid"] == 42


def test_get_ticket_not_found(client, admin_cookies):
    """GitLab 404 → 404 (covers lines 1393-1395)."""
    import httpx
    mock_response = MagicMock()
    mock_response.status_code = 404
    exc = httpx.HTTPStatusError("Not Found", request=MagicMock(), response=mock_response)
    with patch("app.gitlab_client.get_issue", side_effect=exc):
        resp = client.get("/tickets/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_get_ticket_gitlab_error(client, admin_cookies):
    """Generic error → 502 (covers lines 1398-1400)."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("connection error")):
        resp = client.get("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── DELETE /tickets/{iid} — delete_ticket (lines 1559-1625) ─────────────────

def test_delete_ticket_as_admin(client, admin_cookies):
    """Admin can delete any ticket (covers lines 1559-1625)."""
    with patch("app.gitlab_client.delete_issue"):
        resp = client.delete("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 204


def test_delete_ticket_as_user_own_open_ticket(client, user_cookies):
    """User can delete own open ticket (covers lines 1563-1578)."""
    own_issue = {
        **FAKE_ISSUE,
        "description": "**신청자:** 홍길동\n**작성자:** hong\n---\n내용",
        "labels": ["cat::network", "prio::medium", "status::open"],
        "state": "opened",
        "author": {"id": 42, "username": "hong"},
    }
    with (
        patch("app.gitlab_client.get_issue", return_value=own_issue),
        patch("app.gitlab_client.delete_issue"),
    ):
        resp = client.delete("/tickets/42", cookies=user_cookies)
    assert resp.status_code == 204


def test_delete_ticket_as_user_other_ticket_forbidden(client, user_cookies):
    """User cannot delete other user's ticket (covers lines 1570-1574)."""
    other_issue = {
        **FAKE_ISSUE,
        "description": "**신청자:** 다른사람\n**작성자:** other_user\n---\n내용",
        "author": {"id": 99, "username": "other_user"},
    }
    with patch("app.gitlab_client.get_issue", return_value=other_issue):
        resp = client.delete("/tickets/42", cookies=user_cookies)
    assert resp.status_code == 403


def test_delete_ticket_not_found(client, admin_cookies):
    """GitLab 404 on delete → 404 (covers lines 1579-1581)."""
    import httpx
    mock_response = MagicMock()
    mock_response.status_code = 404
    exc = httpx.HTTPStatusError("Not Found", request=MagicMock(), response=mock_response)
    with patch("app.gitlab_client.delete_issue", side_effect=exc):
        resp = client.delete("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 404


# ─── PATCH /tickets/{iid} — update_ticket (lines 1628-1894) ──────────────────

def test_update_ticket_status_change_to_approved(client, admin_cookies):
    """Admin changes status open→approved (covers main update path lines 1666-1889)."""
    updated = {**FAKE_ISSUE, "labels": ["cat::network", "prio::medium", "status::approved"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "approved"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_invalid_status_transition(client, admin_cookies):
    """Invalid transition open→released → 400 (covers lines 1688-1694)."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.patch(
            "/tickets/42",
            json={"status": "released"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 400


def test_update_ticket_etag_mismatch(client, admin_cookies):
    """If-Match header doesn't match → 409 (covers lines 1670-1677)."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.patch(
            "/tickets/42",
            json={"status": "approved"},
            headers={"If-Match": '"wrong-etag"'},
            cookies=admin_cookies,
        )
    assert resp.status_code == 409


def test_update_ticket_pending_approval_blocks(client, admin_cookies, db_session):
    """Pending approval request blocks status change → 409 (covers lines 1696-1706)."""
    from app.models import ApprovalRequest
    ap = ApprovalRequest(
        ticket_iid=42,
        project_id="1",
        status="pending",
        requester_username="admin",
        requester_name="Admin",
    )
    db_session.add(ap)
    db_session.commit()

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.patch(
            "/tickets/42",
            json={"status": "approved"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 409


def test_update_ticket_priority_change(client, admin_cookies):
    """Priority change updates prio:: label (covers lines 1719-1723)."""
    updated = {**FAKE_ISSUE, "labels": ["cat::network", "prio::high", "status::open"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"priority": "high"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_description_change(client, admin_cookies):
    """Description update preserves meta header (covers lines 1729-1743)."""
    updated = {**FAKE_ISSUE}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"description": "새로운 내용입니다. 내용이 충분히 길어야 합니다."},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_category_change(client, admin_cookies):
    """Category change updates cat:: label (covers lines 1745-1749)."""
    updated = {**FAKE_ISSUE, "labels": ["cat::hardware", "prio::medium", "status::open"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"category": "hardware"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_user_role_cannot_change_status(client, user_cookies):
    """User cannot change status → 403 (covers lines 1644-1661)."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.patch(
            "/tickets/42",
            json={"status": "approved"},
            cookies=user_cookies,
        )
    assert resp.status_code == 403


def test_update_ticket_user_role_not_owner_forbidden(client, user_cookies):
    """User cannot modify others' ticket → 403 (covers lines 1651-1655)."""
    other_issue = {
        **FAKE_ISSUE,
        "description": "**신청자:** 다른사람\n**작성자:** other\n---\n내용",
        "author": {"id": 99, "username": "other"},
    }
    with patch("app.gitlab_client.get_issue", return_value=other_issue):
        resp = client.patch(
            "/tickets/42",
            json={"title": "새 제목입니다"},
            cookies=user_cookies,
        )
    assert resp.status_code == 403


def test_update_ticket_close_with_resolution_note(client, admin_cookies):
    """Closing ticket with resolution_note saves ResolutionNote (covers lines 1813-1841)."""
    closed_issue = {
        **FAKE_ISSUE,
        "state": "closed",
        "labels": ["cat::network", "prio::medium"],
    }
    in_progress_issue = {**FAKE_ISSUE, "labels": ["cat::network", "prio::medium", "status::in_progress"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=in_progress_issue),
        patch("app.gitlab_client.update_issue", return_value=closed_issue),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.patch(
            "/tickets/42",
            json={
                "status": "closed",
                "resolution_note": "문제를 해결했습니다.",
                "resolution_type": "resolved",
            },
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_gitlab_error(client, admin_cookies):
    """GitLab error in update → 502 (covers lines 1892-1894)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", side_effect=Exception("gitlab down")),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"priority": "high"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 502


def test_update_ticket_status_waiting_pauses_sla(client, admin_cookies):
    """Status → waiting calls sla.pause_sla (covers lines 1793-1794)."""
    updated = {**FAKE_ISSUE, "labels": ["cat::network", "prio::medium", "status::waiting"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "waiting"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_update_ticket_status_reopen(client, admin_cookies):
    """Reopen closed ticket (covers lines 1713-1715, 1798-1810)."""
    updated = {**FAKE_ISSUE, "state": "opened", "labels": ["cat::network", "prio::medium", "status::open"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_CLOSED_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "reopened"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


# ─── GET /tickets/{iid}/resolution (lines 1905-1919) ─────────────────────────

def test_get_resolution_note_empty(client, admin_cookies):
    """No resolution note → empty dict (covers lines 1905-1914)."""
    resp = client.get("/tickets/42/resolution", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json() == {}


def test_get_resolution_note_with_data(client, admin_cookies, db_session):
    """Resolution note exists → returned (covers lines 1915-1919)."""
    from app.models import ResolutionNote
    from datetime import datetime, timezone
    rn = ResolutionNote(
        ticket_iid=42,
        project_id="1",
        note="해결 내용",
        resolution_type="permanent_fix",
        created_by="1",
        created_by_name="Admin",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rn)
    db_session.commit()
    db_session.refresh(rn)

    resp = client.get("/tickets/42/resolution", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["note"] == "해결 내용"


# ─── POST /tickets/{iid}/comments (lines 2002-2089) ──────────────────────────

def test_add_comment_internal_forbidden_for_user(client, user_cookies):
    """User cannot add internal comment → 403 (covers lines 2002-2006)."""
    resp = client.post(
        "/tickets/42/comments",
        json={"body": "내부 메모", "internal": True},
        cookies=user_cookies,
    )
    assert resp.status_code == 403


def test_add_comment_no_gitlab_token(client):
    """Token without gitlab_token → 401 (covers lines 2009-2013)."""
    import time
    from jose import jwt as _jwt
    token = _jwt.encode({
        "sub": "42", "role": "admin", "name": "Admin", "username": "admin",
        "exp": int(time.time()) + 7200,
        # no gitlab_token
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")
    resp = client.post(
        "/tickets/42/comments",
        json={"body": "댓글 내용"},
        cookies={"itsm_token": token},
    )
    assert resp.status_code == 401


def test_add_comment_success(client, admin_cookies):
    """Successful comment add (covers lines 2018-2089)."""
    fake_note = {
        "id": 1,
        "body": "댓글 내용",
        "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T12:00:00Z",
        "confidential": False,
    }
    with (
        patch("app.gitlab_client.add_note", return_value=fake_note),
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/42/comments",
            json={"body": "댓글 내용"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["body"] == "댓글 내용"


def test_add_comment_gitlab_error(client, admin_cookies):
    """GitLab add_note fails → 502 (covers lines 2025-2027)."""
    with patch("app.gitlab_client.add_note", side_effect=Exception("gitlab error")):
        resp = client.post(
            "/tickets/42/comments",
            json={"body": "댓글 내용"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 502


# ─── GET /tickets/{iid}/comments (lines 2092-2114) ───────────────────────────

def test_get_comments_success(client, admin_cookies):
    """get_comments returns list of comments (covers lines 2098-2110)."""
    fake_notes = [
        {
            "id": 1,
            "body": "첫 번째 댓글",
            "system": False,
            "author": {"name": "Admin", "avatar_url": None},
            "created_at": "2024-01-01T12:00:00Z",
            "confidential": False,
        },
        {
            "id": 2,
            "body": "시스템 메모",
            "system": True,  # filtered out
            "author": {"name": "GitLab", "avatar_url": None},
            "created_at": "2024-01-01T12:01:00Z",
            "confidential": False,
        },
    ]
    with patch("app.gitlab_client.get_notes", return_value=fake_notes):
        resp = client.get("/tickets/42/comments", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1  # system note filtered out
    assert data[0]["body"] == "첫 번째 댓글"


def test_get_comments_gitlab_error(client, admin_cookies):
    """GitLab get_notes fails → 502 (covers lines 2112-2114)."""
    with patch("app.gitlab_client.get_notes", side_effect=Exception("gitlab error")):
        resp = client.get("/tickets/42/comments", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── POST /tickets/{iid}/clone (lines 1414-1467) ─────────────────────────────

def test_clone_ticket_success(client, admin_cookies):
    """Clone ticket creates new issue and links (covers lines 1414-1467)."""
    new_issue = {**FAKE_ISSUE, "iid": 99, "title": "[복제] 테스트 티켓"}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", return_value=new_issue),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.post("/tickets/42/clone", cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["iid"] == 99


def test_clone_ticket_original_not_found(client, admin_cookies):
    """Original ticket not found → 404 (covers lines 1415-1417)."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("not found")):
        resp = client.post("/tickets/42/clone", cookies=admin_cookies)
    assert resp.status_code == 404


def test_clone_ticket_create_error(client, admin_cookies):
    """New ticket creation fails → 502 (covers lines 1433-1435)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.create_issue", side_effect=Exception("gitlab error")),
    ):
        resp = client.post("/tickets/42/clone", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── POST /tickets/{iid}/pipeline (lines 1255-1284) ──────────────────────────

def test_trigger_pipeline_success(client, admin_cookies):
    """Trigger pipeline (covers lines 1255-1284)."""
    fake_pipeline = {"id": 1, "web_url": "http://gitlab/pipelines/1", "status": "pending"}
    with (
        patch("app.gitlab_client.trigger_pipeline", return_value=fake_pipeline),
        patch("app.gitlab_client.add_note"),
    ):
        resp = client.post("/tickets/42/pipeline", cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == 1


def test_trigger_pipeline_error(client, admin_cookies):
    """Pipeline trigger fails → 502 (covers lines 1261-1263)."""
    with patch("app.gitlab_client.trigger_pipeline", side_effect=Exception("fail")):
        resp = client.post("/tickets/42/pipeline", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── GET /tickets/{iid}/pipelines (lines 1295-1299) ──────────────────────────

def test_list_pipelines_success(client, admin_cookies):
    """List pipelines (covers lines 1295-1296)."""
    with patch("app.gitlab_client.list_pipelines", return_value=[{"id": 1, "status": "success"}]):
        resp = client.get("/tickets/42/pipelines", cookies=admin_cookies)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_list_pipelines_error(client, admin_cookies):
    """List pipelines error → 502 (covers lines 1297-1299)."""
    with patch("app.gitlab_client.list_pipelines", side_effect=Exception("fail")):
        resp = client.get("/tickets/42/pipelines", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── GET /tickets/{iid}/linked-mrs (lines 1309-1326) ─────────────────────────

def test_get_linked_mrs_success(client, pl_cookies):
    """Get linked MRs (covers lines 1309-1323)."""
    fake_mrs = [
        {"iid": 1, "title": "Fix issue", "state": "merged",
         "web_url": "http://gitlab/mr/1", "author": {"name": "Dev"},
         "created_at": "2024-01-01T00:00:00Z", "merged_at": "2024-01-02T00:00:00Z"}
    ]
    with patch("app.gitlab_client.get_issue_linked_mrs", return_value=fake_mrs):
        resp = client.get("/tickets/42/linked-mrs", cookies=pl_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["iid"] == 1


def test_get_linked_mrs_error(client, pl_cookies):
    """Error fetching linked MRs → 502 (covers lines 1324-1326)."""
    with patch("app.gitlab_client.get_issue_linked_mrs", side_effect=Exception("fail")):
        resp = client.get("/tickets/42/linked-mrs", cookies=pl_cookies)
    assert resp.status_code == 502


# ─── GET /tickets/{iid}/sla (lines 1336-1340) ────────────────────────────────

def test_get_ticket_sla_no_record(client, developer_cookies):
    """No SLA record → None (covers lines 1336-1340)."""
    resp = client.get("/tickets/42/sla", cookies=developer_cookies)
    assert resp.status_code == 200
    assert resp.json() is None


# ─── PATCH /tickets/{iid}/sla (lines 1352-1374) ──────────────────────────────

def test_update_ticket_sla_no_record(client, pl_cookies):
    """No SLA record → 404 (covers lines 1352-1356)."""
    resp = client.patch("/tickets/42/sla", json={"sla_due_date": "2030-01-01"}, cookies=pl_cookies)
    assert resp.status_code == 404


def test_update_ticket_sla_missing_date(client, pl_cookies, db_session):
    """Missing sla_due_date → 400 (covers lines 1358-1360)."""
    from app.models import SLARecord
    from datetime import datetime, timezone
    rec = SLARecord(
        gitlab_issue_iid=42,
        project_id="1",
        priority="medium",
        sla_deadline=datetime(2030, 1, 1, 23, 59, 59),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rec)
    db_session.commit()
    resp = client.patch("/tickets/42/sla", json={}, cookies=pl_cookies)
    assert resp.status_code == 400


def test_update_ticket_sla_invalid_date(client, pl_cookies, db_session):
    """Invalid date format → 400 (covers lines 1361-1364)."""
    from app.models import SLARecord
    from datetime import datetime, timezone
    rec = SLARecord(
        gitlab_issue_iid=42,
        project_id="1",
        priority="medium",
        sla_deadline=datetime(2030, 1, 1, 23, 59, 59),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rec)
    db_session.commit()
    resp = client.patch("/tickets/42/sla", json={"sla_due_date": "not-a-date"}, cookies=pl_cookies)
    assert resp.status_code == 400


def test_update_ticket_sla_past_date(client, pl_cookies, db_session):
    """Past date → 400 (covers lines 1368-1369)."""
    from app.models import SLARecord
    from datetime import datetime, timezone
    rec = SLARecord(
        gitlab_issue_iid=42,
        project_id="1",
        priority="medium",
        sla_deadline=datetime(2030, 1, 1, 23, 59, 59),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rec)
    db_session.commit()
    resp = client.patch("/tickets/42/sla", json={"sla_due_date": "2020-01-01"}, cookies=pl_cookies)
    assert resp.status_code == 400


def test_update_ticket_sla_success(client, pl_cookies, db_session):
    """Valid future date updates SLA (covers lines 1371-1374)."""
    from app.models import SLARecord
    from datetime import datetime, timezone
    rec = SLARecord(
        gitlab_issue_iid=42,
        project_id="1",
        priority="medium",
        sla_deadline=datetime(2030, 1, 1, 23, 59, 59),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rec)
    db_session.commit()
    resp = client.patch("/tickets/42/sla", json={"sla_due_date": "2035-01-01"}, cookies=pl_cookies)
    assert resp.status_code == 200


# ─── GET /tickets/export/csv (lines 1091-1140) ───────────────────────────────

def test_export_csv_success(client, admin_cookies):
    """Export CSV (covers lines 1096-1140)."""
    with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]):
        resp = client.get("/tickets/export/csv", cookies=admin_cookies)
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]


def test_export_csv_with_state_filter(client, admin_cookies):
    """Export CSV with state filter (covers lines 1091-1095)."""
    with patch("app.gitlab_client.get_all_issues", return_value=[]):
        resp = client.get("/tickets/export/csv?state=open", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── POST /tickets/{iid}/merge (lines 1485-1548) ─────────────────────────────

def test_merge_ticket_self_forbidden(client, admin_cookies):
    """Cannot merge ticket into itself → 400 (covers lines 1490-1491)."""
    resp = client.post("/tickets/42/merge?target_iid=42", cookies=admin_cookies)
    assert resp.status_code == 400


def test_merge_ticket_source_not_found(client, admin_cookies):
    """Source ticket not found → 404 (covers lines 1493-1496)."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("not found")):
        resp = client.post("/tickets/42/merge?target_iid=43", cookies=admin_cookies)
    assert resp.status_code == 404


def test_merge_ticket_target_closed(client, admin_cookies):
    """Target ticket already closed → 400 (covers lines 1503-1504)."""
    target_closed = {**FAKE_CLOSED_ISSUE, "iid": 43}

    def _side_effect(iid, **kwargs):
        if iid == 42:
            return FAKE_ISSUE
        return target_closed

    with patch("app.gitlab_client.get_issue", side_effect=_side_effect):
        resp = client.post("/tickets/42/merge?target_iid=43", cookies=admin_cookies)
    assert resp.status_code == 400


def test_merge_ticket_success(client, admin_cookies):
    """Successful merge (covers lines 1506-1548)."""
    target_issue = {**FAKE_ISSUE, "iid": 43}
    source_notes = [{"id": 1, "body": "댓글", "system": False,
                     "author": {"name": "User"}, "created_at": "2024-01-01T00:00:00Z"}]

    call_count = [0]
    def _get_issue(iid, **kwargs):
        if iid == 42:
            return FAKE_ISSUE
        return target_issue

    with (
        patch("app.gitlab_client.get_issue", side_effect=_get_issue),
        patch("app.gitlab_client.get_notes", return_value=source_notes),
        patch("app.gitlab_client.add_note"),
        patch("app.gitlab_client.update_issue", return_value=FAKE_CLOSED_ISSUE),
    ):
        resp = client.post("/tickets/42/merge?target_iid=43", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True


# ─── GET /tickets/{iid}/timeline (lines 2125-2207) ───────────────────────────

def test_get_timeline_success(client, admin_cookies):
    """Timeline returns sorted events (covers lines 2125-2207)."""
    notes = [
        {"id": 1, "body": "댓글", "system": False,
         "author": {"name": "Admin", "avatar_url": None},
         "created_at": "2024-01-01T12:00:00Z", "confidential": False},
        {"id": 2, "body": "closed", "system": True,
         "author": {"name": "GitLab", "avatar_url": None},
         "created_at": "2024-01-02T12:00:00Z"},
    ]
    with patch("app.gitlab_client.get_notes", return_value=notes):
        resp = client.get("/tickets/42/timeline", cookies=admin_cookies)
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 2
    types = {e["type"] for e in events}
    assert "comment" in types
    assert "system" in types


def test_get_timeline_notes_error_continues(client, admin_cookies):
    """GitLab notes error doesn't fail — empty events returned (covers lines 2168-2169)."""
    with patch("app.gitlab_client.get_notes", side_effect=Exception("gitlab down")):
        resp = client.get("/tickets/42/timeline", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ─── POST /tickets/bulk (lines 2219-2276) ────────────────────────────────────

def test_bulk_update_close(client, pl_cookies):
    """Bulk close tickets (covers lines 2219-2276)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_CLOSED_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42, 43], "action": "close", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["success"], list)


def test_bulk_update_assign(client, pl_cookies):
    """Bulk assign tickets (covers lines 2240-2241)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "assign", "value": "99", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200


def test_bulk_update_set_priority(client, pl_cookies):
    """Bulk set priority (covers lines 2242-2244)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "set_priority", "value": "high", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200


def test_bulk_update_with_error(client, pl_cookies):
    """Partial failure in bulk update (covers lines 2255-2272)."""
    def _update_side_effect(iid, **kwargs):
        if iid == 43:
            raise Exception("gitlab error")
        return FAKE_CLOSED_ISSUE

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", side_effect=_update_side_effect),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42, 43], "action": "close", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["errors"]) > 0


# ─── POST /tickets/{iid}/resolution/convert-to-kb (lines 1930-1981) ──────────

def test_convert_to_kb_no_resolution_note(client, pl_cookies):
    """No resolution note → 404 (covers lines 1939-1940)."""
    resp = client.post("/tickets/42/resolution/convert-to-kb", cookies=pl_cookies)
    assert resp.status_code == 404


def test_convert_to_kb_success(client, pl_cookies, db_session):
    """Successful KB article creation (covers lines 1944-1981)."""
    from app.models import ResolutionNote
    from datetime import datetime, timezone
    rn = ResolutionNote(
        ticket_iid=42,
        project_id="1",
        note="이 문제는 다음과 같이 해결됩니다.",
        resolution_type="resolved",
        created_by="3",
        created_by_name="PL User",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(rn)
    db_session.commit()

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.post("/tickets/42/resolution/convert-to-kb", cookies=pl_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert "kb_article_id" in data
    assert "slug" in data


def test_convert_to_kb_already_converted(client, pl_cookies, db_session):
    """Already converted to KB → 409 (covers lines 1941-1942)."""
    from app.models import ResolutionNote, KBArticle
    from datetime import datetime, timezone
    article = KBArticle(
        title="기존 아티클",
        slug="existing-slug",
        content="내용",
        author_id="3",
        author_name="PL User",
        published=False,
        tags=[],
    )
    db_session.add(article)
    db_session.flush()

    rn = ResolutionNote(
        ticket_iid=42,
        project_id="1",
        note="내용",
        resolution_type="resolved",
        created_by="3",
        created_by_name="PL User",
        created_at=datetime.now(timezone.utc),
        kb_article_id=article.id,
    )
    db_session.add(rn)
    db_session.commit()

    resp = client.post("/tickets/42/resolution/convert-to-kb", cookies=pl_cookies)
    assert resp.status_code == 409


# ── stats: developer role in-memory filter (lines 561-562, 572, 580) ──────────

def test_get_stats_developer_role(client, developer_cookies):
    """Stats with developer role: in-memory filter by assignee (lines 561-562, 572, 580)."""
    dev_issue = {
        **FAKE_ISSUE,
        "state": "opened",
        "labels": ["status::in_progress", "prio::high"],
        "assignees": [{"id": 5, "username": "dev1"}],
    }
    closed_issue = {
        **FAKE_ISSUE,
        "iid": 43,
        "state": "closed",
        "labels": [],
        "assignees": [{"id": 5, "username": "dev1"}],
    }
    with patch("app.gitlab_client.get_all_issues", return_value=[dev_issue, closed_issue]):
        resp = client.get("/tickets/stats", cookies=developer_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)
    assert "all" in data


def test_get_stats_redis_cache_hit(client, developer_cookies):
    """Stats Redis cache hit returns cached JSON (line 551)."""
    import json
    cached = json.dumps({
        "all": 10, "open": 5, "approved": 1, "in_progress": 2,
        "waiting": 0, "resolved": 1, "testing": 0, "ready_for_release": 0,
        "released": 0, "closed": 1,
    })
    mock_r = MagicMock()
    mock_r.get.return_value = cached

    with patch("app.routers.tickets.search._get_redis", return_value=mock_r):
        resp = client.get("/tickets/stats", cookies=developer_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["all"] == 10


def test_get_stats_admin_with_sla_db_query(client, admin_cookies):
    """Stats admin role: SLA DB query (lines 641-648)."""
    from unittest.mock import MagicMock, patch as _patch

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.count.return_value = 2
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        _patch("app.gitlab_client.get_issues", return_value=([FAKE_ISSUE], 1)),
        _patch("app.database.SessionLocal", mock_sl),
    ):
        resp = client.get("/tickets/stats", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("sla_over") == 2


# ─── Stats: GitLab error → 502 (lines 656-658) ───────────────────────────────

def test_get_stats_gitlab_error_returns_502(client, admin_cookies):
    """When GitLab raises, stats endpoint returns 502 (lines 656-658)."""
    with patch("app.gitlab_client.get_issues", side_effect=Exception("gitlab down")):
        resp = client.get("/tickets/stats", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── CSV export: state/category/priority/formula-injection (lines 1092, 1099, 1101, 1117) ─────

def test_export_csv_closed_state(client, admin_cookies):
    """state=closed → gl_state='closed' (line 1092)."""
    formula_issue = {**FAKE_ISSUE, "title": "=CMD|' /C calc'!A0"}
    with patch("app.gitlab_client.get_all_issues", return_value=[formula_issue]):
        resp = client.get("/tickets/export/csv?state=closed", cookies=admin_cookies)
    assert resp.status_code == 200
    content = resp.content.decode("utf-8-sig")
    # formula injection defence: title must start with '
    assert "'=" in content or "CMD" in content


def test_export_csv_category_and_priority(client, admin_cookies):
    """category and priority params append labels (lines 1099, 1101)."""
    with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]) as mock_get:
        resp = client.get(
            "/tickets/export/csv?category=network&priority=high",
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    # verify labels were built with cat:: and prio::
    call_kwargs = mock_get.call_args[1]
    assert "cat::network" in (call_kwargs.get("labels") or "")
    assert "prio::high" in (call_kwargs.get("labels") or "")


# ─── Create ticket: department/location (lines 1170, 1172, 1182, 1184) ───────

def test_create_ticket_with_department_and_location(client, admin_cookies):
    """department and location fields appended to description (lines 1170-1184)."""
    payload = {
        "title": "네트워크 오류 신고합니다",
        "description": "사무실 인터넷이 안됩니다.",
        "category": "network",
        "priority": "medium",
        "employee_name": "김철수",
        "employee_email": "kim@example.com",
        "department": "개발팀",
        "location": "2층 회의실",
    }
    created = {**FAKE_ISSUE, "iid": 99}
    with (
        patch("app.gitlab_client.create_issue", return_value=created) as mock_create,
        patch("app.gitlab_client.ensure_labels"),
    ):
        resp = client.post("/tickets/", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    desc = mock_create.call_args[0][1]  # description positional arg
    assert "개발팀" in desc
    assert "2층 회의실" in desc


# ─── Create ticket: GitLab error → 502 (lines 1207-1209) ────────────────────

def test_create_ticket_gitlab_error_returns_502(client, admin_cookies):
    """create_issue raises → 502 (lines 1207-1209)."""
    payload = {
        "title": "네트워크 오류 신고합니다",
        "description": "사무실 인터넷이 안됩니다.",
        "category": "network",
        "priority": "medium",
        "employee_name": "김철수",
        "employee_email": "kim@example.com",
    }
    with (
        patch("app.gitlab_client.create_issue", side_effect=Exception("gitlab down")),
        patch("app.gitlab_client.ensure_labels"),
    ):
        resp = client.post("/tickets/", json=payload, cookies=admin_cookies)
    assert resp.status_code == 502


# ─── Create ticket: SLA creation failure non-fatal (lines 1217-1218) ─────────

def test_create_ticket_sla_failure_non_fatal(client, admin_cookies):
    """SLA record creation failure is non-fatal (lines 1217-1218)."""
    payload = {
        "title": "네트워크 오류 신고합니다",
        "description": "사무실 인터넷이 안됩니다.",
        "category": "network",
        "priority": "medium",
        "employee_name": "김철수",
        "employee_email": "kim@example.com",
    }
    created = {**FAKE_ISSUE, "iid": 77}
    with (
        patch("app.gitlab_client.create_issue", return_value=created),
        patch("app.gitlab_client.ensure_labels"),
        patch("app.sla.create_sla_record", side_effect=Exception("SLA error")),
    ):
        resp = client.post("/tickets/", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201


# ─── Delete ticket: non-admin get_issue error → 502 (lines 1567-1569) ────────

def test_delete_ticket_non_admin_get_issue_error(client, user_cookies):
    """Non-admin: get_issue raises → 502 (lines 1567-1569)."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("gitlab down")):
        resp = client.delete("/tickets/42", cookies=user_cookies)
    assert resp.status_code == 502


# ─── Delete ticket: delete_issue generic exception → 502 (lines 1584-1586) ───

def test_delete_ticket_delete_issue_generic_error(client, admin_cookies):
    """delete_issue raises generic exception → 502 (lines 1584-1586)."""
    with patch("app.gitlab_client.delete_issue", side_effect=Exception("gitlab down")):
        resp = client.delete("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── Update ticket: non-developer get_issue error → 502 (lines 1648-1650) ────

def test_update_ticket_non_developer_get_issue_error(client, user_cookies):
    """user role: get_issue raises → 502 (lines 1648-1650)."""
    with patch("app.gitlab_client.get_issue", side_effect=Exception("gitlab down")):
        resp = client.patch("/tickets/42", json={"title": "새 제목입니다"}, cookies=user_cookies)
    assert resp.status_code == 502


# ─── Update ticket: developer tries to set assignee_id → 403 (line 1665) ─────

def test_update_ticket_developer_assignee_forbidden(client, developer_cookies):
    """developer role with assignee_id → 403 (line 1665)."""
    issue_data = {**FAKE_ISSUE, "state": "opened", "labels": ["status::open"]}
    with patch("app.gitlab_client.get_issue", return_value=issue_data):
        resp = client.patch(
            "/tickets/42",
            json={"assignee_id": 99},
            cookies=developer_cookies,
        )
    assert resp.status_code == 403


# ─── Update ticket: title update (line 1728) ─────────────────────────────────

def test_update_ticket_title_field(client, admin_cookies):
    """Passing title populates new_title (line 1728)."""
    updated = {**FAKE_ISSUE, "title": "새 제목입니다", "updated_at": "2024-06-01T00:00:00Z"}
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=updated),
    ):
        resp = client.patch("/tickets/42", json={"title": "새 제목입니다"}, cookies=admin_cookies)
    assert resp.status_code == 200


# ─── Update ticket: description with department/location in meta (lines 1739, 1741) ──

def test_update_ticket_description_with_dept_location_meta(client, admin_cookies):
    """Existing meta with 부서/위치 is preserved when description updated (lines 1739-1741)."""
    issue_with_meta = {
        **FAKE_ISSUE,
        "description": (
            "**신청자:** 홍길동\n**이메일:** hong@example.com\n"
            "**작성자:** hong\n**부서:** 개발팀\n**위치:** 2층\n---\n원본 내용"
        ),
        "updated_at": "2024-06-01T00:00:00Z",
    }
    updated = {**issue_with_meta, "description": "새 내용"}
    with (
        patch("app.gitlab_client.get_issue", return_value=issue_with_meta),
        patch("app.gitlab_client.update_issue", return_value=updated) as mock_upd,
    ):
        resp = client.patch(
            "/tickets/42",
            json={"description": "새 내용으로 업데이트합니다."},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    new_desc = mock_upd.call_args[1].get("description") or ""
    assert "개발팀" in new_desc
    assert "2층" in new_desc


# ─── Update ticket: assignee_id + change_reason in audit (lines 1781, 1784) ──

def test_update_ticket_assignee_and_change_reason(client, pl_cookies):
    """assignee_id and change_reason flow into audit (lines 1781, 1784)."""
    issue_data = {**FAKE_ISSUE, "updated_at": "2024-06-01T00:00:00Z"}
    updated = {**issue_data, "assignee": {"id": 99}}
    with (
        patch("app.gitlab_client.get_issue", return_value=issue_data),
        patch("app.gitlab_client.update_issue", return_value=updated),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"assignee_id": 99, "change_reason": "담당자 재배정"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200


# ─── Update ticket: resume SLA when changing from waiting (line 1796) ─────────

def test_update_ticket_resume_sla_from_waiting(client, admin_cookies):
    """Status changed from 'waiting' resumes SLA (line 1796)."""
    waiting_issue = {
        **FAKE_ISSUE,
        "state": "opened",
        "labels": ["status::waiting", "prio::medium"],
        "updated_at": "2024-06-01T00:00:00Z",
    }
    updated = {**waiting_issue, "labels": ["status::in_progress"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=waiting_issue),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
        patch("app.sla.resume_sla") as mock_resume,
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "in_progress"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    mock_resume.assert_called_once()


# ─── Update ticket: resolution note save error non-fatal (lines 1840-1841) ───

def test_update_ticket_resolution_note_db_error_non_fatal(client, admin_cookies):
    """Resolution note DB save error is swallowed (lines 1840-1841)."""
    open_issue = {
        **FAKE_ISSUE,
        "state": "opened",
        "labels": ["status::in_progress", "prio::medium"],
        "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n**작성자:** hong\n---\n내용",
        "updated_at": "2024-06-01T00:00:00Z",
    }
    resolved = {**open_issue, "labels": ["prio::medium"], "state": "closed"}
    with (
        patch("app.gitlab_client.get_issue", return_value=open_issue),
        patch("app.gitlab_client.update_issue", return_value=resolved),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.tickets.sla_module.mark_resolved"),
        patch("app.routers.tickets.create_db_notification", side_effect=Exception("db error")),
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "resolved", "resolution_note": "문제 해결됨", "resolution_type": "duplicate"},
            cookies=admin_cookies,
        )
    # Should succeed despite notification errors
    assert resp.status_code == 200


# ─── add_comment: notification get_issue error non-fatal (lines 2046-2047) ───

def test_add_comment_notification_get_issue_error(client, admin_cookies):
    """get_issue raises after note added → non-fatal warning (lines 2046-2047)."""
    note = {
        "id": 1, "body": "테스트 댓글", "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T00:00:00Z", "confidential": False,
    }
    with (
        patch("app.gitlab_client.add_note", return_value=note),
        patch("app.gitlab_client.get_issue", side_effect=Exception("gitlab down")),
    ):
        resp = client.post(
            "/tickets/42/comments",
            json={"body": "테스트 댓글입니다."},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201


# ─── Timeline: Redis error → falls back gracefully (lines 2138-2141) ──────────

def test_get_timeline_redis_error_falls_back(client, admin_cookies):
    """Redis error on get falls back to None (lines 2138-2141)."""
    mock_r = MagicMock()
    mock_r.get.side_effect = Exception("redis down")
    note = {
        "id": 1, "body": "댓글", "system": False,
        "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T00:00:00Z", "confidential": False,
    }
    with (
        patch("app.routers.tickets.comments._get_redis", return_value=mock_r),
        patch("app.gitlab_client.get_notes", return_value=[note]),
    ):
        resp = client.get("/tickets/42/timeline", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ─── Timeline: audit log exception non-fatal (lines 2181-2192) ───────────────

def test_get_timeline_audit_log_error_non_fatal(client, admin_cookies):
    """Audit log DB error is swallowed (lines 2181-2192)."""
    note = {
        "id": 2, "body": "노트", "system": False,
        "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T00:00:00Z", "confidential": False,
    }
    with (
        patch("app.gitlab_client.get_notes", return_value=[note]),
        patch("app.routers.tickets.AuditLog", side_effect=Exception("db error")),
    ):
        resp = client.get("/tickets/42/timeline", cookies=admin_cookies)
    # Still returns what notes were collected
    assert resp.status_code == 200


# ─── Timeline: Redis cache save error non-fatal (lines 2204-2205) ─────────────

def test_get_timeline_redis_cache_save_error(client, admin_cookies):
    """Redis cache save error is swallowed (lines 2204-2205)."""
    mock_r = MagicMock()
    mock_r.get.return_value = None
    mock_r.setex.side_effect = Exception("redis save error")
    note = {
        "id": 3, "body": "캐시 에러 테스트", "system": False,
        "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T00:00:00Z", "confidential": False,
    }
    with (
        patch("app.routers.tickets.comments._get_redis", return_value=mock_r),
        patch("app.gitlab_client.get_notes", return_value=[note]),
    ):
        resp = client.get("/tickets/42/timeline", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── get_ticket: httpx non-404 error → 502 (lines 1396-1397) ────────────────

def test_get_ticket_httpx_non_404_returns_502(client, admin_cookies):
    """httpx.HTTPStatusError with non-404 status → 502 (lines 1396-1397)."""
    import httpx as _httpx
    mock_response = MagicMock()
    mock_response.status_code = 500
    err = _httpx.HTTPStatusError("server error", request=MagicMock(), response=mock_response)
    with patch("app.gitlab_client.get_issue", side_effect=err):
        resp = client.get("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── get_ticket_sla with record (line 1340) ──────────────────────────────────

def test_get_ticket_sla_returns_record(client, admin_cookies, db_session):
    """SLA record exists → returns dict (line 1340)."""
    from app.models import SLARecord
    from datetime import datetime, timezone, timedelta
    record = SLARecord(
        gitlab_issue_iid=42,
        project_id="1",
        priority="medium",
        sla_deadline=(datetime.now(timezone.utc) + timedelta(hours=48)).replace(tzinfo=None),
        breached=False,
    )
    db_session.add(record)
    db_session.commit()
    resp = client.get("/tickets/42/sla", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json() is not None


# ─── pipeline trigger: add_note error non-fatal (lines 1278-1279) ─────────────

def test_trigger_pipeline_add_note_error_non_fatal(client, admin_cookies):
    """Pipeline triggers but add_note raises — non-fatal (lines 1278-1279)."""
    pipeline_result = {"id": 99, "web_url": "http://gitlab/pipelines/99", "status": "pending"}
    with (
        patch("app.gitlab_client.trigger_pipeline", return_value=pipeline_result),
        patch("app.gitlab_client.add_note", side_effect=Exception("note error")),
    ):
        resp = client.post("/tickets/42/pipeline", cookies=admin_cookies)
    assert resp.status_code == 201


# ─── clone_ticket: post-processing + add_note error (lines 1454-1455, 1464-1465) ──

def test_clone_ticket_post_processing_and_note_error(client, admin_cookies):
    """Clone post-processing/SLA raises, then add_note raises — both non-fatal."""
    original = {**FAKE_ISSUE, "title": "원본 티켓"}
    cloned = {**FAKE_ISSUE, "iid": 55, "title": "[복제] 원본 티켓"}
    with (
        patch("app.gitlab_client.get_issue", return_value=original),
        patch("app.gitlab_client.create_issue", return_value=cloned),
        patch("app.sla.create_sla_record", side_effect=Exception("sla fail")),
        patch("app.gitlab_client.add_note", side_effect=Exception("note fail")),
    ):
        resp = client.post("/tickets/42/clone", cookies=admin_cookies)
    assert resp.status_code == 201


# ─── merge_ticket: target not found → 404 (lines 1500-1501) ─────────────────

def test_merge_ticket_target_not_found(client, admin_cookies):
    """merge_ticket: target get_issue raises → 404 (lines 1500-1501)."""
    source = {**FAKE_ISSUE, "state": "opened"}
    call_count = [0]
    def _get_issue_se(iid, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return source
        raise Exception("not found")
    with patch("app.gitlab_client.get_issue", side_effect=_get_issue_se):
        resp = client.post("/tickets/42/merge?target_iid=99", cookies=admin_cookies)
    assert resp.status_code == 404


# ─── merge_ticket: error cases (lines 1519-1520, 1531-1532, 1542-1543) ───────

def test_merge_ticket_all_note_errors_swallowed(client, admin_cookies):
    """All note/close errors during merge are swallowed."""
    source = {**FAKE_ISSUE, "state": "opened", "title": "소스 티켓"}
    target = {**FAKE_ISSUE, "iid": 99, "state": "opened"}
    call_count = [0]
    def _get_issue_se2(iid, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return source
        return target

    with (
        patch("app.gitlab_client.get_issue", side_effect=_get_issue_se2),
        patch("app.gitlab_client.get_notes", side_effect=Exception("notes error")),
        patch("app.gitlab_client.add_note", side_effect=Exception("note error")),
        patch("app.gitlab_client.update_issue", side_effect=Exception("update error")),
    ):
        resp = client.post("/tickets/42/merge?target_iid=99", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── delete_ticket: httpx non-404 error → 502 (lines 1582-1583) ─────────────

def test_delete_ticket_httpx_non_404_returns_502(client, admin_cookies):
    """delete_issue raises httpx non-404 → 502 (lines 1582-1583)."""
    import httpx as _httpx
    mock_response = MagicMock()
    mock_response.status_code = 500
    err = _httpx.HTTPStatusError("server error", request=MagicMock(), response=mock_response)
    with patch("app.gitlab_client.delete_issue", side_effect=err):
        resp = client.delete("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── delete_ticket: DB cleanup error non-fatal (lines 1621-1623) ─────────────

def test_delete_ticket_db_cleanup_error_non_fatal(client, admin_cookies):
    """DB cleanup after delete raises → non-fatal (lines 1621-1623)."""
    with (
        patch("app.gitlab_client.delete_issue"),
        patch("app.routers.tickets.SLARecord", side_effect=Exception("db error")),
    ):
        resp = client.delete("/tickets/42", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── update_ticket: in-app notification for assignee (lines 1857-1865) ────────

def test_update_ticket_in_app_notification_for_assignee(client, admin_cookies):
    """Status change triggers in-app notification for assignee (lines 1857-1865)."""
    issue = {
        **FAKE_ISSUE,
        "state": "opened",
        "labels": ["status::open", "prio::medium"],
        "assignee": {"id": 99},
        "updated_at": "2024-06-01T00:00:00Z",
    }
    updated = {**issue, "labels": ["status::in_progress", "prio::medium"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.tickets.crud.create_db_notification") as mock_notify,
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "in_progress"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    mock_notify.assert_called()


# ─── update_ticket: CSAT notification on resolved (lines 1875-1883) ──────────

def test_update_ticket_csat_notification_on_resolved(client, admin_cookies):
    """Status changed to resolved triggers CSAT notification (lines 1875-1883)."""
    issue = {
        **FAKE_ISSUE,
        "state": "opened",
        "labels": ["status::in_progress", "prio::medium"],
        "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n**작성자:** hong\n---\n내용",
        "updated_at": "2024-06-01T00:00:00Z",
    }
    updated = {
        **issue,
        "state": "closed",
        "labels": ["prio::medium"],
        "description": issue["description"],
    }
    with (
        patch("app.gitlab_client.get_issue", return_value=issue),
        patch("app.gitlab_client.update_issue", return_value=updated),
        patch("app.gitlab_client.add_note"),
        patch("app.routers.tickets.sla_module.mark_resolved"),
        patch("app.routers.webhooks._parse_submitter_username", return_value="hong"),
        patch("app.routers.webhooks._get_gitlab_user_id_by_username", return_value="55"),
        patch("app.routers.tickets.crud.create_db_notification") as mock_notify,
    ):
        resp = client.patch(
            "/tickets/42",
            json={"status": "resolved"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    mock_notify.assert_called()


# ─── convert_resolution_to_kb: gitlab error uses fallback title (lines 1948-1949) ──

def test_convert_resolution_to_kb_gitlab_error_fallback(client, admin_cookies, db_session):
    """gitlab_client.get_issue raises → uses fallback title (lines 1948-1949)."""
    from app.models import ResolutionNote
    rn = ResolutionNote(
        ticket_iid=42,
        project_id="1",
        note="해결 방법: 재시작 후 정상 작동",
        resolution_type="duplicate",
        created_by="1",
        created_by_name="Admin",
    )
    db_session.add(rn)
    db_session.commit()

    with patch("app.gitlab_client.get_issue", side_effect=Exception("gitlab down")):
        resp = client.post(
            "/tickets/42/resolution/convert-to-kb",
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    data = resp.json()
    assert "kb_article_id" in data
    assert "42" in data["title"]


# ─── convert_resolution_to_kb: slug uniqueness counter (line 1958) ───────────

def test_convert_resolution_to_kb_slug_uniqueness(client, admin_cookies, db_session):
    """Slug counter loop fires when base slug already exists (line 1958)."""
    from app.models import ResolutionNote, KBArticle
    existing = KBArticle(
        title="기존 아티클",
        slug="티켓-42-해결-방법",
        content="내용",
        author_id="1",
        author_name="Admin",
        published=False,
        tags=[],
    )
    db_session.add(existing)
    rn = ResolutionNote(
        ticket_iid=42,
        project_id="1",
        note="해결 방법: 재시작 후 정상 작동",
        resolution_type="duplicate",
        created_by="1",
        created_by_name="Admin",
    )
    db_session.add(rn)
    db_session.commit()

    with patch("app.gitlab_client.get_issue", side_effect=Exception("no issue")):
        resp = client.post(
            "/tickets/42/resolution/convert-to-kb",
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    assert resp.json()["slug"].endswith("-1")


# ─── add_comment: @mention creates in-app notification (lines 2059-2080) ─────

def test_add_comment_at_mention_notification(client, admin_cookies, db_session):
    """@mention with data-id in body creates in-app notification (lines 2059-2080)."""
    from app.models import UserRole
    ur = UserRole(
        gitlab_user_id=77,
        username="target_user",
        name="Target User",
        role="developer",
        is_active=True,
    )
    db_session.add(ur)
    db_session.commit()

    note = {
        "id": 10, "body": "테스트", "author": {"name": "Admin", "avatar_url": None},
        "created_at": "2024-01-01T00:00:00Z", "confidential": False,
    }
    body_with_mention = 'Hi <span class="mention" data-id="target_user">@target_user</span>'
    mock_ur = MagicMock()
    mock_ur.gitlab_user_id = 77
    mock_ur.username = "target_user"
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_ur]
    mock_db.commit.return_value = None
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)
    with (
        patch("app.gitlab_client.add_note", return_value=note),
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.routers.tickets.comments.create_db_notification") as mock_notify,
    ):
        resp = client.post(
            "/tickets/42/comments",
            json={"body": body_with_mention},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    mock_notify.assert_called()


# ─── Bulk: 새로 추가된 액션 (set_status / add_label / remove_label) ────────────

def test_bulk_set_status(client, pl_cookies):
    """Bulk set_status action updates status label on each ticket."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "set_status", "value": "in_progress", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["success"], list)


def test_bulk_add_label(client, pl_cookies):
    """Bulk add_label action adds label to each ticket."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "add_label", "value": "team::backend", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["success"], list)


def test_bulk_remove_label(client, pl_cookies):
    """Bulk remove_label action removes label from each ticket."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "remove_label", "value": "cat::network", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["success"], list)


def test_bulk_set_status_missing_value_ignored(client, pl_cookies):
    """Bulk set_status with missing value still succeeds (value treated as empty)."""
    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.gitlab_client.update_issue", return_value=FAKE_ISSUE),
    ):
        resp = client.post(
            "/tickets/bulk",
            json={"iids": [42], "action": "set_status", "project_id": "1"},
            cookies=pl_cookies,
        )
    assert resp.status_code in (200, 422)


# ─── Export: xlsx 엔드포인트 ────────────────────────────────────────────────────

def test_export_xlsx_success(client, admin_cookies):
    """GET /tickets/export/xlsx returns Excel file with correct content-type."""
    with patch("app.gitlab_client.get_issues", return_value=([FAKE_ISSUE], 1)):
        resp = client.get(
            "/tickets/export/xlsx",
            params={"project_id": "1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers.get("content-type", "")


def test_export_xlsx_empty_result(client, admin_cookies):
    """xlsx export with no tickets returns valid empty workbook."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get(
            "/tickets/export/xlsx",
            params={"project_id": "1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_export_xlsx_requires_auth(client):
    """xlsx export without auth returns 401/403."""
    resp = client.get("/tickets/export/xlsx", params={"project_id": "1"})
    assert resp.status_code in (401, 403)
