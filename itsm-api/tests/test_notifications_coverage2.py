"""Targeted coverage tests for app/notifications.py missing lines:
  213: Slack webhook non-200 status warning
  507-517: create_db_notification dedup via Redis
  563-583: notify_approval_requested
  595-617: notify_approval_decided
"""
import json
from unittest.mock import MagicMock, patch
import pytest


# ---------------------------------------------------------------------------
# Line 213 — Slack webhook returns non-200 status
# ---------------------------------------------------------------------------

def test_slack_non_200_status_logs_warning():
    """When Slack webhook returns a non-200 status code, a warning is logged."""
    mock_response = MagicMock()
    mock_response.status = 429  # rate-limited, non-200
    mock_response.__enter__ = lambda s: s
    mock_response.__exit__ = MagicMock(return_value=False)

    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._get_channel_enabled", return_value=True), \
         patch("urllib.request.urlopen", return_value=mock_response), \
         patch("app.notifications.logger") as mock_logger:

        settings = MagicMock()
        settings.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test"
        settings.SLACK_CHANNEL = None
        mock_settings.return_value = settings

        from app.notifications import send_slack
        send_slack("Test message")

        mock_logger.warning.assert_called()
        args_list = [str(c) for c in mock_logger.warning.call_args_list]
        assert any("429" in a for a in args_list)


# ---------------------------------------------------------------------------
# Lines 507-517 — create_db_notification with dedup_key
# ---------------------------------------------------------------------------

def _make_mock_db():
    """Create a mock DB session that can be used with create_db_notification."""
    from datetime import datetime, timezone

    mock_db = MagicMock()

    def fake_add(obj):
        obj.id = 1
        obj.created_at = datetime.now(timezone.utc)

    mock_db.add.side_effect = fake_add
    mock_db.flush.return_value = None
    mock_db.refresh.return_value = None
    return mock_db


def test_create_db_notification_dedup_skip():
    """When a dedup key already exists in Redis, notification creation is skipped."""
    mock_redis = MagicMock()
    mock_redis.get.return_value = b"1"  # key exists → skip

    with patch("app.redis_client.get_redis", return_value=mock_redis), \
         patch("app.notifications.push_to_redis"):
        from app.notifications import create_db_notification
        result = create_db_notification(
            db=_make_mock_db(),
            recipient_id="99",
            title="Dedup Test",
            body="Should be skipped",
            dedup_key="unique-event-key",
        )

    assert result is None
    mock_redis.get.assert_called()


def test_create_db_notification_dedup_sets_key():
    """When dedup key is new, notification is created and key is stored in Redis."""
    mock_redis = MagicMock()
    mock_redis.get.return_value = None  # key absent → proceed

    with patch("app.redis_client.get_redis", return_value=mock_redis), \
         patch("app.notifications.push_to_redis"):
        from app.notifications import create_db_notification
        result = create_db_notification(
            db=_make_mock_db(),
            recipient_id="99",
            title="Dedup Test",
            body="Should be created",
            dedup_key="new-event-key",
            dedup_ttl=30,
        )

    assert result is not None
    assert result.title == "Dedup Test"
    mock_redis.setex.assert_called_once()
    call_args = mock_redis.setex.call_args[0]
    assert call_args[1] == 30  # ttl matches


def test_create_db_notification_dedup_redis_error():
    """When Redis raises an exception during dedup check, notification proceeds."""
    mock_redis = MagicMock()
    mock_redis.get.side_effect = Exception("Redis connection error")

    with patch("app.redis_client.get_redis", return_value=mock_redis), \
         patch("app.notifications.push_to_redis"):
        from app.notifications import create_db_notification
        result = create_db_notification(
            db=_make_mock_db(),
            recipient_id="99",
            title="Redis Error Test",
            body="Should still be created",
            dedup_key="error-test-key",
        )

    # notification should still be created despite Redis error
    assert result is not None
    assert result.title == "Redis Error Test"


def test_create_db_notification_dedup_no_redis():
    """When Redis is unavailable and dedup_key provided, notification is created."""
    with patch("app.redis_client.get_redis", return_value=None), \
         patch("app.notifications.push_to_redis"):
        from app.notifications import create_db_notification
        result = create_db_notification(
            db=_make_mock_db(),
            recipient_id="99",
            title="No Redis",
            body="Proceeds without Redis",
            dedup_key="no-redis-key",
        )

    assert result is not None


