"""Targeted coverage tests for app/sla.py missing lines:
  279-280: evaluate_automation_rules exception swallowed in check_and_flag_breaches
  355-356: evaluate_automation_rules exception swallowed in check_and_send_warnings
  371-429: check_and_send_warnings_30min — entire 30-minute warning function
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
import pytest

from app.models import SLARecord, UserRole


def _past(minutes=90):
    """Return a naive UTC datetime in the past."""
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).replace(tzinfo=None)


def _future(minutes=45):
    """Return a naive UTC datetime in the future."""
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(tzinfo=None)


def _make_sla_record(db, iid, project_id="1", priority="high",
                     deadline_offset_minutes=-90, breached=False,
                     resolved_at=None, warning_sent=False, warning_sent_30min=False,
                     paused_at=None):
    """Create an SLARecord for tests."""
    if deadline_offset_minutes < 0:
        deadline = _past(abs(deadline_offset_minutes))
    else:
        deadline = _future(deadline_offset_minutes)

    record = SLARecord(
        gitlab_issue_iid=iid,
        project_id=project_id,
        priority=priority,
        sla_deadline=deadline,
        breached=breached,
        resolved_at=resolved_at,
        warning_sent=warning_sent,
        warning_sent_30min=warning_sent_30min,
        paused_at=paused_at,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# Lines 279-280 — automation rule exception swallowed in check_and_flag_breaches
# ---------------------------------------------------------------------------

class TestCheckSLABreachesAutomationException:
    def test_automation_exception_is_swallowed(self, db_session):
        """Lines 279-280: evaluate_automation_rules exception is caught and logged."""
        _make_sla_record(db_session, iid=1001, deadline_offset_minutes=-90)

        # The local imports inside sla.py mean we patch at source module level
        with patch("app.tasks.send_sla_breach") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=Exception("automation error")), \
             patch("app.notifications.notify_sla_breach"), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("celery not available")

            from app.sla import check_and_flag_breaches
            result = check_and_flag_breaches(db_session)

        # Should not raise; exception is swallowed
        assert any(r.gitlab_issue_iid == 1001 for r in result)

    def test_automation_rules_called_on_breach(self, db_session):
        """Lines 272-278: evaluate_automation_rules is called with correct event on breach."""
        _make_sla_record(db_session, iid=1002, priority="critical",
                         deadline_offset_minutes=-90)

        call_log = []

        def fake_eval(db, event, ctx):
            call_log.append((event, ctx))

        with patch("app.tasks.send_sla_breach") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=fake_eval), \
             patch("app.notifications.notify_sla_breach"):

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_flag_breaches
            check_and_flag_breaches(db_session)

        assert any(e == "ticket.sla_breached" for e, _ in call_log)
        assert any(c["iid"] == 1002 for _, c in call_log)

    def test_automation_exception_logged_warning(self, db_session):
        """Lines 279-280: Warning is logged when automation rule eval fails."""
        _make_sla_record(db_session, iid=1003, deadline_offset_minutes=-90)

        with patch("app.tasks.send_sla_breach") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=Exception("eval error")), \
             patch("app.notifications.notify_sla_breach"), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_flag_breaches
            check_and_flag_breaches(db_session)

        warning_msgs = [str(c) for c in mock_logger.warning.call_args_list]
        assert any("Automation" in m or "automation" in m for m in warning_msgs)


# ---------------------------------------------------------------------------
# Lines 355-356 — automation rule exception in check_and_send_warnings
# ---------------------------------------------------------------------------

class TestCheckAndSendWarningsAutomationException:
    def test_automation_exception_is_swallowed_in_warnings(self, db_session):
        """Lines 355-356: evaluate_automation_rules exception is caught in warnings."""
        _make_sla_record(
            db_session,
            iid=2001,
            deadline_offset_minutes=45,
            warning_sent=False,
        )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=Exception("automation error")), \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification"), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings
            result = check_and_send_warnings(db_session, warning_minutes=60)

        assert any(r.gitlab_issue_iid == 2001 for r in result)

    def test_automation_rules_called_on_warning(self, db_session):
        """Lines 347-354: evaluate_automation_rules called with ticket.sla_warning event."""
        _make_sla_record(
            db_session,
            iid=2002,
            priority="high",
            deadline_offset_minutes=45,
            warning_sent=False,
        )

        call_log = []

        def fake_eval(db, event, ctx):
            call_log.append((event, ctx))

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=fake_eval), \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification"):

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings
            check_and_send_warnings(db_session, warning_minutes=60)

        assert any(e == "ticket.sla_warning" for e, _ in call_log)
        assert any(c["iid"] == 2002 for _, c in call_log)

    def test_automation_warning_exception_logged(self, db_session):
        """Lines 355-356: Warning logged when automation eval fails during warning check."""
        _make_sla_record(
            db_session,
            iid=2003,
            deadline_offset_minutes=45,
            warning_sent=False,
        )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.routers.automation.evaluate_automation_rules",
                   side_effect=Exception("eval error")), \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification"), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings
            check_and_send_warnings(db_session, warning_minutes=60)

        warning_msgs = [str(c) for c in mock_logger.warning.call_args_list]
        assert any("Automation" in m or "automation" in m for m in warning_msgs)


# ---------------------------------------------------------------------------
# Lines 371-429 — check_and_send_warnings_30min
# ---------------------------------------------------------------------------

class TestCheckAndSendWarnings30Min:
    def test_returns_empty_when_no_at_risk_records(self, db_session):
        """check_and_send_warnings_30min returns empty list when no records qualify."""
        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert result == []

    def test_sends_30min_warning_for_qualifying_record(self, db_session):
        """Lines 390-427: 30min warning is sent for records within 30 min of deadline."""
        record = _make_sla_record(
            db_session,
            iid=3001,
            deadline_offset_minutes=20,  # within 30 min window
            warning_sent_30min=False,
        )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning") as mock_notify, \
             patch("app.notifications.create_db_notification"):

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        assert len(result) == 1
        assert result[0].gitlab_issue_iid == 3001
        # warning_sent_30min should be set to True
        db_session.refresh(record)
        assert record.warning_sent_30min is True

    def test_skips_already_warned_records(self, db_session):
        """Records with warning_sent_30min=True are skipped."""
        _make_sla_record(
            db_session,
            iid=3002,
            deadline_offset_minutes=20,
            warning_sent_30min=True,  # already warned
        )

        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert not any(r.gitlab_issue_iid == 3002 for r in result)

    def test_skips_breached_records(self, db_session):
        """Records already breached are not warned."""
        _make_sla_record(
            db_session,
            iid=3003,
            deadline_offset_minutes=20,
            breached=True,
            warning_sent_30min=False,
        )

        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert not any(r.gitlab_issue_iid == 3003 for r in result)

    def test_skips_resolved_records(self, db_session):
        """Records already resolved are not warned."""
        _make_sla_record(
            db_session,
            iid=3004,
            deadline_offset_minutes=20,
            resolved_at=datetime.now(timezone.utc).replace(tzinfo=None),
            warning_sent_30min=False,
        )

        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert not any(r.gitlab_issue_iid == 3004 for r in result)

    def test_skips_paused_records(self, db_session):
        """Records with paused_at set are not warned."""
        _make_sla_record(
            db_session,
            iid=3005,
            deadline_offset_minutes=20,
            paused_at=datetime.now(timezone.utc).replace(tzinfo=None),
            warning_sent_30min=False,
        )

        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert not any(r.gitlab_issue_iid == 3005 for r in result)

    def test_skips_records_outside_30min_window(self, db_session):
        """Records with deadline > 30 minutes away are not warned."""
        _make_sla_record(
            db_session,
            iid=3006,
            deadline_offset_minutes=60,  # 60 min away, outside 30 min window
            warning_sent_30min=False,
        )

        from app.sla import check_and_send_warnings_30min
        result = check_and_send_warnings_30min(db_session)
        assert not any(r.gitlab_issue_iid == 3006 for r in result)

    def test_celery_fallback_to_notify(self, db_session):
        """Lines 399-404: Falls back to notify_sla_warning when Celery is unavailable."""
        _make_sla_record(
            db_session,
            iid=3007,
            deadline_offset_minutes=15,
            warning_sent_30min=False,
        )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning") as mock_notify, \
             patch("app.notifications.create_db_notification"):

            mock_task.delay.side_effect = Exception("celery not available")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        assert len(result) == 1
        mock_notify.assert_called_once()
        call_args = mock_notify.call_args[0]
        assert call_args[0] == 3007

    def test_in_app_notifications_sent_to_staff(self, db_session):
        """Lines 408-420: In-app notifications sent to all admins and agents."""
        _make_sla_record(
            db_session,
            iid=3008,
            deadline_offset_minutes=25,
            warning_sent_30min=False,
        )

        # Create staff members
        admin = UserRole(gitlab_user_id=901, username="admin1", name="Admin", role="admin")
        agent = UserRole(gitlab_user_id=902, username="agent1", name="Agent", role="agent")
        db_session.add_all([admin, agent])
        db_session.commit()

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification") as mock_notif:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        # create_db_notification called for each staff member
        assert mock_notif.call_count >= 1

    def test_in_app_notification_exception_is_swallowed(self, db_session):
        """Lines 421-422: Exception in in-app notification is swallowed."""
        _make_sla_record(
            db_session,
            iid=3009,
            deadline_offset_minutes=20,
            warning_sent_30min=False,
        )
        # Add staff so that create_db_notification is actually called
        staff_member = UserRole(gitlab_user_id=950, username="admin_exc",
                                name="Admin", role="admin")
        db_session.add(staff_member)
        db_session.commit()

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification",
                   side_effect=Exception("DB error")), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        # Should not raise; exception at lines 421-422 is swallowed
        assert any(r.gitlab_issue_iid == 3009 for r in result)
        # Warning should have been logged
        warning_msgs = [str(c) for c in mock_logger.warning.call_args_list]
        assert any("30min" in m or "notification" in m.lower() for m in warning_msgs)

    def test_warning_exception_is_swallowed(self, db_session):
        """Lines 405-406: Exception in send_sla_warning fallback is swallowed."""
        _make_sla_record(
            db_session,
            iid=3010,
            deadline_offset_minutes=20,
            warning_sent_30min=False,
        )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning",
                   side_effect=Exception("notify error")), \
             patch("app.notifications.create_db_notification"), \
             patch("app.sla.logger") as mock_logger:

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        # Exception in warning should be swallowed, record still processed
        assert any(r.gitlab_issue_iid == 3010 for r in result)

    def test_multiple_records_processed(self, db_session):
        """check_and_send_warnings_30min processes multiple qualifying records."""
        for iid in [3020, 3021, 3022]:
            _make_sla_record(
                db_session,
                iid=iid,
                deadline_offset_minutes=10 + (iid - 3020) * 5,  # 10, 15, 20 min
                warning_sent_30min=False,
            )

        with patch("app.tasks.send_sla_warning") as mock_task, \
             patch("app.notifications.notify_sla_warning"), \
             patch("app.notifications.create_db_notification"):

            mock_task.delay.side_effect = Exception("no celery")

            from app.sla import check_and_send_warnings_30min
            result = check_and_send_warnings_30min(db_session)

        iids = [r.gitlab_issue_iid for r in result]
        assert 3020 in iids
        assert 3021 in iids
        assert 3022 in iids
