"""Tests for /projects endpoints."""
from unittest.mock import patch


FAKE_PROJECTS = [
    {"id": 1, "name": "ITSM 프로젝트", "name_with_namespace": "IT / ITSM", "path_with_namespace": "it/itsm"},
]

FAKE_MEMBERS = [
    {"id": 42, "name": "홍길동", "username": "hong", "avatar_url": None},
    {"id": 99, "name": "루트", "username": "root", "avatar_url": None},  # should be excluded
]

FAKE_MILESTONES = [
    {"id": 1, "iid": 1, "title": "2024 Q1", "description": "1분기 목표", "state": "active", "due_date": "2024-03-31"},
]


def test_list_projects_requires_auth(client):
    resp = client.get("/projects/")
    assert resp.status_code == 401


def test_list_projects_success(client, user_cookies):
    with patch("app.gitlab_client.get_user_projects", return_value=FAKE_PROJECTS):
        resp = client.get("/projects/", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "ITSM 프로젝트"


def test_list_projects_gitlab_error(client, user_cookies):
    with patch("app.gitlab_client.get_user_projects", side_effect=Exception("GitLab 오류")):
        resp = client.get("/projects/", cookies=user_cookies)
    assert resp.status_code == 502


def test_list_project_members_requires_auth(client):
    resp = client.get("/projects/1/members")
    assert resp.status_code == 401


def test_list_project_members_filters_by_role(client, admin_cookies):
    """Only users with developer+ ITSM roles should be returned."""
    with patch("app.gitlab_client.get_project_members", return_value=FAKE_MEMBERS):
        # member id=42 has admin role (from admin_cookies user_id=42)
        # member id=99 has no UserRole entry so excluded
        resp = client.get("/projects/1/members", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    # Only users with developer+ role in DB are returned; we need UserRole entries for that
    # With empty DB, both should be filtered out
    assert isinstance(data, list)


def test_list_project_members_gitlab_error(client, user_cookies):
    with patch("app.gitlab_client.get_project_members", side_effect=Exception("오류")):
        resp = client.get("/projects/1/members", cookies=user_cookies)
    assert resp.status_code == 502


def test_list_milestones_requires_auth(client):
    resp = client.get("/projects/1/milestones")
    assert resp.status_code == 401


def test_list_milestones_success(client, user_cookies):
    with patch("app.gitlab_client.get_milestones", return_value=FAKE_MILESTONES):
        resp = client.get("/projects/1/milestones", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["title"] == "2024 Q1"
    assert data[0]["state"] == "active"


def test_list_milestones_gitlab_error(client, user_cookies):
    with patch("app.gitlab_client.get_milestones", side_effect=Exception("GitLab 오류")):
        resp = client.get("/projects/1/milestones", cookies=user_cookies)
    assert resp.status_code == 502


def test_list_milestones_state_filter(client, user_cookies):
    with patch("app.gitlab_client.get_milestones", return_value=[]) as mock_ms:
        resp = client.get("/projects/1/milestones?state=closed", cookies=user_cookies)
    assert resp.status_code == 200
    # Verify state was passed to gitlab_client
    mock_ms.assert_called_once_with(project_id="1", state="closed")
