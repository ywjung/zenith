"""Unit tests for app/notifications.py — channel, email, telegram, and notify functions."""
from unittest.mock import patch, MagicMock


FAKE_TICKET = {
    "iid": 1,
    "title": "프린터 고장",
    "description": "프린터가 작동 안 합니다",
    "employee_name": "홍길동",
    "employee_email": "hong@example.com",
    "priority": "high",
    "category": "hardware",
    "project_id": "1",
}


# ── _get_channel_enabled ───────────────────────────────────────────────────────

def test_channel_disabled_when_env_flag_false():
    from app.notifications import _get_channel_enabled
    assert _get_channel_enabled("email_enabled", env_flag=False) is False


def test_channel_from_redis_cache_false():
    from app.notifications import _get_channel_enabled
    mock_redis = MagicMock()
    mock_redis.get.return_value = "false"
    with patch("app.redis_client.get_redis", return_value=mock_redis):
        result = _get_channel_enabled("email_enabled", env_flag=True)
    assert result is False


def test_channel_from_redis_cache_true():
    from app.notifications import _get_channel_enabled
    mock_redis = MagicMock()
    mock_redis.get.return_value = "true"
    with patch("app.redis_client.get_redis", return_value=mock_redis):
        result = _get_channel_enabled("email_enabled", env_flag=True)
    assert result is True


def test_channel_falls_back_to_env_on_exception():
    from app.notifications import _get_channel_enabled
    with patch("app.redis_client.get_redis", side_effect=Exception("Redis 불가")):
        result = _get_channel_enabled("email_enabled", env_flag=True)
    assert result is True


def test_channel_db_setting_false():
    from app.notifications import _get_channel_enabled
    from app.models import SystemSetting
    mock_row = MagicMock(spec=SystemSetting)
    mock_row.value = "false"
    mock_db = MagicMock()
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)
    mock_db.query.return_value.filter.return_value.first.return_value = mock_row
    with (
        patch("app.redis_client.get_redis", return_value=None),
        patch("app.database.SessionLocal", return_value=mock_db),
    ):
        result = _get_channel_enabled("email_enabled", env_flag=True)
    assert result is False


# ── send_email ─────────────────────────────────────────────────────────────────

def test_send_email_skipped_when_disabled():
    from app.notifications import send_email
    with (
        patch("app.notifications._get_channel_enabled", return_value=False),
        patch("smtplib.SMTP") as mock_smtp,
    ):
        send_email("test@example.com", "제목", "<p>본문</p>")
    mock_smtp.assert_not_called()


def test_send_email_skipped_no_smtp_host():
    from app.notifications import send_email
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("smtplib.SMTP") as mock_smtp,
    ):
        mock_cfg.return_value.SMTP_HOST = ""
        mock_cfg.return_value.NOTIFICATION_ENABLED = True
        send_email("test@example.com", "제목", "<p>본문</p>")
    mock_smtp.assert_not_called()


def test_send_email_retries_on_failure_and_logs():
    from app.notifications import send_email
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("smtplib.SMTP", side_effect=Exception("연결 실패")),
        patch("time.sleep"),
    ):
        mock_cfg.return_value.SMTP_HOST = "smtp.example.com"
        mock_cfg.return_value.SMTP_PORT = 587
        mock_cfg.return_value.SMTP_TLS = False
        mock_cfg.return_value.SMTP_USER = ""
        mock_cfg.return_value.SMTP_PASSWORD = ""
        mock_cfg.return_value.SMTP_FROM = "noreply@example.com"
        mock_cfg.return_value.NOTIFICATION_ENABLED = True
        # Should not raise despite repeated failures
        send_email("test@example.com", "제목", "<p>본문</p>")


def test_send_email_list_recipients():
    from app.notifications import send_email
    with (
        patch("app.notifications._get_channel_enabled", return_value=False),
    ):
        # Just verify it doesn't crash with list input
        send_email(["a@example.com", "b@example.com"], "제목", "<p>본문</p>")


