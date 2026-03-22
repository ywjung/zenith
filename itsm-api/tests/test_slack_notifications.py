"""Tests for Slack webhook notification integration."""
import json
from unittest.mock import MagicMock, patch


# ── send_slack unit tests ─────────────────────────────────────────────────────

def test_send_slack_disabled_skips_http():
    """SLACK_ENABLED=False 이면 HTTP 요청을 보내지 않는다."""
    from app.notifications import send_slack

    with (
        patch("app.notifications.get_settings") as mock_settings,
        patch("app.notifications._get_channel_enabled", return_value=False),
        patch("urllib.request.urlopen") as mock_urlopen,
    ):
        send_slack("테스트 메시지")

    mock_urlopen.assert_not_called()


def test_send_slack_no_webhook_url_skips_http():
    """SLACK_WEBHOOK_URL이 비어 있으면 HTTP 요청을 보내지 않는다."""
    from app.notifications import send_slack

    mock_cfg = MagicMock()
    mock_cfg.SLACK_ENABLED = True
    mock_cfg.SLACK_WEBHOOK_URL = ""
    mock_cfg.SLACK_CHANNEL = ""

    with (
        patch("app.notifications.get_settings", return_value=mock_cfg),
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("urllib.request.urlopen") as mock_urlopen,
    ):
        send_slack("테스트 메시지")

    mock_urlopen.assert_not_called()


def test_send_slack_sends_correct_payload():
    """활성화 + URL 설정 시 올바른 JSON 페이로드를 POST한다."""
    from app.notifications import send_slack

    mock_cfg = MagicMock()
    mock_cfg.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST"
    mock_cfg.SLACK_CHANNEL = "#itsm-alerts"

    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.__enter__ = lambda s: s
    mock_response.__exit__ = MagicMock(return_value=False)

    captured_requests: list = []

    def fake_urlopen(req, timeout=10):
        captured_requests.append(req)
        return mock_response

    with (
        patch("app.notifications.get_settings", return_value=mock_cfg),
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("urllib.request.urlopen", side_effect=fake_urlopen),
    ):
        send_slack("새 티켓 등록 알림", channel="#ops")

    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert req.get_full_url() == "https://hooks.slack.com/services/TEST"
    payload = json.loads(req.data.decode())
    assert payload["text"] == "새 티켓 등록 알림"
    assert payload["channel"] == "#ops"


def test_send_slack_uses_default_channel_when_none():
    """channel 인수 없으면 설정의 SLACK_CHANNEL을 사용한다."""
    from app.notifications import send_slack

    mock_cfg = MagicMock()
    mock_cfg.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST"
    mock_cfg.SLACK_CHANNEL = "#default-ch"

    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.__enter__ = lambda s: s
    mock_response.__exit__ = MagicMock(return_value=False)

    captured: list = []

    def fake_urlopen(req, timeout=10):
        captured.append(req)
        return mock_response

    with (
        patch("app.notifications.get_settings", return_value=mock_cfg),
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("urllib.request.urlopen", side_effect=fake_urlopen),
    ):
        send_slack("메시지")

    payload = json.loads(captured[0].data.decode())
    assert payload.get("channel") == "#default-ch"


def test_send_slack_no_channel_in_payload_when_empty():
    """SLACK_CHANNEL이 비어 있고 channel 인수도 없으면 'channel' 키가 없어야 한다."""
    from app.notifications import send_slack

    mock_cfg = MagicMock()
    mock_cfg.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST"
    mock_cfg.SLACK_CHANNEL = ""

    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.__enter__ = lambda s: s
    mock_response.__exit__ = MagicMock(return_value=False)

    captured: list = []

    def fake_urlopen(req, timeout=10):
        captured.append(req)
        return mock_response

    with (
        patch("app.notifications.get_settings", return_value=mock_cfg),
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("urllib.request.urlopen", side_effect=fake_urlopen),
    ):
        send_slack("메시지")

    payload = json.loads(captured[0].data.decode())
    assert "channel" not in payload


def test_send_slack_swallows_http_exception():
    """urlopen이 예외를 던져도 호출자에게 전파되지 않는다."""
    from app.notifications import send_slack

    mock_cfg = MagicMock()
    mock_cfg.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST"
    mock_cfg.SLACK_CHANNEL = ""

    with (
        patch("app.notifications.get_settings", return_value=mock_cfg),
        patch("app.notifications._get_channel_enabled", return_value=True),
        patch("urllib.request.urlopen", side_effect=OSError("connection refused")),
    ):
        # 예외 전파 없이 조용히 처리돼야 한다
        send_slack("메시지")


# ── notify_ticket_created / notify_status_changed ────────────────────────────

def test_notify_ticket_created_calls_send_slack():
    """티켓 생성 알림 시 send_slack이 호출된다."""
    from app.notifications import notify_ticket_created

    ticket = {
        "iid": 42,
        "title": "프린터 오류",
        "employee_name": "홍길동",
        "priority": "high",
        "category": "hardware",
        "description": "1층 프린터 급지 오류",
        "assignee_email": "agent@example.com",
    }

    with (
        patch("app.notifications.send_email"),
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack") as mock_slack,
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications.get_settings") as mock_settings,
    ):
        cfg = MagicMock()
        cfg.IT_TEAM_EMAIL = "it@example.com"
        cfg.FRONTEND_URL = "http://localhost"
        mock_settings.return_value = cfg
        notify_ticket_created(ticket)

    mock_slack.assert_called_once()
    msg = mock_slack.call_args[0][0]
    assert "42" in msg
    assert "프린터 오류" in msg


def test_notify_status_changed_calls_send_slack():
    """상태 변경 알림 시 send_slack이 호출된다."""
    from app.notifications import notify_status_changed

    ticket = {
        "iid": 7,
        "title": "네트워크 연결 불가",
        "project_id": "1",
        "employee_email": "user@example.com",
    }

    with (
        patch("app.notifications.send_email"),
        patch("app.notifications.send_telegram"),
        patch("app.notifications.send_slack") as mock_slack,
        patch("app.notifications._render_email_template", return_value=None),
        patch("app.notifications._get_watcher_emails", return_value=[]),
        patch("app.notifications.get_settings") as mock_settings,
    ):
        cfg = MagicMock()
        cfg.IT_TEAM_EMAIL = ""
        cfg.FRONTEND_URL = "http://localhost"
        mock_settings.return_value = cfg
        notify_status_changed(ticket, "open", "in_progress", "김담당")

    mock_slack.assert_called_once()
    msg = mock_slack.call_args[0][0]
    assert "7" in msg
