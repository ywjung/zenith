"""Additional admin endpoint tests to increase coverage."""
from unittest.mock import patch


# ── SLA policies ──────────────────────────────────────────────────────────────

def test_get_sla_policies_as_admin(client, admin_cookies):
    resp = client.get("/admin/sla-policies", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_update_sla_policy(client, admin_cookies):
    resp = client.put(
        "/admin/sla-policies/high",
        json={"response_hours": 2, "resolve_hours": 8},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["priority"] == "high"


def test_get_sla_policies_requires_auth(client):
    resp = client.get("/admin/sla-policies")
    assert resp.status_code == 401


# ── service types ────────────────────────────────────────────────────────────

def test_list_service_types(client, admin_cookies):
    resp = client.get("/admin/service-types", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_and_update_service_type(client, admin_cookies):
    create = client.post(
        "/admin/service-types",
        json={"label": "테스트 서비스", "emoji": "🔧"},
        cookies=admin_cookies,
    )
    assert create.status_code == 201
    type_id = create.json()["id"]

    update = client.patch(
        f"/admin/service-types/{type_id}",
        json={"label": "수정된 서비스"},
        cookies=admin_cookies,
    )
    assert update.status_code == 200
    assert update.json()["label"] == "수정된 서비스"


# ── escalation policies ───────────────────────────────────────────────────────

def test_list_escalation_policies(client, admin_cookies):
    resp = client.get("/admin/escalation-policies", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_escalation_policy(client, admin_cookies):
    resp = client.post(
        "/admin/escalation-policies",
        json={
            "name": "테스트 에스컬레이션",
            "trigger": "breach",
            "delay_minutes": 60,
            "action": "notify",
            "notify_email": "manager@example.com",
            "enabled": True,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "테스트 에스컬레이션"


def test_delete_escalation_policy(client, admin_cookies):
    create = client.post(
        "/admin/escalation-policies",
        json={
            "name": "삭제용 에스컬레이션",
            "trigger": "warning",
            "delay_minutes": 120,
            "action": "notify",
            "enabled": True,
        },
        cookies=admin_cookies,
    )
    policy_id = create.json()["id"]
    del_resp = client.delete(f"/admin/escalation-policies/{policy_id}", cookies=admin_cookies)
    assert del_resp.status_code == 204


# ── announcements sub-module ──────────────────────────────────────────────────

def test_list_announcements_requires_admin(client, user_cookies):
    resp = client.get("/admin/announcements", cookies=user_cookies)
    assert resp.status_code == 403


def test_create_and_list_announcements(client, admin_cookies):
    create = client.post(
        "/admin/announcements",
        json={"title": "시스템 점검 안내", "content": "금일 오후 10시 점검 예정", "type": "warning"},
        cookies=admin_cookies,
    )
    assert create.status_code == 201
    ann_id = create.json()["id"]

    listing = client.get("/admin/announcements", cookies=admin_cookies)
    assert listing.status_code == 200
    ids = [a["id"] for a in listing.json()]
    assert ann_id in ids


def test_update_announcement(client, admin_cookies):
    create = client.post(
        "/admin/announcements",
        json={"title": "원본 제목", "content": "원본 내용", "type": "info"},
        cookies=admin_cookies,
    )
    ann_id = create.json()["id"]

    update = client.put(
        f"/admin/announcements/{ann_id}",
        json={"title": "수정 제목", "content": "수정 내용", "type": "critical"},
        cookies=admin_cookies,
    )
    assert update.status_code == 200
    assert update.json()["title"] == "수정 제목"


def test_delete_announcement(client, admin_cookies):
    create = client.post(
        "/admin/announcements",
        json={"title": "삭제용", "content": "삭제될 내용", "type": "info"},
        cookies=admin_cookies,
    )
    ann_id = create.json()["id"]
    del_resp = client.delete(f"/admin/announcements/{ann_id}", cookies=admin_cookies)
    assert del_resp.status_code == 204


# ── API keys sub-module ───────────────────────────────────────────────────────

def test_list_api_keys_as_admin(client, admin_cookies):
    resp = client.get("/admin/api-keys", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_api_key(client, admin_cookies):
    resp = client.post(
        "/admin/api-keys",
        json={"name": "테스트 API키", "scopes": ["tickets:read"]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "key" in data
    assert data["key"].startswith("itsm_live_")
    assert "warning" in data


def test_create_api_key_invalid_scope(client, admin_cookies):
    resp = client.post(
        "/admin/api-keys",
        json={"name": "잘못된 스코프", "scopes": ["invalid:scope"]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_create_api_key_duplicate_name(client, admin_cookies):
    name = "중복 테스트 키"
    client.post(
        "/admin/api-keys",
        json={"name": name, "scopes": ["tickets:read"]},
        cookies=admin_cookies,
    )
    resp = client.post(
        "/admin/api-keys",
        json={"name": name, "scopes": ["kb:read"]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ── filter options ────────────────────────────────────────────────────────────

def test_get_filter_options(client):
    """인증 없이도 필터 옵션 조회가 가능해야 한다."""
    resp = client.get("/admin/filter-options")
    assert resp.status_code == 200
    data = resp.json()
    assert "statuses" in data
    assert "priorities" in data


# ── assignment rules ──────────────────────────────────────────────────────────

def test_list_assignment_rules(client, admin_cookies):
    resp = client.get("/admin/assignment-rules", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_delete_assignment_rule(client, admin_cookies):
    create = client.post(
        "/admin/assignment-rules",
        json={
            "name": "삭제테스트 규칙",
            "match_category": "software",
            "assignee_gitlab_id": 99,
            "assignee_name": "담당자",
        },
        cookies=admin_cookies,
    )
    rule_id = create.json()["id"]
    del_resp = client.delete(f"/admin/assignment-rules/{rule_id}", cookies=admin_cookies)
    assert del_resp.status_code == 204


# ── email templates ───────────────────────────────────────────────────────────

def test_get_email_templates(client, admin_cookies):
    resp = client.get("/admin/email-templates", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_email_template_not_found(client, admin_cookies):
    """존재하지 않는 이벤트 타입 조회 시 404."""
    resp = client.get("/admin/email-templates/nonexistent_event", cookies=admin_cookies)
    assert resp.status_code == 404


# ── outbound webhooks ─────────────────────────────────────────────────────────

def test_list_outbound_webhooks(client, admin_cookies):
    resp = client.get("/admin/outbound-webhooks", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ─── API keys: additional coverage ───────────────────────────────────────────

def test_create_api_key_invalid_name(client, admin_cookies):
    """Invalid API key name → 422 (line 32 in api_keys.py)."""
    resp = client.post(
        "/admin/api-keys",
        json={"name": "!", "scopes": ["tickets:read"]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


def test_create_api_key_with_expiry(client, admin_cookies):
    """Create API key with expires_days → expiry calculated (line 79)."""
    resp = client.post(
        "/admin/api-keys",
        json={"name": "만료키", "scopes": ["tickets:read"], "expires_days": 30},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["expires_at"] is not None


def test_revoke_api_key_success(client, admin_cookies):
    """Revoke existing API key → revoked=True, 204 (lines 111-118)."""
    create = client.post(
        "/admin/api-keys",
        json={"name": "삭제키", "scopes": ["tickets:read"]},
        cookies=admin_cookies,
    )
    assert create.status_code == 201
    key_id = create.json()["id"]

    resp = client.delete(f"/admin/api-keys/{key_id}", cookies=admin_cookies)
    assert resp.status_code == 204


def test_get_workload_with_project_id_filter(client, admin_cookies):
    """get_workload with project_id → SLA project_id filter applied (line 1374)."""
    from unittest.mock import patch as _patch

    with _patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/admin/workload?project_id=123", cookies=admin_cookies)
    assert resp.status_code == 200


def test_create_escalation_policy_invalid_channel(client, admin_cookies):
    """Invalid notification_channel triggers validator ValueError → 422 (line 685)."""
    resp = client.post(
        "/admin/escalation-policies",
        json={
            "name": "Test Policy",
            "trigger_after_hours": 2,
            "notification_channel": "invalid_channel",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 422