# ── send_telegram ──────────────────────────────────────────────────────────────

def test_send_telegram_skipped_when_disabled():
    from app.notifications import send_telegram
    with (
        patch("app.notifications._get_channel_enabled", return_value=False),
        patch("urllib.request.urlopen") as mock_urlopen,
    ):
        send_telegram("테스트 메시지")
    mock_urlopen.assert_not_called()


def test_send_telegram_skipped_no_token():
    from app.notifications import send_telegram
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("urllib.request.urlopen") as mock_urlopen,
    ):
        mock_cfg.return_value.TELEGRAM_ENABLED = True
        mock_cfg.return_value.TELEGRAM_BOT_TOKEN = ""
        mock_cfg.return_value.TELEGRAM_CHAT_ID = ""
        send_telegram("테스트")
    mock_urlopen.assert_not_called()


def test_send_telegram_logs_on_error():
    from app.notifications import send_telegram
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("urllib.request.urlopen", side_effect=Exception("네트워크 오류")),
    ):
        mock_cfg.return_value.TELEGRAM_ENABLED = True
        mock_cfg.return_value.TELEGRAM_BOT_TOKEN = "bot12345:ABC"
        mock_cfg.return_value.TELEGRAM_CHAT_ID = "-1001234567"
        # Should not raise
        send_telegram("테스트 메시지")


# ── notify_ticket_created ──────────────────────────────────────────────────────

def test_notify_ticket_created_calls_send_email():
    from app.notifications import notify_ticket_created
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_ticket_created(FAKE_TICKET)
    mock_email.assert_called_once()


def test_notify_ticket_created_no_recipients_skips_all():
    from app.notifications import notify_ticket_created
    ticket = {**FAKE_TICKET}
    ticket.pop("employee_email", None)
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram") as mock_tg,
        patch("app.notifications.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = ""
        mock_cfg.return_value.FRONTEND_URL = "http://localhost"
        notify_ticket_created(ticket)
    mock_email.assert_not_called()
    # When there are no recipients, the function returns early
    mock_tg.assert_not_called()


def test_notify_ticket_created_uses_template():
    from app.notifications import notify_ticket_created
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=("DB 제목", "<p>DB 본문</p>")),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_ticket_created(FAKE_TICKET)
    call_args = mock_email.call_args[0]
    assert call_args[1] == "DB 제목"


# ── notify_status_changed ──────────────────────────────────────────────────────

def test_notify_status_changed_sends_email_and_telegram():
    from app.notifications import notify_status_changed
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram") as mock_tg,
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications._get_watcher_emails", return_value=[]),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_status_changed(FAKE_TICKET, "open", "in_progress", "관리자")
    mock_email.assert_called_once()
    mock_tg.assert_called_once()


def test_notify_status_changed_includes_watcher_emails():
    from app.notifications import notify_status_changed
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications._get_watcher_emails", return_value=["watcher@example.com"]),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_status_changed(FAKE_TICKET, "open", "closed", "admin")
    recipients = mock_email.call_args[0][0]
    assert "watcher@example.com" in recipients


def test_notify_status_changed_uses_template():
    """When _render_email_template returns a value, use it (covers line 275)."""
    from app.notifications import notify_status_changed
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=("Template 제목", "<p>본문</p>")),
        patch("app.notifications._get_watcher_emails", return_value=[]),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_status_changed(FAKE_TICKET, "open", "in_progress", "관리자")
    assert mock_email.call_args[0][1] == "Template 제목"


def test_notify_status_changed_fire_event_exception_swallowed():
    """fire_event Exception is swallowed (covers lines 297-298)."""
    from app.notifications import notify_status_changed
    with (
        patch("app.notifications.send_email"),
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications._get_watcher_emails", return_value=[]),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event", side_effect=Exception("fire failed")),
    ):
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        # Should not raise
        notify_status_changed(FAKE_TICKET, "open", "closed", "admin")


