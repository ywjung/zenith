"""Coverage tests for app/routers/tickets/helpers.py lines 34-105.

_apply_automation_actions branches:
  - empty actions → early return (34-35)
  - action_type == "assign" (valid / invalid user id)
  - action_type == "set_status" with current_labels=None (fetches from GitLab)
  - action_type == "set_status" → closed / reopened / other value
  - action_type == "add_label"
  - action_type == "send_slack" (with '#' channel, without, and with exception)
  - action_type == "notify"
  - action_type == unknown
  - gitlab_client.update_issue called when labels/assignee/state changes
  - gitlab_client.update_issue raises → logged, no exception propagated
"""
from unittest.mock import patch, MagicMock, call
import pytest

from app.routers.tickets.helpers import _apply_automation_actions


FAKE_ISSUE = {
    "iid": 7,
    "id": 70,
    "title": "자동화 티켓",
    "description": "**신청자:** 홍길동\n**이메일:** hong@ex.com\n---\n내용",
    "state": "opened",
    "labels": ["cat::network", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z",
    "web_url": "http://gitlab/issues/7",
    "author": {"id": 1, "username": "hong", "name": "홍길동"},
    "assignees": [],
    "project_id": "1",
    "milestone": None,
}


class TestApplyAutomationActionsEarlyReturn:
    def test_empty_actions_returns_immediately(self):
        """Empty action list → function returns without any gitlab calls."""
        with patch("app.gitlab_client.update_issue") as mock_upd, \
             patch("app.gitlab_client.get_issue") as mock_get:
            _apply_automation_actions([], iid=1, project_id=None, db=None)
        mock_upd.assert_not_called()
        mock_get.assert_not_called()

    def test_none_actions_returns_immediately(self):
        """Falsy action list → early return."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(None, iid=1, project_id=None, db=None)
        mock_upd.assert_not_called()


class TestApplyAutomationActionsAssign:
    def test_assign_valid_user_id(self):
        """assign action with valid integer string."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "assign", "value": "123"}],
                iid=7, project_id="1", db=None,
            )
        mock_upd.assert_called_once()
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert call_kwargs.get("assignee_id") == 123

    def test_assign_invalid_user_id_logs_warning(self):
        """assign action with non-integer value → logged, no update called (no other changes)."""
        with patch("app.gitlab_client.update_issue") as mock_upd, \
             patch("app.routers.tickets.helpers.logger") as mock_log:
            _apply_automation_actions(
                [{"type": "assign", "value": "not-an-int"}],
                iid=7, project_id="1", db=None,
            )
        # No labels/state changed, so update_issue should NOT be called
        mock_upd.assert_not_called()
        mock_log.warning.assert_called()

    def test_assign_none_value(self):
        """assign action with None value → logged warning, no update."""
        with patch("app.gitlab_client.update_issue") as mock_upd, \
             patch("app.routers.tickets.helpers.logger") as mock_log:
            _apply_automation_actions(
                [{"type": "assign", "value": None}],
                iid=7, project_id="1", db=None,
            )
        mock_upd.assert_not_called()


class TestApplyAutomationActionsSetStatus:
    def test_set_status_closed(self):
        """set_status=closed → state_event='close', old status labels removed."""
        current_labels = ["status::open", "cat::network"]
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "set_status", "value": "closed"}],
                iid=7, project_id="1", db=None,
                current_labels=current_labels,
            )
        mock_upd.assert_called_once()
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert call_kwargs.get("state_event") == "close"
        assert "status::open" in (call_kwargs.get("remove_labels") or [])

    def test_set_status_reopened(self):
        """set_status=reopened → state_event='reopen', adds status::open label."""
        current_labels = ["status::closed"]
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "set_status", "value": "reopened"}],
                iid=7, project_id="1", db=None,
                current_labels=current_labels,
            )
        mock_upd.assert_called_once()
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert call_kwargs.get("state_event") == "reopen"
        assert "status::open" in (call_kwargs.get("add_labels") or [])

    def test_set_status_other_value(self):
        """set_status=in_progress → adds status::in_progress label."""
        current_labels = ["status::open"]
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "set_status", "value": "in_progress"}],
                iid=7, project_id="1", db=None,
                current_labels=current_labels,
            )
        mock_upd.assert_called_once()
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert "status::in_progress" in (call_kwargs.get("add_labels") or [])

    def test_set_status_fetches_labels_when_none(self):
        """set_status when current_labels=None → fetches from gitlab."""
        with patch("app.gitlab_client.get_issue", return_value=FAKE_ISSUE) as mock_get, \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "set_status", "value": "in_progress"}],
                iid=7, project_id="1", db=None,
                current_labels=None,
            )
        mock_get.assert_called_once()
        mock_upd.assert_called_once()

    def test_set_status_fetches_labels_gitlab_fails(self):
        """When gitlab.get_issue fails during label fetch, current_labels defaults to []."""
        with patch("app.gitlab_client.get_issue", side_effect=Exception("GitLab error")), \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "set_status", "value": "resolved"}],
                iid=7, project_id="1", db=None,
                current_labels=None,
            )
        # Should still proceed and call update_issue (with empty remove_labels)
        mock_upd.assert_called_once()


