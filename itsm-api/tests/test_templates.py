"""Tests for /templates, /tickets/{iid}/links, and /tickets/{iid}/time endpoints."""
import pytest


# ── templates ─────────────────────────────────────────────────────────────────

def test_list_templates_requires_auth(client):
    resp = client.get("/templates/")
    assert resp.status_code == 401


def test_list_templates_empty(client, user_cookies):
    resp = client.get("/templates/", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_template_requires_agent(client, user_cookies):
    resp = client.post(
        "/templates/",
        json={"name": "초기화 템플릿", "description": "설명입니다", "enabled": True},
        cookies=user_cookies,
    )
    assert resp.status_code == 403


def test_create_template_success(client, admin_cookies):
    payload = {"name": "네트워크 장애", "description": "네트워크 관련 요청 템플릿", "category": "network"}
    resp = client.post("/templates/", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "네트워크 장애"
    assert data["category"] == "network"
    assert data["enabled"] is True
    assert "id" in data


def test_list_templates_returns_created(client, admin_cookies):
    client.post(
        "/templates/",
        json={"name": "장애 템플릿", "description": "장애 처리용 템플릿"},
        cookies=admin_cookies,
    )
    resp = client.get("/templates/", cookies=admin_cookies)
    assert resp.status_code == 200
    assert any(t["name"] == "장애 템플릿" for t in resp.json())


def test_get_template_not_found(client, user_cookies):
    resp = client.get("/templates/9999", cookies=user_cookies)
    assert resp.status_code == 404


def test_get_template_success(client, admin_cookies):
    create = client.post(
        "/templates/",
        json={"name": "하드웨어 요청", "description": "하드웨어 관련 템플릿"},
        cookies=admin_cookies,
    )
    tid = create.json()["id"]
    resp = client.get(f"/templates/{tid}", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["name"] == "하드웨어 요청"


def test_update_template_success(client, admin_cookies):
    create = client.post(
        "/templates/",
        json={"name": "원본 이름", "description": "원본 설명"},
        cookies=admin_cookies,
    )
    tid = create.json()["id"]
    resp = client.put(
        f"/templates/{tid}",
        json={"name": "수정된 이름", "description": "수정된 설명", "enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "수정된 이름"
    assert resp.json()["enabled"] is False


def test_update_template_not_found(client, admin_cookies):
    resp = client.put(
        "/templates/9999",
        json={"name": "없음", "description": "없음"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_delete_template_requires_admin(client, admin_cookies):
    """admin role satisfies require_admin."""
    create = client.post(
        "/templates/",
        json={"name": "삭제 대상", "description": "삭제될 템플릿"},
        cookies=admin_cookies,
    )
    tid = create.json()["id"]
    resp = client.delete(f"/templates/{tid}", cookies=admin_cookies)
    assert resp.status_code == 204


def test_delete_template_not_found(client, admin_cookies):
    resp = client.delete("/templates/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_disabled_template_not_in_list(client, admin_cookies):
    """Disabled templates should not appear in GET /templates/."""
    create = client.post(
        "/templates/",
        json={"name": "비활성 템플릿", "description": "비활성 설명", "enabled": False},
        cookies=admin_cookies,
    )
    assert create.status_code == 201
    resp = client.get("/templates/", cookies=admin_cookies)
    names = [t["name"] for t in resp.json()]
    assert "비활성 템플릿" not in names


# ── ticket links ───────────────────────────────────────────────────────────────

def test_get_links_requires_auth(client):
    resp = client.get("/tickets/1/links?project_id=1")
    assert resp.status_code == 401


def test_get_links_empty(client, user_cookies):
    resp = client.get("/tickets/1/links?project_id=1", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_link_requires_developer(client, user_cookies):
    resp = client.post(
        "/tickets/1/links",
        json={"target_iid": 2, "project_id": "1", "link_type": "related"},
        cookies=user_cookies,
    )
    assert resp.status_code == 403


def test_create_link_invalid_type(client, admin_cookies):
    resp = client.post(
        "/tickets/1/links",
        json={"target_iid": 2, "project_id": "1", "link_type": "invalid"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


def test_create_link_success(client, admin_cookies):
    from unittest.mock import patch
    with patch("app.gitlab_client.create_issue_link", return_value={"id": 10}):
        resp = client.post(
            "/tickets/1/links",
            json={"target_iid": 2, "project_id": "1", "link_type": "blocks"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["ok"] is True


def test_delete_link_success(client, admin_cookies):
    from unittest.mock import patch
    with patch("app.gitlab_client.delete_issue_link", return_value=True):
        resp = client.delete("/tickets/1/links/10", cookies=admin_cookies)
    assert resp.status_code == 204


def test_delete_link_not_found(client, admin_cookies):
    from unittest.mock import patch
    with patch("app.gitlab_client.delete_issue_link", return_value=False):
        resp = client.delete("/tickets/1/links/99999", cookies=admin_cookies)
    assert resp.status_code == 502


# ── time tracking ──────────────────────────────────────────────────────────────

def test_get_time_requires_developer(client, user_cookies):
    resp = client.get("/tickets/1/time?project_id=1", cookies=user_cookies)
    assert resp.status_code == 403


def test_get_time_empty(client, admin_cookies):
    resp = client.get("/tickets/1/time?project_id=1", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_minutes"] == 0
    assert data["entries"] == []


def test_log_time_success(client, admin_cookies):
    resp = client.post(
        "/tickets/1/time?project_id=1",
        json={"minutes": 90, "description": "장애 처리"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["minutes"] == 90
    assert data["description"] == "장애 처리"


def test_log_time_aggregation(client, admin_cookies):
    client.post("/tickets/1/time?project_id=1", json={"minutes": 60}, cookies=admin_cookies)
    client.post("/tickets/1/time?project_id=1", json={"minutes": 45}, cookies=admin_cookies)
    resp = client.get("/tickets/1/time?project_id=1", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["total_minutes"] == 105


def test_log_time_invalid_minutes(client, admin_cookies):
    resp = client.post(
        "/tickets/1/time?project_id=1",
        json={"minutes": 0},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


def test_log_time_max_minutes(client, admin_cookies):
    """Exceeding max (10080 minutes = 1 week) should fail."""
    resp = client.post(
        "/tickets/1/time?project_id=1",
        json={"minutes": 10081},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422