# ── notify_comment_added ───────────────────────────────────────────────────────

def test_notify_comment_added_internal_skipped():
    """is_internal=True → returns immediately (line 328)."""
    from app.notifications import notify_comment_added
    with patch("app.notifications.send_email") as mock_email:
        notify_comment_added(FAKE_TICKET, "내부 메모", "admin", is_internal=True)
    mock_email.assert_not_called()


def test_notify_comment_added_sends_to_employee():
    from app.notifications import notify_comment_added
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications._get_watcher_emails", return_value=[]),
    ):
        notify_comment_added(FAKE_TICKET, "댓글 내용", "홍길동", is_internal=False)
    mock_email.assert_called_once()
    recipients = mock_email.call_args[0][0]
    assert "hong@example.com" in recipients


def test_notify_comment_added_includes_watchers():
    """Watcher emails are included (covers lines 350-352)."""
    from app.notifications import notify_comment_added
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications._get_watcher_emails", return_value=["watch@example.com"]),
    ):
        notify_comment_added(FAKE_TICKET, "댓글", "admin", is_internal=False)
    recipients = mock_email.call_args[0][0]
    assert "watch@example.com" in recipients


def test_notify_comment_added_no_recipients():
    """No employee email + no watchers → send_email not called."""
    from app.notifications import notify_comment_added
    ticket = {**FAKE_TICKET, "employee_email": None}
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications._get_watcher_emails", return_value=[]),
    ):
        notify_comment_added(ticket, "댓글", "admin", is_internal=False)
    mock_email.assert_not_called()


# ── notify_assigned ────────────────────────────────────────────────────────────

def test_notify_assigned_sends_email():
    """notify_assigned sends email to assignee (covers lines 359-368)."""
    from app.notifications import notify_assigned
    with patch("app.notifications.send_email") as mock_email:
        notify_assigned("agent@example.com", FAKE_TICKET, "관리자")
    mock_email.assert_called_once()
    args = mock_email.call_args[0]
    assert args[0] == "agent@example.com"
    assert "#1" in args[1]  # iid in subject


# ── notify_sla_warning ────────────────────────────────────────────────────────