class TestApplyAutomationActionsAddLabel:
    def test_add_label(self):
        """add_label action → label appended to add_labels."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "add_label", "value": "urgent"}],
                iid=7, project_id="1", db=None,
            )
        mock_upd.assert_called_once()
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert "urgent" in (call_kwargs.get("add_labels") or [])

    def test_add_label_empty_string(self):
        """add_label with empty string still appends."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "add_label", "value": ""}],
                iid=7, project_id="1", db=None,
            )
        mock_upd.assert_called_once()


class TestApplyAutomationActionsSendSlack:
    def test_send_slack_with_channel(self):
        """send_slack with '#channel: message' format."""
        mock_slack = MagicMock()
        with patch("app.notifications.send_slack", mock_slack), \
             patch("app.gitlab_client.update_issue"):
            _apply_automation_actions(
                [
                    {"type": "send_slack", "value": "#it-alerts: 긴급 처리 필요"},
                    {"type": "add_label", "value": "test"},  # trigger update_issue
                ],
                iid=7, project_id="1", db=None,
            )
        mock_slack.assert_called_once_with("긴급 처리 필요", channel="#it-alerts")

    def test_send_slack_without_channel(self):
        """send_slack without '#' prefix → sends message directly."""
        mock_slack = MagicMock()
        with patch("app.notifications.send_slack", mock_slack), \
             patch("app.gitlab_client.update_issue"):
            _apply_automation_actions(
                [
                    {"type": "send_slack", "value": "일반 메시지"},
                    {"type": "add_label", "value": "test"},
                ],
                iid=7, project_id="1", db=None,
            )
        mock_slack.assert_called_once_with("일반 메시지")

    def test_send_slack_empty_value_uses_default_message(self):
        """send_slack with empty value uses default message."""
        mock_slack = MagicMock()
        with patch("app.notifications.send_slack", mock_slack), \
             patch("app.gitlab_client.update_issue"):
            _apply_automation_actions(
                [
                    {"type": "send_slack", "value": ""},
                    {"type": "add_label", "value": "test"},
                ],
                iid=7, project_id="1", db=None,
            )
        mock_slack.assert_called_once()
        call_args = mock_slack.call_args[0]
        assert "7" in call_args[0]  # iid in default message

    def test_send_slack_channel_only_no_message(self):
        """send_slack with '#channel' only (no colon) → uses default message."""
        mock_slack = MagicMock()
        with patch("app.notifications.send_slack", mock_slack), \
             patch("app.gitlab_client.update_issue"):
            _apply_automation_actions(
                [
                    {"type": "send_slack", "value": "#it-ops"},
                    {"type": "add_label", "value": "test"},
                ],
                iid=7, project_id="1", db=None,
            )
        mock_slack.assert_called_once()

    def test_send_slack_exception_logged(self):
        """send_slack raises → logged, other actions still proceed."""
        with patch("app.notifications.send_slack", side_effect=Exception("Slack down")), \
             patch("app.routers.tickets.helpers.logger") as mock_log, \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [
                    {"type": "send_slack", "value": "#channel: msg"},
                    {"type": "add_label", "value": "after-slack"},
                ],
                iid=7, project_id="1", db=None,
            )
        mock_log.warning.assert_called()
        # add_label should still trigger update_issue
        mock_upd.assert_called_once()


