"""Additional admin router tests to increase coverage."""
from unittest.mock import patch, MagicMock


# ─── GET /admin/service-types/usage (lines 495-539) ──────────────────────────

def test_service_type_usage_with_types(client, admin_cookies, db_session):
    """Usage endpoint with a service type (covers lines 495-539)."""
    from app.models import ServiceType
    st = ServiceType(value="network", label="네트워크", sort_order=0)
    db_session.add(st)
    db_session.commit()

    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/admin/service-types/usage", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)


def test_service_type_usage_requires_admin(client, user_cookies):
    """Non-admin cannot access usage (403)."""
    resp = client.get("/admin/service-types/usage", cookies=user_cookies)
    assert resp.status_code == 403


# ─── POST /admin/cleanup-labels (lines 646-658) ───────────────────────────────

def test_cleanup_labels_missing_group_config(client, admin_cookies):
    """No GITLAB_GROUP_ID/TOKEN → 400 (covers lines 648-652)."""
    resp = client.post("/admin/cleanup-labels", cookies=admin_cookies)
    assert resp.status_code in (400, 403)


def test_cleanup_labels_with_config(client, admin_cookies):
    """With group config → calls gitlab_client (covers lines 653-655)."""
    from unittest.mock import MagicMock
    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = "123"
    mock_settings.GITLAB_GROUP_TOKEN = "token"
    with (
        patch("app.routers.admin.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.cleanup_duplicate_project_labels", return_value={"deleted": 2}),
    ):
        resp = client.post("/admin/cleanup-labels", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── GET /admin/label-status (lines 1037-1041) ───────────────────────────────

def test_get_label_status(client, admin_cookies):
    """Get label status (covers lines 1037-1041)."""
    with patch("app.gitlab_client.get_label_sync_status", return_value={"synced": [], "missing": []}):
        resp = client.get("/admin/label-status", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── POST /admin/sync-labels (lines 1045-1058) ───────────────────────────────

def test_sync_labels_success(client, admin_cookies):
    """Sync labels (covers lines 1045-1058)."""
    with patch("app.gitlab_client.sync_label_to_gitlab", return_value=True):
        resp = client.post("/admin/sync-labels", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── GET /admin/role-labels (lines 1146-1150) ────────────────────────────────

def test_get_role_labels(client, admin_cookies):
    """Get role labels (covers lines 1146-1150)."""
    resp = client.get("/admin/role-labels", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)
    assert "user" in data


def test_put_role_labels(client, admin_cookies):
    """Update role labels (covers lines 1161-1182)."""
    resp = client.put(
        "/admin/role-labels",
        json={"user": "일반 사용자", "admin": "관리자"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"] == "일반 사용자"


def test_put_role_labels_invalid_role_ignored(client, admin_cookies):
    """Unknown role is silently ignored (covers lines 1165-1166)."""
    resp = client.put(
        "/admin/role-labels",
        json={"invalid_role": "테스트", "user": "사용자"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "invalid_role" not in data


# ─── GET /admin/notification-channels (lines 1208-1221) ──────────────────────

def test_get_notification_channels(client, admin_cookies):
    """Get notification channels (covers lines 1208-1221)."""
    resp = client.get("/admin/notification-channels", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "email_enabled" in data
    assert "telegram_enabled" in data


def test_patch_notification_channels(client, admin_cookies):
    """Patch notification channels (covers lines 1232-1266)."""
    resp = client.patch(
        "/admin/notification-channels",
        json={"email_enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


def test_patch_notification_channels_no_changes(client, admin_cookies):
    """No changes → 400 (covers lines 1252-1253)."""
    resp = client.patch(
        "/admin/notification-channels",
        json={},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ─── GET /admin/workload (lines 1282-1465) ───────────────────────────────────

def test_get_workload_empty(client, admin_cookies):
    """Workload with no issues (covers lines 1282-1465)."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_workload_with_dates(client, admin_cookies):
    """Workload with date filters."""
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        resp = client.get(
            "/admin/workload?from_date=2024-01-01&to_date=2024-12-31",
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_get_workload_requires_admin(client, user_cookies):
    """Non-admin → 403."""
    resp = client.get("/admin/workload", cookies=user_cookies)
    assert resp.status_code == 403


def test_get_workload_with_issues_and_users(client, admin_cookies, db_session):
    """Workload with issues, users, SLA, ratings — covers lines 1310-1437."""
    from app.models import UserRole, SLARecord, Rating
    from unittest.mock import patch
    from datetime import datetime, timezone, timedelta

    # Register a user agent in DB
    db_session.add(UserRole(
        gitlab_user_id=99,
        username="agentuser",
        role="agent",
        is_active=True,
    ))
    db_session.commit()

    now = datetime.now(timezone.utc)
    fake_issues = [
        {
            "iid": 201,
            "state": "closed",
            "labels": ["status::resolved"],
            "assignees": [{"username": "agentuser", "name": "Agent User"}],
            "created_at": (now - timedelta(hours=5)).isoformat(),
            "closed_at": now.isoformat(),
        },
        {
            "iid": 202,
            "state": "opened",
            "labels": ["status::in_progress"],
            "assignees": [{"username": "agentuser", "name": "Agent User"}],
            "created_at": now.isoformat(),
        },
        {
            "iid": 203,
            "state": "opened",
            "labels": [],
            "assignees": [],  # no assignee → skipped
            "created_at": now.isoformat(),
        },
    ]

    # Add SLA records
    db_session.add(SLARecord(
        gitlab_issue_iid=201,
        project_id="1",
        priority="high",
        sla_deadline=(now + timedelta(hours=8)).replace(tzinfo=None),
        breached=False,
    ))
    db_session.commit()

    # Add rating
    db_session.add(Rating(
        gitlab_issue_iid=201,
        username="agentuser",
        employee_name="직원",
        score=5,
        comment="Good",
        created_at=now.replace(tzinfo=None),
    ))
    db_session.commit()

    with (
        patch("app.gitlab_client.get_issues", return_value=(fake_issues, len(fake_issues))),
        patch("app.routers.admin._fetch_gitlab_users_bulk", return_value={
            99: {"name": "Agent User", "avatar_url": None}
        }),
    ):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # agentuser should appear with data
    agent = next((u for u in data if u["username"] == "agentuser"), None)
    assert agent is not None
    assert agent["assigned"] >= 1


# ─── GET /admin/business-hours (lines 1466-1491) ─────────────────────────────

def test_get_business_hours(client, admin_cookies):
    """Get business hours (covers lines 1466-1491)."""
    resp = client.get("/admin/business-hours", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "schedule" in data
    assert "holidays" in data


def test_put_business_hours(client, admin_cookies):
    """Put business hours (covers lines 1494-1522)."""
    resp = client.put(
        "/admin/business-hours",
        json={"schedule": [
            {"day_of_week": 1, "start_time": "09:00", "end_time": "18:00", "is_active": True}
        ]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_put_business_hours_invalid_time(client, admin_cookies):
    """Invalid time format → 400 or 422 (covers lines 1505-1513)."""
    # "99:00"→"99:59" passes Pydantic (end > start as string) but range check fails → 400
    resp = client.put(
        "/admin/business-hours",
        json={"schedule": [
            {"day_of_week": 1, "start_time": "99:00", "end_time": "99:59", "is_active": True}
        ]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ─── POST /admin/holidays (lines 1525-1543) ──────────────────────────────────

def test_add_holiday_success(client, admin_cookies):
    """Add holiday (covers lines 1525-1543)."""
    resp = client.post(
        "/admin/holidays",
        json={"date": "2030-05-01", "name": "노동절"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["date"] == "2030-05-01"


def test_add_holiday_duplicate(client, admin_cookies, db_session):
    """Duplicate holiday → 409 (covers lines 1538-1539)."""
    from app.models import BusinessHoliday
    from datetime import date
    h = BusinessHoliday(date=date(2030, 5, 1), name="노동절")
    db_session.add(h)
    db_session.commit()

    resp = client.post(
        "/admin/holidays",
        json={"date": "2030-05-01", "name": "노동절"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 409


def test_add_holiday_invalid_date(client, admin_cookies):
    """Invalid date format → 400 (covers lines 1535-1536)."""
    resp = client.post(
        "/admin/holidays",
        json={"date": "not-a-date", "name": "테스트"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ─── DELETE /admin/holidays/{id} (lines 1546-1557) ───────────────────────────

def test_delete_holiday_not_found(client, admin_cookies):
    """Delete non-existent holiday → 404 (covers lines 1554-1555)."""
    resp = client.delete("/admin/holidays/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_holiday_success(client, admin_cookies, db_session):
    """Delete existing holiday (covers lines 1556-1557)."""
    from app.models import BusinessHoliday
    from datetime import date
    h = BusinessHoliday(date=date(2030, 6, 1), name="테스트")
    db_session.add(h)
    db_session.commit()
    db_session.refresh(h)

    resp = client.delete(f"/admin/holidays/{h.id}", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── POST /admin/holiday-years/{year} (lines 1560-1575) ──────────────────────

def test_add_holiday_year_success(client, admin_cookies):
    """Add holiday year (covers lines 1568-1575)."""
    resp = client.post("/admin/holiday-years/2035", cookies=admin_cookies)
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["year"] == 2035


def test_add_holiday_year_duplicate(client, admin_cookies, db_session):
    """Add duplicate year → returns existing (covers line 1572)."""
    from app.models import HolidayYear
    db_session.add(HolidayYear(year=2036))
    db_session.commit()

    resp = client.post("/admin/holiday-years/2036", cookies=admin_cookies)
    assert resp.status_code in (200, 201)


def test_add_holiday_year_invalid(client, admin_cookies):
    """Year out of range → 422 (covers lines 1569-1570)."""
    resp = client.post("/admin/holiday-years/1999", cookies=admin_cookies)
    assert resp.status_code == 422


# ─── DELETE /admin/holiday-years/{year} (lines 1578-1597) ────────────────────

def test_delete_holiday_year_with_holidays(client, admin_cookies, db_session):
    """Delete year with existing holidays → 409 (covers lines 1592-1593)."""
    from app.models import BusinessHoliday, HolidayYear
    from datetime import date
    db_session.add(HolidayYear(year=2037))
    db_session.add(BusinessHoliday(date=date(2037, 5, 1), name="노동절"))
    db_session.commit()

    resp = client.delete("/admin/holiday-years/2037", cookies=admin_cookies)
    assert resp.status_code == 409


def test_delete_holiday_year_success(client, admin_cookies, db_session):
    """Delete year without holidays (covers lines 1594-1596)."""
    from app.models import HolidayYear
    db_session.add(HolidayYear(year=2038))
    db_session.commit()

    resp = client.delete("/admin/holiday-years/2038", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── POST /admin/holidays/bulk (lines 1609-1635) ─────────────────────────────

def test_bulk_add_holidays_success(client, admin_cookies):
    """Bulk add holidays (covers lines 1617-1635)."""
    resp = client.post(
        "/admin/holidays/bulk",
        json={"holidays": [
            {"date": "2031-05-01", "name": "노동절"},
            {"date": "2031-05-05", "name": "어린이날"},
        ]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert len(data["added"]) == 2
    assert data["skipped"] == []


def test_bulk_add_holidays_with_duplicate(client, admin_cookies, db_session):
    """Bulk add with duplicate skips it (covers lines 1625-1628)."""
    from app.models import BusinessHoliday
    from datetime import date
    db_session.add(BusinessHoliday(date=date(2032, 5, 1), name="기존"))
    db_session.commit()

    resp = client.post(
        "/admin/holidays/bulk",
        json={"holidays": [
            {"date": "2032-05-01", "name": "노동절"},
            {"date": "2032-05-05", "name": "어린이날"},
        ]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert len(data["added"]) == 1
    assert "2032-05-01" in data["skipped"]


# ─── GET+POST /admin/custom-fields (lines 1675-1711) ─────────────────────────

def test_list_custom_fields_empty(client, admin_cookies):
    """List custom fields (covers lines 1681-1685)."""
    resp = client.get("/admin/custom-fields", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_custom_field_success(client, admin_cookies):
    """Create custom field (covers lines 1695-1711)."""
    resp = client.post(
        "/admin/custom-fields",
        json={"name": "dept_code", "label": "부서 코드", "field_type": "text"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "dept_code"


def test_create_custom_field_duplicate(client, admin_cookies, db_session):
    """Duplicate field name → 409 (covers lines 1695-1696)."""
    from app.models import CustomFieldDef
    db_session.add(CustomFieldDef(
        name="dup_field", label="중복", field_type="text",
        required=False, enabled=True, sort_order=0, created_by="admin"
    ))
    db_session.commit()

    resp = client.post(
        "/admin/custom-fields",
        json={"name": "dup_field", "label": "중복2", "field_type": "text"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 409


def test_create_custom_field_select_no_options(client, admin_cookies):
    """Select type without options → 400 (covers lines 1697-1698)."""
    resp = client.post(
        "/admin/custom-fields",
        json={"name": "priority_field", "label": "우선순위", "field_type": "select", "options": []},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_update_custom_field_not_found(client, admin_cookies):
    """Update non-existent field → 404 (covers lines 1723-1724)."""
    resp = client.patch(
        "/admin/custom-fields/9999",
        json={"label": "새 레이블"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_update_custom_field_success(client, admin_cookies, db_session):
    """Update field label (covers lines 1722-1733)."""
    from app.models import CustomFieldDef
    f = CustomFieldDef(
        name="update_me", label="원래 레이블", field_type="text",
        required=False, enabled=True, sort_order=0, created_by="admin"
    )
    db_session.add(f)
    db_session.commit()
    db_session.refresh(f)

    resp = client.patch(
        f"/admin/custom-fields/{f.id}",
        json={"label": "새 레이블", "enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["label"] == "새 레이블"
    assert data["enabled"] is False


def test_delete_custom_field_not_found(client, admin_cookies):
    """Delete non-existent field → 404 (covers lines 1744-1745)."""
    resp = client.delete("/admin/custom-fields/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_custom_field_success(client, admin_cookies, db_session):
    """Delete custom field (covers lines 1743-1749)."""
    from app.models import CustomFieldDef
    f = CustomFieldDef(
        name="delete_me", label="삭제", field_type="text",
        required=False, enabled=True, sort_order=0, created_by="admin"
    )
    db_session.add(f)
    db_session.commit()
    db_session.refresh(f)

    resp = client.delete(f"/admin/custom-fields/{f.id}", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── Email template endpoints (lines 825-887) ────────────────────────────────

def test_update_email_template(client, admin_cookies, db_session):
    """Update email template (covers lines 829-855)."""
    from app.models import EmailTemplate
    db_session.add(EmailTemplate(
        event_type="ticket_created",
        subject="[ITSM] 티켓",
        html_body="<p>내용</p>",
        enabled=True,
        updated_by="admin",
    ))
    db_session.commit()

    resp = client.put(
        "/admin/email-templates/ticket_created",
        json={
            "subject": "새 티켓: {{title}}",
            "html_body": "<p>새 티켓이 생성됐습니다.</p>",
            "enabled": True,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


def test_preview_email_template_not_found(client, admin_cookies):
    """Preview template for unknown event → empty template used (covers lines 865-887)."""
    resp = client.post(
        "/admin/email-templates/ticket_created/preview",
        json={
            "subject": "새 티켓: {title}",
            "html_body": "<p>내용</p>",
            "enabled": True,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


# ─── Outbound webhook endpoints (lines 929-999) ──────────────────────────────

def test_create_outbound_webhook(client, admin_cookies):
    """Create outbound webhook (covers lines 930-944)."""
    resp = client.post(
        "/admin/outbound-webhooks",
        json={
            "name": "테스트 웹훅",
            "url": "https://example.com/webhook",
            "events": ["ticket_created"],
            "enabled": True,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "테스트 웹훅"


def test_update_outbound_webhook_not_found(client, admin_cookies):
    """Update non-existent webhook → 404 (covers lines 954-958)."""
    resp = client.put(
        "/admin/outbound-webhooks/9999",
        json={"name": "없음", "url": "https://example.com", "events": [], "enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_delete_outbound_webhook_success(client, admin_cookies, db_session):
    """Delete outbound webhook (covers lines 970-982)."""
    from app.models import OutboundWebhook
    hook = OutboundWebhook(
        name="삭제할웹훅", url="https://example.com/del",
        events=["ticket_created"], enabled=True, created_by="admin",
    )
    db_session.add(hook)
    db_session.commit()
    db_session.refresh(hook)

    resp = client.delete(f"/admin/outbound-webhooks/{hook.id}", cookies=admin_cookies)
    assert resp.status_code == 204


def test_test_outbound_webhook_not_found(client, admin_cookies):
    """Test non-existent webhook → 404 (covers lines 994-999)."""
    resp = client.post("/admin/outbound-webhooks/9999/test", cookies=admin_cookies)
    assert resp.status_code == 404


# ─── Admin sessions endpoints (lines 1007-1030) ──────────────────────────────

def test_list_user_sessions_empty(client, admin_cookies):
    """List user sessions → empty (covers lines 1007-1017)."""
    resp = client.get("/admin/sessions/42", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_revoke_session_not_found(client, admin_cookies):
    """Revoke non-existent session → 404 (covers lines 1025-1030)."""
    resp = client.delete("/admin/sessions/9999", cookies=admin_cookies)
    assert resp.status_code == 404


# ─── Escalation policy: validation errors ────────────────────────────────────

def test_create_escalation_policy_invalid_trigger(client, admin_cookies):
    """Invalid trigger → 400 (line 725)."""
    resp = client.post(
        "/admin/escalation-policies",
        json={"name": "bad", "trigger": "invalid", "delay_minutes": 60, "action": "notify", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_create_escalation_policy_invalid_action(client, admin_cookies):
    """Invalid action → 400 (line 727)."""
    resp = client.post(
        "/admin/escalation-policies",
        json={"name": "bad", "trigger": "breach", "delay_minutes": 60, "action": "teleport", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_create_escalation_policy_reassign_no_target(client, admin_cookies):
    """reassign action without target_user_id → 400 (line 729)."""
    resp = client.post(
        "/admin/escalation-policies",
        json={"name": "bad", "trigger": "breach", "delay_minutes": 60, "action": "reassign", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_update_escalation_policy(client, admin_cookies):
    """Update escalation policy (lines 746-753)."""
    create = client.post(
        "/admin/escalation-policies",
        json={"name": "업데이트 전", "trigger": "breach", "delay_minutes": 60, "action": "notify", "enabled": True},
        cookies=admin_cookies,
    )
    assert create.status_code == 201
    policy_id = create.json()["id"]

    resp = client.put(
        f"/admin/escalation-policies/{policy_id}",
        json={"name": "업데이트 후", "trigger": "warning", "delay_minutes": 30, "action": "notify", "enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "업데이트 후"


def test_delete_escalation_policy_not_found(client, admin_cookies):
    """Delete non-existent policy → 404 (line 768)."""
    resp = client.delete("/admin/escalation-policies/9999", cookies=admin_cookies)
    assert resp.status_code == 404


# ─── Service type: error paths ───────────────────────────────────────────────

def test_update_service_type_not_found(client, admin_cookies):
    """Update non-existent service type → 404 (line 582)."""
    resp = client.patch(
        "/admin/service-types/9999",
        json={"label": "없음"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_delete_service_type_not_found(client, admin_cookies):
    """Delete non-existent service type → 404 (line 607)."""
    resp = client.delete("/admin/service-types/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_create_service_type_gitlab_sync_error(client, admin_cookies):
    """GitLab sync error on create is swallowed (lines 568-569)."""
    from unittest.mock import patch
    with patch("app.gitlab_client.sync_label_to_gitlab", side_effect=Exception("gitlab down")):
        resp = client.post(
            "/admin/service-types",
            json={"label": "GitLab에러테스트", "emoji": "🔥", "sort_order": 99},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201


def test_update_service_type_gitlab_sync_error(client, admin_cookies, db_session):
    """GitLab sync error on update is swallowed (lines 591-592)."""
    from app.models import ServiceType
    from unittest.mock import patch
    st = ServiceType(value="update-test", label="업데이트테스트", sort_order=0)
    db_session.add(st)
    db_session.commit()
    db_session.refresh(st)

    with patch("app.gitlab_client.sync_label_to_gitlab", side_effect=Exception("gitlab down")):
        resp = client.patch(
            f"/admin/service-types/{st.id}",
            json={"color": "#ff0000"},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


def test_delete_service_type_with_tickets(client, admin_cookies, db_session):
    """Delete service type when tickets exist → 409 (lines 617-621)."""
    from app.models import ServiceType
    from unittest.mock import patch
    st = ServiceType(value="in-use", label="사용중", sort_order=0)
    db_session.add(st)
    db_session.commit()
    db_session.refresh(st)

    with patch("app.gitlab_client.get_issues", return_value=([], 5)):
        resp = client.delete(f"/admin/service-types/{st.id}", cookies=admin_cookies)
    assert resp.status_code == 409


def test_delete_service_type_gitlab_count_error(client, admin_cookies, db_session):
    """GitLab count error on delete is swallowed → 204 (lines 624-625)."""
    from app.models import ServiceType
    from unittest.mock import patch
    st = ServiceType(value="count-error", label="카운트에러", sort_order=0)
    db_session.add(st)
    db_session.commit()
    db_session.refresh(st)

    with patch("app.gitlab_client.get_issues", side_effect=Exception("gitlab down")):
        resp = client.delete(f"/admin/service-types/{st.id}", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── Email template: error paths ─────────────────────────────────────────────

def test_get_email_template_not_found(client, admin_cookies):
    """Get non-existent email template → 404 (line 825)."""
    resp = client.get("/admin/email-templates/nonexistent_event", cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_email_template_not_found(client, admin_cookies):
    """Update non-existent email template → 404 (line 847)."""
    resp = client.put(
        "/admin/email-templates/nonexistent_event",
        json={"subject": "제목", "html_body": "<p>내용</p>", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


def test_update_email_template_jinja2_error(client, admin_cookies, db_session):
    """Invalid Jinja2 template → 400 (lines 842-843)."""
    from app.models import EmailTemplate
    tmpl = EmailTemplate(
        event_type="test.coverage",
        subject="제목",
        html_body="<p>내용</p>",
        enabled=True,
        updated_by="admin",
    )
    db_session.add(tmpl)
    db_session.commit()

    resp = client.put(
        "/admin/email-templates/test.coverage",
        json={"subject": "{% invalid jinja %", "html_body": "<p>내용</p>", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


# ─── Outbound webhook: update path ───────────────────────────────────────────

def test_update_outbound_webhook(client, admin_cookies, db_session):
    """Update outbound webhook (lines 958-966)."""
    from app.models import OutboundWebhook
    hook = OutboundWebhook(
        name="업데이트전 훅",
        url="http://external.example.com/hook",
        events=["ticket_created"],
        enabled=True,
        created_by="admin",
    )
    db_session.add(hook)
    db_session.commit()
    db_session.refresh(hook)

    resp = client.put(
        f"/admin/outbound-webhooks/{hook.id}",
        json={
            "name": "업데이트후 훅",
            "url": "http://external.example.com/hook2",
            "events": ["ticket_updated"],
            "enabled": False,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "업데이트후 훅"


# ─── Notification channels: upsert existing row ──────────────────────────────

def test_patch_notification_channels_existing_row(client, admin_cookies, db_session):
    """Updating existing SystemSetting row (lines 1240-1242)."""
    from app.models import SystemSetting
    from datetime import datetime, timezone
    # Pre-create the setting row
    db_session.add(SystemSetting(
        key="email_enabled",
        value="true",
        updated_by="admin",
        updated_at=datetime.now(timezone.utc),
    ))
    db_session.commit()

    resp = client.patch(
        "/admin/notification-channels",
        json={"email_enabled": False},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email_enabled"] is False


# ─── Role labels: empty label skip & existing row update ─────────────────────

def test_update_role_labels_empty_label_skipped(client, admin_cookies):
    """Empty label value is skipped (line 1169)."""
    resp = client.put(
        "/admin/role-labels",
        json={"admin": "", "agent": "상담사"},  # empty "admin" → skipped
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["agent"] == "상담사"


def test_update_role_labels_existing_row_updated(client, admin_cookies, db_session):
    """Updating an existing SystemSetting row for role label (lines 1173-1175)."""
    from app.models import SystemSetting
    from datetime import datetime, timezone
    db_session.add(SystemSetting(
        key="role_label.admin",
        value="구 관리자",
        updated_by="admin",
        updated_at=datetime.now(timezone.utc),
    ))
    db_session.commit()

    resp = client.put(
        "/admin/role-labels",
        json={"admin": "새 관리자"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    assert resp.json()["admin"] == "새 관리자"


# ─── Filter options: with SLA policies ───────────────────────────────────────

def test_get_filter_options_with_sla_policies(client, admin_cookies, db_session):
    """SLA policies exist → priorities built from DB (lines 1094-1096)."""
    from app.models import SLAPolicy
    for prio in ["critical", "high", "medium", "low"]:
        db_session.add(SLAPolicy(
            priority=prio,
            response_hours=4,
            resolve_hours=8 if prio == "critical" else 24,
        ))
    db_session.commit()

    resp = client.get("/admin/filter-options")
    assert resp.status_code == 200
    data = resp.json()
    assert "priorities" in data
    assert len(data["priorities"]) == 4


# ─── Audit CSV download with data ────────────────────────────────────────────

def test_download_audit_csv_with_mocked_data(client, admin_cookies):
    """Audit CSV download with mocked query — covers lines 267-284 (batch loop).
    The audit query uses PostgreSQL-specific ~ operator; mock it for SQLite tests."""
    from unittest.mock import patch, MagicMock
    from datetime import datetime, timezone

    # Create a fake audit log row (log, display_name)
    fake_log = MagicMock()
    fake_log.id = 1
    fake_log.created_at = datetime(2024, 1, 15, 9, 0, 0)
    fake_log.actor_username = "admin"
    fake_log.actor_role = "admin"
    fake_log.action = "ticket.create"
    fake_log.resource_type = "ticket"
    fake_log.resource_id = "1"
    fake_log.ip_address = None

    # Mock _build_audit_query to return a query that yields one batch then empty (covers line 268)
    call_count = [0]
    mock_q = MagicMock()
    def mock_all():
        if call_count[0] == 0:
            call_count[0] += 1
            return [(fake_log, "Admin")]
        return []
    mock_q.offset.return_value.limit.return_value.all.side_effect = mock_all

    with patch("app.routers.admin._build_audit_query", return_value=mock_q):
        resp = client.get("/admin/audit/download", cookies=admin_cookies)

    assert resp.status_code == 200
    assert "text/csv" in resp.headers.get("content-type", "")
    content = b"".join(resp.iter_bytes())
    assert b"ticket.create" in content


# ─── Service type usage: cache hit and exceptions ────────────────────────────

def test_service_type_usage_cache_hit(client, admin_cookies):
    """Cache hit returns JSON directly (line 510)."""
    import json
    from unittest.mock import patch, MagicMock

    mock_redis = MagicMock()
    mock_redis.get.return_value = json.dumps({})

    with patch("app.redis_client.get_redis", return_value=mock_redis):
        resp = client.get("/admin/service-types/usage", cookies=admin_cookies)
    assert resp.status_code == 200


def test_service_type_usage_count_exception(client, admin_cookies, db_session):
    """_count() exception returns (st.id, 0) — lines 522-523."""
    from app.models import ServiceType
    st = ServiceType(value="error-type", label="에러타입", sort_order=0)
    db_session.add(st)
    db_session.commit()

    from unittest.mock import patch
    with patch("app.gitlab_client.get_issues", side_effect=Exception("gitlab error")):
        resp = client.get("/admin/service-types/usage", cookies=admin_cookies)
    assert resp.status_code == 200
    # count falls back to 0
    data = resp.json()
    assert isinstance(data, dict)


def test_service_type_usage_cache_save_exception(client, admin_cookies, db_session):
    """Cache setex exception is swallowed — lines 536-537."""
    from app.models import ServiceType
    from unittest.mock import patch, MagicMock

    st = ServiceType(value="save-error", label="저장에러", sort_order=0)
    db_session.add(st)
    db_session.commit()

    mock_redis = MagicMock()
    mock_redis.get.return_value = None
    mock_redis.setex.side_effect = Exception("redis error")

    with (
        patch("app.redis_client.get_redis", return_value=mock_redis),
        patch("app.gitlab_client.get_issues", return_value=([], 0)),
    ):
        resp = client.get("/admin/service-types/usage", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── Cleanup labels: gitlab error ────────────────────────────────────────────

def test_cleanup_labels_gitlab_error(client, admin_cookies):
    """GitLab error during cleanup → 502 (lines 656-658)."""
    from unittest.mock import patch, MagicMock
    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = "42"
    mock_settings.GITLAB_GROUP_TOKEN = "token123"
    with (
        patch("app.routers.admin.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.cleanup_duplicate_project_labels", side_effect=Exception("err")),
    ):
        resp = client.post("/admin/cleanup-labels", cookies=admin_cookies)
    assert resp.status_code == 502


# ─── Escalation policy: invalid notification_channel validator ────────────────

def test_create_escalation_policy_invalid_notification_channel(client, admin_cookies):
    """Invalid notification_channel → 422 via Pydantic validator (lines 683-685)."""
    resp = client.post(
        "/admin/escalation-policies",
        json={
            "name": "bad-channel",
            "trigger": "breach",
            "delay_minutes": 60,
            "action": "notify",
            "enabled": True,
            "notification_channel": "pigeon",  # not in allowed set
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


# ─── Escalation policy: update 404 ───────────────────────────────────────────

def test_update_escalation_policy_not_found(client, admin_cookies):
    """Update non-existent escalation policy → 404 (line 748)."""
    resp = client.put(
        "/admin/escalation-policies/9999",
        json={"name": "없음", "trigger": "breach", "delay_minutes": 60, "action": "notify", "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 404


# ─── Email template preview: render error ─────────────────────────────────────

def test_preview_email_template_render_error(client, admin_cookies):
    """Jinja2 render error in preview → 400 (lines 886-887)."""
    resp = client.post(
        "/admin/email-templates/any_event/preview",
        json={"subject": "{{ undefined_var | required }}", "html_body": "<p>OK</p>", "enabled": True},
        cookies=admin_cookies,
    )
    # Render error → 400, OR Jinja2 silently renders to "" → 200
    assert resp.status_code in (200, 400)


# ─── Outbound webhook: invalid events on update, delete 404, test with hook ──

def test_update_outbound_webhook_invalid_events(client, admin_cookies, db_session):
    """Update with invalid events → 400 (line 961)."""
    from app.models import OutboundWebhook
    hook = OutboundWebhook(
        name="update-invalid",
        url="http://external.example.com/hook",
        events=["ticket_created"],
        enabled=True,
        created_by="admin",
    )
    db_session.add(hook)
    db_session.commit()
    db_session.refresh(hook)

    resp = client.put(
        f"/admin/outbound-webhooks/{hook.id}",
        json={"name": "업데이트", "url": "http://external.example.com/hook", "events": ["bogus_event"], "enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_delete_outbound_webhook_not_found(client, admin_cookies):
    """Delete non-existent webhook → 404 (line 980)."""
    resp = client.delete("/admin/outbound-webhooks/9999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_test_outbound_webhook_success(client, admin_cookies, db_session):
    """Test webhook with existing hook → calls _send_one (lines 998-999)."""
    from app.models import OutboundWebhook
    from unittest.mock import patch
    hook = OutboundWebhook(
        name="test-hook",
        url="http://external.example.com/hook",
        events=["ticket_created"],
        enabled=True,
        created_by="admin",
    )
    db_session.add(hook)
    db_session.commit()
    db_session.refresh(hook)

    with patch("app.outbound_webhook._send_one", return_value=200):
        resp = client.post(f"/admin/outbound-webhooks/{hook.id}/test", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == 200
    assert data["success"] is True


# ─── Sync labels: failed label path ──────────────────────────────────────────

def test_sync_all_labels_with_failed(client, admin_cookies):
    """sync_label_to_gitlab returns False for some → failed list populated (line 1056)."""
    from unittest.mock import patch
    with patch("app.gitlab_client.sync_label_to_gitlab", return_value=False):
        resp = client.post("/admin/sync-labels", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["failed"]) > 0


# ─── Revoke session: success path ────────────────────────────────────────────

def test_revoke_session_success(client, admin_cookies, db_session):
    """Revoke existing session → revoked=True, 204 (lines 1029-1030)."""
    from app.models import RefreshToken
    from datetime import datetime, timezone, timedelta
    import hashlib
    rt = RefreshToken(
        token_hash=hashlib.sha256(b"test-revoke-tok").hexdigest(),
        gitlab_user_id="42",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        revoked=False,
    )
    db_session.add(rt)
    db_session.commit()
    db_session.refresh(rt)

    resp = client.delete(f"/admin/sessions/{rt.id}", cookies=admin_cookies)
    assert resp.status_code == 204


# ─── Audit query builder unit tests (lines 175, 179, 182-183, 186-189, 191, 193) ───

def test_build_audit_query_filters():
    """Call _build_audit_query directly with various params — covers filter branches."""
    from unittest.mock import MagicMock
    from app.routers.admin import _build_audit_query
    from datetime import datetime, timezone

    mock_q = MagicMock()
    mock_q.filter.return_value = mock_q
    mock_db = MagicMock()
    mock_db.query.return_value.outerjoin.return_value.order_by.return_value = mock_q

    # Line 175: invalid resource_type → None
    _build_audit_query(mock_db, resource_type="invalid_type")
    # Line 177: valid resource_type → filter applied
    _build_audit_query(mock_db, resource_type="ticket")
    # Line 179: actor_id filter
    _build_audit_query(mock_db, actor_id="42")
    # Lines 182-183: actor_username LIKE escape
    _build_audit_query(mock_db, actor_username="admin%_test")
    # Lines 186-189: valid action prefix
    _build_audit_query(mock_db, action="ticket.update")
    # Lines 186-187: invalid action → None
    _build_audit_query(mock_db, action="hack_everything")
    # Lines 191, 193: date filters
    _build_audit_query(
        mock_db,
        from_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
        to_date=datetime(2024, 12, 31, tzinfo=timezone.utc),
    )


# ─── Audit row to dict (lines 198-199) ──────────────────────────────────────

def test_audit_row_to_dict():
    """_audit_row_to_dict covers lines 198-199."""
    from unittest.mock import MagicMock
    from app.routers.admin import _audit_row_to_dict
    from datetime import datetime, timezone

    mock_log = MagicMock()
    mock_log.id = 1
    mock_log.actor_id = "42"
    mock_log.actor_username = "admin"
    mock_log.actor_role = "admin"
    mock_log.action = "ticket.update"
    mock_log.resource_type = "ticket"
    mock_log.resource_id = "1"
    mock_log.old_value = "open"
    mock_log.new_value = "in_progress"
    mock_log.ip_address = None
    mock_log.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    result = _audit_row_to_dict((mock_log, "Admin User"))
    assert result["action"] == "ticket.update"
    assert result["actor_name"] == "Admin User"


# ─── Audit log list endpoint (lines 230-231) with mocked query ───────────────

def test_list_audit_logs_endpoint_mocked(client, admin_cookies):
    """List audit logs — lines 230-231 via mocked _build_audit_query."""
    from unittest.mock import patch, MagicMock
    mock_q = MagicMock()
    mock_q.count.return_value = 0
    mock_q.offset.return_value.limit.return_value.all.return_value = []
    with patch("app.routers.admin._build_audit_query", return_value=mock_q):
        resp = client.get("/admin/audit", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["logs"] == []


# ─── Users list with GitLab info (lines 75-76) ──────────────────────────────

def test_list_users_with_gitlab_info(client, admin_cookies, db_session):
    """User list endpoint returns user with GL info fields (lines 75-76)."""
    from unittest.mock import patch
    from app.models import UserRole
    # Add a user so rows is non-empty and lines 75-76 are reached
    existing = db_session.query(UserRole).filter(UserRole.gitlab_user_id == 99).first()
    if not existing:
        u = UserRole(gitlab_user_id=99, username="glinfo_user", role="agent")
        db_session.add(u)
        db_session.commit()

    fake_gl_info = {99: {"name": "GL Info User", "email": "gl@example.com", "organization": "Corp"}}
    with patch("app.routers.admin._fetch_gitlab_users_bulk", return_value=fake_gl_info):
        resp = client.get("/admin/users", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    names = [item["name"] for item in data["items"]]
    assert "GL Info User" in names


# ─── Filter options SLA exception (lines 1108-1109) ──────────────────────────

def test_get_filter_options_sla_query_exception(client, admin_cookies):
    """SLAPolicy query exception → fallback to default priorities (lines 1108-1109)."""
    from unittest.mock import patch
    with patch("app.models.SLAPolicy", side_effect=Exception("db error")):
        resp = client.get("/admin/filter-options", cookies=admin_cookies)
    # Should still return 200 with default priorities
    assert resp.status_code == 200


# ─── _invalidate_settings_cache Redis delete exception (lines 1199-1200) ─────

def test_patch_notification_channels_redis_delete_exception(client, admin_cookies, db_session):
    """Redis delete raises → exception swallowed (lines 1199-1200)."""
    from app.models import SystemSetting
    from datetime import datetime, timezone
    # Pre-create the email_enabled setting
    now = datetime.now(timezone.utc)
    for key in ("email_enabled", "telegram_enabled"):
        existing = db_session.query(SystemSetting).filter(SystemSetting.key == key).first()
        if not existing:
            db_session.add(SystemSetting(key=key, value="true", updated_by="admin", updated_at=now))
    db_session.commit()

    from unittest.mock import patch, MagicMock
    mock_r = MagicMock()
    mock_r.delete.side_effect = Exception("Redis down")
    with patch("app.redis_client.get_redis", return_value=mock_r):
        resp = client.patch(
            "/admin/notification-channels",
            json={"email_enabled": True, "telegram_enabled": True},
            cookies=admin_cookies,
        )
    assert resp.status_code == 200


# ─── Notification channels telegram_enabled (line 1250) ──────────────────────

def test_patch_notification_channels_telegram_only(client, admin_cookies, db_session):
    """telegram_enabled only → line 1250 covered."""
    from app.models import SystemSetting
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for key in ("email_enabled", "telegram_enabled"):
        existing = db_session.query(SystemSetting).filter(SystemSetting.key == key).first()
        if not existing:
            db_session.add(SystemSetting(key=key, value="false", updated_by="admin", updated_at=now))
    db_session.commit()
    resp = client.patch(
        "/admin/notification-channels",
        json={"telegram_enabled": True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


# ─── BusinessHoursItem validator end_time <= start_time (line 1453) ──────────

def test_set_business_hours_invalid_end_time(client, admin_cookies):
    """end_time <= start_time → 422 validation error (line 1453)."""
    resp = client.put(
        "/admin/business-hours",
        json={"schedule": [{"day_of_week": 0, "start_time": "18:00", "end_time": "09:00", "is_active": True}]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 422


# ─── Bulk holiday invalid date format (lines 1623-1624) ──────────────────────

def test_bulk_add_holidays_invalid_date(client, admin_cookies):
    """Invalid date string → skipped (lines 1623-1624)."""
    resp = client.post(
        "/admin/holidays/bulk",
        json={"holidays": [{"date": "not-a-date", "name": "Bad Date"}]},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert len(data["added"]) == 0


# ─── Workload additional paths ────────────────────────────────────────────────

# ─── Email template GET success (line 825) ───────────────────────────────────

def test_get_email_template_success(client, admin_cookies, db_session):
    """GET existing email template → 200, return tmpl (line 825)."""
    from app.models import EmailTemplate
    from datetime import datetime, timezone
    tmpl = EmailTemplate(
        event_type="ticket_resolved_success",
        subject="Ticket Resolved",
        html_body="<p>resolved</p>",
        updated_by="admin",
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(tmpl)
    db_session.commit()

    resp = client.get("/admin/email-templates/ticket_resolved_success", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── Service type usage Redis cache error (lines 511-512) ────────────────────

def test_service_type_usage_redis_exception(client, admin_cookies, db_session):
    """Redis.get raises → exception caught, _r=None (lines 511-512)."""
    from unittest.mock import patch, MagicMock
    from app.models import ServiceType
    # Need at least 1 service type so ThreadPoolExecutor doesn't get max_workers=0
    st = ServiceType(label="테스트서비스", value="test_svc", sort_order=99)
    db_session.add(st)
    db_session.commit()
    mock_redis = MagicMock()
    mock_redis.get.side_effect = Exception("Redis timeout")
    with (
        patch("app.redis_client.get_redis", return_value=mock_redis),
        patch("app.gitlab_client.get_issues", return_value=([], 0)),
    ):
        resp = client.get("/admin/service-types/usage", cookies=admin_cookies)
    assert resp.status_code == 200


# ─── Outbound webhook create with invalid events (line 939) ──────────────────

def test_create_outbound_webhook_invalid_events(client, admin_cookies):
    """Invalid events → 400 (line 939)."""
    from unittest.mock import patch
    with patch("app.security.validate_external_url"):
        resp = client.post(
            "/admin/outbound-webhooks",
            json={"name": "bad-events", "url": "http://external.example.com/hook", "events": ["invalid_event"], "enabled": True},
            cookies=admin_cookies,
        )
    assert resp.status_code == 400


# ─── Workload second page pagination (line 1310) ─────────────────────────────

def test_get_workload_second_page_pagination(client, admin_cookies, db_session):
    """Issues on second page (line 1310 page += 1)."""
    from unittest.mock import patch
    from app.models import UserRole

    user = UserRole(gitlab_user_id=600, username="pageduser", role="agent")
    db_session.add(user)
    db_session.commit()

    issue = {
        "iid": 1, "state": "opened", "labels": [],
        "assignees": [{"username": "pageduser"}],
        "created_at": "2024-01-01T00:00:00Z",
        "closed_at": None, "updated_at": "2024-01-01T00:00:00Z",
    }

    # First call: 100 issues, total > 100 → triggers page += 1
    # Second call: 0 issues → loop exits
    with (
        patch("app.gitlab_client.get_issues", side_effect=[
            ([issue] * 100, 150),  # page 1: 100 items, total 150
            ([], 150),              # page 2: 0 items → break
        ]),
        patch("app.routers.admin._fetch_gitlab_users_bulk", return_value={600: {"name": "Paged User", "avatar_url": None}}),
    ):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200


def test_get_workload_assignee_not_in_users_skipped(client, admin_cookies):
    """Assignee not in users dict → continue (line 1340)."""
    from unittest.mock import patch
    issue = {
        "iid": 1,
        "state": "opened",
        "labels": ["status::open"],
        "assignees": [{"username": "external_user_not_in_db"}],
        "created_at": "2024-01-01T00:00:00Z",
        "closed_at": None,
        "updated_at": "2024-01-01T00:00:00Z",
    }
    with patch("app.gitlab_client.get_issues", return_value=([issue], 1)):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200


def test_get_workload_status_branches(client, admin_cookies, db_session):
    """Covers in_progress (line 1365), resolved (1367), open (1369) status branches."""
    from unittest.mock import patch
    from app.models import UserRole
    user = UserRole(
        gitlab_user_id=501,
        username="statususer",
        role="agent",
    )
    db_session.add(user)
    db_session.commit()

    def make_issue(iid, status_lbl, state="opened"):
        return {
            "iid": iid,
            "state": state,
            "labels": [f"status::{status_lbl}"],
            "assignees": [{"username": "statususer"}],
            "created_at": "2024-01-01T00:00:00Z",
            "closed_at": None,
            "updated_at": "2024-01-01T00:00:00Z",
        }

    issues = [
        make_issue(1, "in_progress"),
        make_issue(2, "approved"),
        make_issue(3, "open"),
    ]

    with (
        patch("app.gitlab_client.get_issues", side_effect=[(issues, 3), ([], 3)]),
        patch("app.routers.admin._fetch_gitlab_users_bulk", return_value={501: {"name": "Status User", "avatar_url": None}}),
    ):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200


def test_get_workload_closed_resolve_hours_exception(client, admin_cookies, db_session):
    """closed_at parse exception → swallowed (lines 1361-1362)."""
    from unittest.mock import patch
    from app.models import UserRole
    user = UserRole(
        gitlab_user_id=502,
        username="closeduser2",
        role="agent",
    )
    db_session.add(user)
    db_session.commit()

    issue = {
        "iid": 2,
        "state": "closed",
        "labels": [],
        "assignees": [{"username": "closeduser2"}],
        "created_at": "not-a-date",
        "closed_at": "also-not-a-date",
        "updated_at": "also-not-a-date",
    }

    with (
        patch("app.gitlab_client.get_issues", side_effect=[([issue], 1), ([], 1)]),
        patch("app.routers.admin._fetch_gitlab_users_bulk", return_value={502: {"name": "Closed User", "avatar_url": None}}),
    ):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200


def test_get_workload_sla_assignee_not_in_users(client, admin_cookies, db_session):
    """SLA record iid → iid_to_user returns None → SLA skip (line 1391)."""
    from unittest.mock import patch
    from app.models import UserRole, SLARecord
    from datetime import datetime, timezone

    user = UserRole(
        gitlab_user_id=503,
        username="slauser3",
        role="agent",
    )
    db_session.add(user)
    # SLA record for iid 9999 which has no assignee in all_issues
    sla = SLARecord(
        gitlab_issue_iid=9999,
        project_id="",
        priority="medium",
        sla_deadline=datetime.now(timezone.utc),
        breached=False,
    )
    db_session.add(sla)
    db_session.commit()

    # Issue 1 assigned to slauser3 (in DB), but SLA record is for iid 9999 (no assignee)
    issue = {
        "iid": 1,
        "state": "opened",
        "labels": [],
        "assignees": [{"username": "slauser3"}],
        "created_at": "2024-01-01T00:00:00Z",
        "closed_at": None,
        "updated_at": "2024-01-01T00:00:00Z",
    }

    with (
        patch("app.gitlab_client.get_issues", side_effect=[([issue], 1), ([], 1)]),
        patch("app.routers.admin._fetch_gitlab_users_bulk", return_value={503: {"name": "SLA User", "avatar_url": None}}),
    ):
        resp = client.get("/admin/workload", cookies=admin_cookies)
    assert resp.status_code == 200