def test_notify_sla_warning_sends_email_and_telegram():
    """notify_sla_warning with IT_TEAM_EMAIL set (covers lines 372-386)."""
    from app.notifications import notify_sla_warning
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram") as mock_tg,
        patch("app.notifications.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        notify_sla_warning(1, "1", 30)
    mock_email.assert_called_once()
    mock_tg.assert_called_once()


def test_notify_sla_warning_no_recipients():
    """No IT_TEAM_EMAIL → returns early."""
    from app.notifications import notify_sla_warning
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = ""
        notify_sla_warning(1, "1", 30)
    mock_email.assert_not_called()


# ── notify_sla_breach ─────────────────────────────────────────────────────────

def test_notify_sla_breach_with_assignee_and_it_team():
    """notify_sla_breach with both assignee + IT_TEAM_EMAIL (covers 394-410)."""
    from app.notifications import notify_sla_breach
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram") as mock_tg,
        patch("app.notifications.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        notify_sla_breach(1, "1", "agent@example.com")
    mock_email.assert_called_once()
    recipients = mock_email.call_args[0][0]
    assert "agent@example.com" in recipients
    assert "it@example.com" in recipients


def test_notify_sla_breach_no_recipients():
    """No assignee, no IT_TEAM_EMAIL → returns early."""
    from app.notifications import notify_sla_breach
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = ""
        notify_sla_breach(1, "1", None)
    mock_email.assert_not_called()


# ── create_db_notification & push_to_redis ────────────────────────────────────

def test_create_db_notification_stores_record():
    """create_db_notification adds notification (covers 453-471)."""
    from app.notifications import create_db_notification
    from datetime import datetime, timezone

    mock_db = MagicMock()

    def fake_add(obj):
        obj.id = 1
        obj.created_at = datetime.now(timezone.utc)

    mock_db.add.side_effect = fake_add
    mock_db.flush.return_value = None
    mock_db.refresh.return_value = None

    with patch("app.notifications.push_to_redis"):
        notif = create_db_notification(mock_db, "42", "테스트 알림", body="본문", link="/tickets/1")

    mock_db.add.assert_called_once()
    mock_db.flush.assert_called_once()


def test_create_db_notification_invalid_link_rejected():
    """External link is rejected → _validate_notification_link returns None."""
    from app.notifications import create_db_notification
    from datetime import datetime, timezone

    mock_db = MagicMock()

    captured = {}

    def fake_add(obj):
        obj.id = 2
        obj.created_at = datetime.now(timezone.utc)
        captured["notif"] = obj

    mock_db.add.side_effect = fake_add
    mock_db.flush.return_value = None
    mock_db.refresh.return_value = None

    with patch("app.notifications.push_to_redis"):
        create_db_notification(mock_db, "42", "악성 링크", link="https://evil.com/steal")

    assert captured["notif"].link is None


def test_push_to_redis_publishes(db_session):
    """push_to_redis calls r.publish (covers lines 476-482)."""
    from app.notifications import push_to_redis
    mock_redis = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_redis):
        push_to_redis("42", {"id": 1, "title": "알림"})
    mock_redis.publish.assert_called_once()


def test_push_to_redis_exception_swallowed():
    """Redis error is silently swallowed."""
    from app.notifications import push_to_redis
    with patch("app.redis_client.get_redis", side_effect=Exception("Redis down")):
        push_to_redis("42", {"id": 1})  # should not raise


# ── _render_email_template success path ──────────────────────────────────────

def test_render_email_template_success():
    """When template exists in DB, renders and returns (subject, body) (covers 40-46)."""
    from app.notifications import _render_email_template
    from app.models import EmailTemplate
    mock_tmpl = MagicMock(spec=EmailTemplate)
    mock_tmpl.subject = "안녕 {{ name }}"
    mock_tmpl.html_body = "<p>{{ name }}님</p>"
    mock_db = MagicMock()
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)
    mock_db.query.return_value.filter.return_value.first.return_value = mock_tmpl
    with patch("app.database.SessionLocal", return_value=mock_db):
        result = _render_email_template("ticket_created", {"name": "홍길동"})
    assert result is not None
    subject, body = result
    assert "홍길동" in subject
    assert "홍길동" in body


# ── _get_channel_enabled — DB + Redis setex path ─────────────────────────────

def test_channel_db_setting_true_with_redis_setex():
    """DB returns 'true', Redis setex is called (covers lines 81-84)."""
    from app.notifications import _get_channel_enabled
    from app.models import SystemSetting
    mock_row = MagicMock(spec=SystemSetting)
    mock_row.value = "true"
    mock_db = MagicMock()
    mock_db.__enter__ = MagicMock(return_value=mock_db)
    mock_db.__exit__ = MagicMock(return_value=False)
    mock_db.query.return_value.filter.return_value.first.return_value = mock_row
    mock_redis = MagicMock()
    mock_redis.get.return_value = None  # cache miss
    with (
        patch("app.redis_client.get_redis", return_value=mock_redis),
        patch("app.database.SessionLocal", return_value=mock_db),
    ):
        result = _get_channel_enabled("email_enabled", env_flag=True)
    assert result is True
    mock_redis.setex.assert_called_once()


# ── send_email SMTP TLS path ──────────────────────────────────────────────────