# ---------------------------------------------------------------------------
# Lines 563-583 — notify_approval_requested
# ---------------------------------------------------------------------------

def test_notify_approval_requested_sends_email():
    """notify_approval_requested sends email when NOTIFICATION_ENABLED and SMTP_HOST set."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = "smtp.example.com"
        settings.FRONTEND_URL = "https://itsm.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_requested
        notify_approval_requested(
            approver_email="approver@example.com",
            approver_name="김승인",
            ticket_iid=42,
            requester_name="이요청",
        )

        mock_send.assert_called_once()
        call_args = mock_send.call_args[0]
        assert call_args[0] == "approver@example.com"
        assert "42" in call_args[1]  # ticket_iid in subject
        assert "이요청" in call_args[2]  # requester_name in body


def test_notify_approval_requested_disabled():
    """notify_approval_requested returns early when NOTIFICATION_ENABLED is False."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = False
        settings.SMTP_HOST = "smtp.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_requested
        notify_approval_requested(
            approver_email="approver@example.com",
            approver_name="김승인",
            ticket_iid=42,
            requester_name="이요청",
        )

        mock_send.assert_not_called()


def test_notify_approval_requested_no_smtp():
    """notify_approval_requested returns early when SMTP_HOST is empty."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = ""
        mock_settings.return_value = settings

        from app.notifications import notify_approval_requested
        notify_approval_requested(
            approver_email="approver@example.com",
            approver_name="김승인",
            ticket_iid=42,
            requester_name="이요청",
        )

        mock_send.assert_not_called()


def test_notify_approval_requested_email_exception_logged():
    """notify_approval_requested logs warning when _send_email raises."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email", side_effect=Exception("SMTP error")), \
         patch("app.notifications.logger") as mock_logger:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = "smtp.example.com"
        settings.FRONTEND_URL = "https://itsm.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_requested
        notify_approval_requested(
            approver_email="approver@example.com",
            approver_name="김승인",
            ticket_iid=42,
            requester_name="이요청",
        )

        mock_logger.warning.assert_called_once()


# ---------------------------------------------------------------------------
# Lines 595-617 — notify_approval_decided
# ---------------------------------------------------------------------------

def test_notify_approval_decided_approved():
    """notify_approval_decided sends email for 'approved' decision."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = "smtp.example.com"
        settings.FRONTEND_URL = "https://itsm.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_decided
        notify_approval_decided(
            requester_email="requester@example.com",
            requester_name="이요청",
            ticket_iid=99,
            decision="approved",
            decider_name="김승인",
            reason="All checks passed",
        )

        mock_send.assert_called_once()
        call_args = mock_send.call_args[0]
        assert call_args[0] == "requester@example.com"
        assert "승인" in call_args[1]
        assert "All checks passed" in call_args[2]


def test_notify_approval_decided_rejected():
    """notify_approval_decided sends email for 'rejected' decision."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = "smtp.example.com"
        settings.FRONTEND_URL = "https://itsm.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_decided
        notify_approval_decided(
            requester_email="requester@example.com",
            requester_name="이요청",
            ticket_iid=99,
            decision="rejected",
            decider_name="김반려",
            reason=None,
        )

        mock_send.assert_called_once()
        call_args = mock_send.call_args[0]
        assert "반려" in call_args[1]


def test_notify_approval_decided_disabled():
    """notify_approval_decided returns early when notifications are disabled."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email") as mock_send:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = False
        settings.SMTP_HOST = "smtp.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_decided
        notify_approval_decided(
            requester_email="requester@example.com",
            requester_name="이요청",
            ticket_iid=99,
            decision="approved",
            decider_name="김승인",
        )

        mock_send.assert_not_called()


def test_notify_approval_decided_exception_logged():
    """notify_approval_decided logs warning when _send_email raises."""
    with patch("app.notifications.get_settings") as mock_settings, \
         patch("app.notifications._send_email", side_effect=Exception("SMTP down")), \
         patch("app.notifications.logger") as mock_logger:

        settings = MagicMock()
        settings.NOTIFICATION_ENABLED = True
        settings.SMTP_HOST = "smtp.example.com"
        settings.FRONTEND_URL = "https://itsm.example.com"
        mock_settings.return_value = settings

        from app.notifications import notify_approval_decided
        notify_approval_decided(
            requester_email="requester@example.com",
            requester_name="이요청",
            ticket_iid=99,
            decision="approved",
            decider_name="김승인",
        )

        mock_logger.warning.assert_called_once()