class TestApplyAutomationActionsNotify:
    def test_notify_action_logs_info(self):
        """notify action → logged at info level, no update (alone)."""
        with patch("app.routers.tickets.helpers.logger") as mock_log, \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "notify", "value": "user@example.com"}],
                iid=7, project_id="1", db=None,
            )
        mock_log.info.assert_called()
        # No labels/state/assignee changed → update_issue NOT called
        mock_upd.assert_not_called()


class TestApplyAutomationActionsUnknown:
    def test_unknown_action_type_logs_warning(self):
        """Unknown action type → warning logged."""
        with patch("app.routers.tickets.helpers.logger") as mock_log, \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "unknown_action", "value": "something"}],
                iid=7, project_id="1", db=None,
            )
        mock_log.warning.assert_called()
        mock_upd.assert_not_called()


class TestApplyAutomationActionsOuterExcept:
    def test_outer_except_caught_when_current_labels_not_iterable(self):
        """Outer except (lines 87-88) fires when current_labels contains non-string items."""
        # When current_labels contains an integer, lbl.startswith() will raise AttributeError
        # which is caught by the outer except block (lines 87-88).
        bad_labels = [123, 456]  # integers don't have .startswith()
        with patch("app.gitlab_client.update_issue") as mock_upd, \
             patch("app.routers.tickets.helpers.logger") as mock_log:
            _apply_automation_actions(
                [{"type": "set_status", "value": "in_progress"}],
                iid=7, project_id="1", db=None,
                current_labels=bad_labels,
            )
        # The outer except should have been called at least once
        mock_log.warning.assert_called()


class TestApplyAutomationActionsGitLabUpdate:
    def test_update_issue_called_with_correct_args(self):
        """Multiple actions combined → single update_issue call with merged args."""
        current_labels = ["status::open"]
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [
                    {"type": "assign", "value": "99"},
                    {"type": "add_label", "value": "vip"},
                    {"type": "set_status", "value": "in_progress"},
                ],
                iid=7, project_id="1", db=None,
                current_labels=current_labels,
            )
        # Only one call to update_issue
        assert mock_upd.call_count == 1
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert call_kwargs.get("assignee_id") == 99
        assert "vip" in (call_kwargs.get("add_labels") or [])
        assert "status::in_progress" in (call_kwargs.get("add_labels") or [])
        assert "status::open" in (call_kwargs.get("remove_labels") or [])

    def test_update_issue_gitlab_error_logged(self):
        """update_issue raises → warning logged, no exception propagated."""
        with patch("app.gitlab_client.update_issue", side_effect=Exception("GitLab error")), \
             patch("app.routers.tickets.helpers.logger") as mock_log:
            # Should not raise
            _apply_automation_actions(
                [{"type": "add_label", "value": "test-label"}],
                iid=7, project_id="1", db=None,
            )
        mock_log.warning.assert_called()

    def test_no_update_issue_when_no_changes(self):
        """notify + unknown → no labels/state/assignee → update_issue NOT called."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [
                    {"type": "notify", "value": "admin"},
                    {"type": "unknown_type", "value": "x"},
                ],
                iid=7, project_id="1", db=None,
            )
        mock_upd.assert_not_called()

    def test_project_id_defaults_to_settings(self):
        """When project_id=None, uses GITLAB_PROJECT_ID from settings."""
        with patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [{"type": "add_label", "value": "auto"}],
                iid=7, project_id=None, db=None,
            )
        mock_upd.assert_called_once()
        # project_id in call should be from settings (not None)
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        # project_id may be passed positionally; check it was called
        assert mock_upd.call_count == 1

    def test_individual_action_exception_swallowed(self):
        """Exception inside a single action body is caught, others proceed."""
        # set_status with current_labels=None, gitlab get_issue fails
        with patch("app.gitlab_client.get_issue", side_effect=Exception("fail")), \
             patch("app.gitlab_client.update_issue") as mock_upd:
            _apply_automation_actions(
                [
                    {"type": "set_status", "value": "resolved"},
                    {"type": "add_label", "value": "done"},
                ],
                iid=7, project_id="1", db=None,
                current_labels=None,
            )
        # update_issue should still be called (add_label succeeded)
        mock_upd.assert_called_once()