def test_send_email_smtp_tls_with_credentials():
    """SMTP TLS with user/password (covers lines 118-124)."""
    from app.notifications import send_email
    mock_server = MagicMock()
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("smtplib.SMTP", return_value=mock_server),
        patch("ssl.create_default_context", return_value=MagicMock()),
    ):
        mock_cfg.return_value.SMTP_HOST = "smtp.example.com"
        mock_cfg.return_value.SMTP_PORT = 587
        mock_cfg.return_value.SMTP_TLS = True
        mock_cfg.return_value.SMTP_USER = "user@example.com"
        mock_cfg.return_value.SMTP_PASSWORD = "password"
        mock_cfg.return_value.SMTP_FROM = "noreply@example.com"
        mock_cfg.return_value.NOTIFICATION_ENABLED = True
        send_email("test@example.com", "제목", "<p>본문</p>")
    mock_server.login.assert_called_once()


def test_send_email_smtp_no_tls_with_credentials():
    """SMTP without TLS with user/password (covers lines 127-131)."""
    from app.notifications import send_email
    mock_server = MagicMock()
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("smtplib.SMTP", return_value=mock_server),
    ):
        mock_cfg.return_value.SMTP_HOST = "smtp.example.com"
        mock_cfg.return_value.SMTP_PORT = 25
        mock_cfg.return_value.SMTP_TLS = False
        mock_cfg.return_value.SMTP_USER = "user"
        mock_cfg.return_value.SMTP_PASSWORD = "pass"
        mock_cfg.return_value.SMTP_FROM = "noreply@example.com"
        mock_cfg.return_value.NOTIFICATION_ENABLED = True
        send_email("test@example.com", "제목", "<p>본문</p>")
    mock_server.login.assert_called_once()


# ── send_telegram 200 success path ───────────────────────────────────────────

def test_send_telegram_success_200():
    """Telegram returns 200 (covers lines 174-176)."""
    from app.notifications import send_telegram
    mock_resp = MagicMock()
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock_resp.status = 200
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("urllib.request.urlopen", return_value=mock_resp),
    ):
        mock_cfg.return_value.TELEGRAM_ENABLED = True
        mock_cfg.return_value.TELEGRAM_BOT_TOKEN = "bot123:ABC"
        mock_cfg.return_value.TELEGRAM_CHAT_ID = "-100123"
        send_telegram("성공 메시지")


def test_send_telegram_non_200_status():
    """Telegram returns non-200 status code (covers line 177)."""
    from app.notifications import send_telegram
    mock_resp = MagicMock()
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock_resp.status = 400
    with (
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("urllib.request.urlopen", return_value=mock_resp),
    ):
        mock_cfg.return_value.TELEGRAM_ENABLED = True
        mock_cfg.return_value.TELEGRAM_BOT_TOKEN = "bot123:ABC"
        mock_cfg.return_value.TELEGRAM_CHAT_ID = "-100123"
        send_telegram("실패 메시지")  # should not raise


# ── notify_ticket_created fire_event exception path ──────────────────────────

def test_notify_ticket_created_fire_event_exception_swallowed():
    """fire_event Exception is swallowed (covers lines 237-238)."""
    from app.notifications import notify_ticket_created
    with (
        patch("app.notifications.send_email"),
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event", side_effect=Exception("fire failed")),
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_ticket_created(FAKE_TICKET)  # should not raise


def test_notify_ticket_created_assignee_email_added():
    """assignee_email added when not equal to IT_TEAM_EMAIL (covers line 195)."""
    from app.notifications import notify_ticket_created
    ticket = {**FAKE_TICKET, "assignee_email": "agent@example.com"}
    with (
        patch("app.notifications.send_email") as mock_email,
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack"),
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications.get_settings") as mock_cfg,
        patch("app.outbound_webhook.fire_event"),
    ):
        mock_cfg.return_value.IT_TEAM_EMAIL = "it@example.com"
        mock_cfg.return_value.FRONTEND_URL = "http://localhost:3000"
        notify_ticket_created(ticket)
    recipients = mock_email.call_args[0][0]
    assert "agent@example.com" in recipients
