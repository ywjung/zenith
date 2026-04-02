"""Tests for approval request endpoints."""
from unittest.mock import patch

FAKE_ISSUE = {
    "iid": 5,
    "title": "보안 소프트웨어 설치 요청",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n\n---\n\n내용",
    "state": "opened",
    "labels": ["status::open", "prio::high"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "web_url": "http://gitlab/issues/5",
}


# ── list ──────────────────────────────────────────────────────────────────────

def test_list_approvals_requires_auth(client):
    resp = client.get("/approvals")
    assert resp.status_code == 401


def test_list_approvals_as_agent(client, admin_cookies):
    resp = client.get("/approvals", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── create ────────────────────────────────────────────────────────────────────

def test_create_approval_request(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.post(
            "/approvals",
            json={
                "ticket_iid": 5,
                "project_id": "1",
            },
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["ticket_iid"] == 5
    assert data["status"] == "pending"


def test_create_approval_missing_ticket(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", side_effect=Exception("not found")):
        resp = client.post(
            "/approvals",
            json={
                "ticket_iid": 99999,
                "project_id": "1",
            },
            cookies=admin_cookies,
        )
    assert resp.status_code in (404, 502)


# ── approve / reject ──────────────────────────────────────────────────────────

def test_approve_nonexistent_request(client, admin_cookies):
    resp = client.post("/approvals/99999/approve", cookies=admin_cookies)
    assert resp.status_code == 404


def test_reject_nonexistent_request(client, admin_cookies):
    resp = client.post(
        "/approvals/99999/reject",
        json={"reason": "이유"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_approve_pending_request(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post(
            "/approvals",
            json={
                "ticket_iid": 5,
                "project_id": "1",
            },
            cookies=admin_cookies,
        )
    assert create.status_code == 201
    approval_id = create.json()["id"]

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        approve = client.post(f"/approvals/{approval_id}/approve", cookies=admin_cookies)
    assert approve.status_code == 200
    assert approve.json()["status"] == "approved"


def test_reject_pending_request(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post(
            "/approvals",
            json={
                "ticket_iid": 5,
                "project_id": "1",
            },
            cookies=admin_cookies,
        )
    assert create.status_code == 201
    approval_id = create.json()["id"]

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        reject = client.post(
            f"/approvals/{approval_id}/reject",
            json={"reason": "예산 초과"},
            cookies=admin_cookies,
        )
    assert reject.status_code == 200
    assert reject.json()["status"] == "rejected"


def test_list_approvals_with_filter(client, admin_cookies):
    resp = client.get("/approvals?status=pending", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_approvals_by_ticket(client, admin_cookies):
    resp = client.get("/approvals?ticket_iid=1", cookies=admin_cookies)
    assert resp.status_code == 200


def test_create_duplicate_approval_409(client, admin_cookies):
    """Second pending request for same ticket returns 409."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        client.post("/approvals", json={"ticket_iid": 5, "project_id": "1"}, cookies=admin_cookies)
        resp = client.post("/approvals", json={"ticket_iid": 5, "project_id": "1"}, cookies=admin_cookies)
    assert resp.status_code == 409


def test_approve_already_approved_409(client, admin_cookies):
    """Approving an already approved request returns 409."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post("/approvals", json={"ticket_iid": 5, "project_id": "1"}, cookies=admin_cookies)
    approval_id = create.json()["id"]

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        client.post(f"/approvals/{approval_id}/approve", cookies=admin_cookies)
        resp = client.post(f"/approvals/{approval_id}/approve", cookies=admin_cookies)
    assert resp.status_code == 409


def test_reject_already_rejected_409(client, admin_cookies):
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post("/approvals", json={"ticket_iid": 5, "project_id": "1"}, cookies=admin_cookies)
    approval_id = create.json()["id"]

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        client.post(f"/approvals/{approval_id}/reject", json={"reason": "이유"}, cookies=admin_cookies)
        resp = client.post(f"/approvals/{approval_id}/reject", json={"reason": "이유"}, cookies=admin_cookies)
    assert resp.status_code == 409


def test_create_approval_invalid_project_id(client, admin_cookies):
    """Invalid project_id triggers Pydantic validator ValueError (line 48)."""
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        resp = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "99999"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 422


def test_create_approval_with_approver_notification(client, admin_cookies, db_session):
    """When approver_username set and UserRole found → notification sent (lines 112-119)."""
    from app.models import UserRole

    db_session.add(UserRole(username="approver1", role="agent", gitlab_user_id="77"))
    db_session.commit()

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.routers.approvals.create_db_notification"),
    ):
        resp = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "1", "approver_username": "approver1"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    assert resp.json()["approver_username"] == "approver1"


def test_approve_request_wrong_approver_403(client, db_session):
    """Agent who is not the designated approver → 403 (lines 149-150)."""
    import time
    import jwt as _jwt

    # Create approval as admin with approver_username="someone_else"
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        from tests.conftest import make_token
        admin_token = make_token(role="admin", username="admin_user")
        create = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "1", "approver_username": "someone_else"},
            cookies={"itsm_token": admin_token},
        )
    assert create.status_code == 201
    approval_id = create.json()["id"]

    # Try to approve as an agent with a different username
    agent_token = _jwt.encode({
        "sub": "99", "role": "agent", "name": "Other Agent",
        "username": "other_agent", "email": "other@test.com",
        "exp": int(time.time()) + 7200, "gitlab_token": "tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    resp = client.post(
        f"/approvals/{approval_id}/approve",
        cookies={"itsm_token": agent_token},
    )
    assert resp.status_code == 403


def test_approve_request_with_requester_notification(client, admin_cookies, db_session):
    """When requester UserRole exists, notification sent on approve (line 164)."""
    from app.models import UserRole

    # admin_cookies uses username="hong", so add UserRole for "hong"
    db_session.add(UserRole(username="hong", role="admin", gitlab_user_id="42"))
    db_session.commit()

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "1"},
            cookies=admin_cookies,
        )
    approval_id = create.json()["id"]

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.routers.approvals.create_db_notification"),
    ):
        resp = client.post(f"/approvals/{approval_id}/approve", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


def test_reject_request_wrong_approver_403(client, db_session):
    """Non-admin non-approver agent reject → 403 (lines 195-197)."""
    import time
    import jwt as _jwt
    from tests.conftest import make_token

    admin_token = make_token(role="admin", username="admin_user")
    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "1", "approver_username": "specific_approver"},
            cookies={"itsm_token": admin_token},
        )
    approval_id = create.json()["id"]

    # Non-requester, non-approver, non-admin agent tries to reject
    agent_token = _jwt.encode({
        "sub": "88", "role": "agent", "name": "Random Agent",
        "username": "random_agent", "email": "rand@test.com",
        "exp": int(time.time()) + 7200, "gitlab_token": "tok",
    }, "test-secret-key-at-least-32-chars-long", algorithm="HS256")

    resp = client.post(
        f"/approvals/{approval_id}/reject",
        json={"reason": "이유"},
        cookies={"itsm_token": agent_token},
    )
    assert resp.status_code == 403


def test_reject_request_with_requester_notification(client, admin_cookies, db_session):
    """When requester UserRole exists, notification sent on reject (line 210)."""
    from app.models import UserRole

    db_session.add(UserRole(username="hong", role="admin", gitlab_user_id="42"))
    db_session.commit()

    with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE):
        create = client.post(
            "/approvals",
            json={"ticket_iid": 5, "project_id": "1"},
            cookies=admin_cookies,
        )
    approval_id = create.json()["id"]

    with (
        patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE),
        patch("app.routers.approvals.create_db_notification"),
    ):
        resp = client.post(
            f"/approvals/{approval_id}/reject",
            json={"reason": "예산 부족"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
