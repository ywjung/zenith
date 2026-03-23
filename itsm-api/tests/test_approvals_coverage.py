"""Targeted coverage tests for app/routers/approvals.py missing lines:
  128-137: create_approval_request — email notify when approver has email
  184-195: approve_request — email notify when requester has email
  243-254: reject_request — email notify when requester has email

These branches require an ORM object with an 'email' attribute (not a DB column),
so we use mock DB sessions that return mock objects with email set.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call
import pytest

from app.models import ApprovalRequest, UserRole


# ---------------------------------------------------------------------------
# Lines 128-137 — create_approval_request: email path
# ---------------------------------------------------------------------------

class TestCreateApprovalRequestEmailNotify:
    def test_email_notification_called_when_approver_has_email(self):
        """Lines 128-137: notify_approval_requested is called when approver has email attr."""
        from app.routers.approvals import create_approval_request, ApprovalCreate

        body = ApprovalCreate(
            ticket_iid=11,
            project_id="1",
            approver_username="approver_with_email",
        )
        current_user = {
            "sub": "42", "username": "req_user", "name": "요청자", "role": "user"
        }

        # Mock approver with email attribute
        mock_approver = MagicMock()
        mock_approver.gitlab_user_id = 500
        mock_approver.username = "approver_with_email"
        mock_approver.name = "이메일승인자"
        mock_approver.email = "approver@test.com"  # has email

        # Mock DB session
        mock_db = MagicMock()
        # query(ApprovalRequest).filter(...).with_for_update().first() → None (no existing)
        # query(UserRole).filter(...).first() → mock_approver
        def side_effect_query(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = None
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = mock_approver
            return q

        mock_db.query.side_effect = side_effect_query
        # db.add/commit/refresh are no-ops on mock
        added = {}
        def fake_add(obj):
            obj.id = 1
            obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = datetime.now(timezone.utc)
            obj.status = "pending"
            obj.approved_at = None
            obj.requester_name = "요청자"
            obj.approver_username = "approver_with_email"
            obj.approver_name = None
            obj.reason = None
        mock_db.add.side_effect = fake_add
        mock_db.refresh.return_value = None

        email_calls = []

        def fake_notify_requested(**kwargs):
            email_calls.append(kwargs)

        import app.gitlab_client as _real_gl

        with patch("app.notifications.notify_approval_requested",
                   side_effect=fake_notify_requested), \
             patch("app.routers.approvals.create_db_notification"), \
             patch("app.notifications.get_settings") as ms, \
             patch.object(_real_gl, "get_issue", return_value={"iid": 11}):

            ms.return_value = MagicMock(
                NOTIFICATION_ENABLED=True,
                SMTP_HOST="smtp.test",
                FRONTEND_URL="http://test",
            )

            result = create_approval_request(
                body=body,
                db=mock_db,
                current_user=current_user,
            )

        assert len(email_calls) == 1
        assert email_calls[0]["approver_email"] == "approver@test.com"
        assert email_calls[0]["ticket_iid"] == 11

    def test_no_email_when_approver_has_no_email(self):
        """Email notification is skipped when approver has no email (None)."""
        from app.routers.approvals import create_approval_request, ApprovalCreate

        body = ApprovalCreate(
            ticket_iid=12, project_id="1", approver_username="approver_noemail"
        )
        current_user = {"sub": "42", "username": "req2", "name": "req", "role": "user"}

        mock_approver = MagicMock()
        mock_approver.gitlab_user_id = 501
        mock_approver.email = None  # no email

        mock_db = MagicMock()

        def side_effect_query(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = None
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = mock_approver
            return q

        mock_db.query.side_effect = side_effect_query

        def fake_add(obj):
            obj.id = 2
            obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = None
            obj.status = "pending"
            obj.approved_at = None
            obj.requester_name = "req"
            obj.approver_username = "approver_noemail"
            obj.approver_name = None
            obj.reason = None
        mock_db.add.side_effect = fake_add

        email_calls = []

        import app.gitlab_client as _real_gl

        with patch("app.notifications.notify_approval_requested",
                   side_effect=lambda **kw: email_calls.append(kw)), \
             patch("app.routers.approvals.create_db_notification"), \
             patch.object(_real_gl, "get_issue", return_value={"iid": 12}):

            create_approval_request(body=body, db=mock_db, current_user=current_user)

        assert len(email_calls) == 0


# ---------------------------------------------------------------------------
# Lines 184-195 — approve_request: email path
# ---------------------------------------------------------------------------

class TestApproveRequestEmailNotify:
    def test_email_notification_called_when_requester_has_email(self):
        """Lines 184-195: notify_approval_decided called when requester has email."""
        from app.routers.approvals import approve_request, ApprovalAction

        body = ApprovalAction(reason="LGTM")
        current_user = {
            "sub": "100", "username": "admin_user", "name": "관리자", "role": "admin"
        }

        # Mock the pending approval request
        mock_req = MagicMock()
        mock_req.id = 1
        mock_req.status = "pending"
        mock_req.approver_username = None  # any agent/admin can approve
        mock_req.ticket_iid = 20
        mock_req.requester_username = "req_email_user"

        # Mock requester with email
        mock_requester = MagicMock()
        mock_requester.gitlab_user_id = 600
        mock_requester.username = "req_email_user"
        mock_requester.name = "이메일요청자"
        mock_requester.email = "req@example.com"

        mock_db = MagicMock()

        def side_effect_query(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = mock_req
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = mock_requester
            return q

        mock_db.query.side_effect = side_effect_query

        email_calls = []

        def fake_notify_decided(**kwargs):
            email_calls.append(kwargs)

        with patch("app.notifications.notify_approval_decided",
                   side_effect=fake_notify_decided), \
             patch("app.routers.approvals.create_db_notification"), \
             patch("app.notifications.get_settings") as ms:

            ms.return_value = MagicMock(
                NOTIFICATION_ENABLED=True,
                SMTP_HOST="smtp.test",
                FRONTEND_URL="http://test",
            )

            result = approve_request(
                approval_id=1,
                body=body,
                db=mock_db,
                current_user=current_user,
            )

        assert len(email_calls) == 1
        assert email_calls[0]["requester_email"] == "req@example.com"
        assert email_calls[0]["decision"] == "approved"

    def test_approve_request_requester_no_email(self, client, admin_cookies, db_session):
        """When requester has no email, approval succeeds without email notification."""
        requester = UserRole(
            gitlab_user_id=601,
            username="req_no_email",
            name="이메일없는요청자",
            role="user",
        )
        db_session.add(requester)
        db_session.commit()

        req = ApprovalRequest(
            ticket_iid=21, project_id="1",
            requester_username="req_no_email", requester_name="이메일없는요청자",
            status="pending",
        )
        db_session.add(req)
        db_session.commit()
        db_session.refresh(req)

        with patch("app.routers.approvals.create_db_notification"):
            resp = client.post(
                f"/approvals/{req.id}/approve",
                json={},
                cookies=admin_cookies,
            )

        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"


# ---------------------------------------------------------------------------
# Lines 243-254 — reject_request: email path
# ---------------------------------------------------------------------------

class TestRejectRequestEmailNotify:
    def test_email_notification_called_when_requester_has_email(self):
        """Lines 243-254: notify_approval_decided called when requester has email on reject."""
        from app.routers.approvals import reject_request, ApprovalAction

        body = ApprovalAction(reason="Not approved")
        current_user = {
            "sub": "100", "username": "admin_user", "name": "관리자", "role": "admin"
        }

        mock_req = MagicMock()
        mock_req.id = 2
        mock_req.status = "pending"
        mock_req.approver_username = None
        mock_req.requester_username = "req_reject_email"
        mock_req.ticket_iid = 30

        mock_requester = MagicMock()
        mock_requester.gitlab_user_id = 700
        mock_requester.username = "req_reject_email"
        mock_requester.name = "반려요청자"
        mock_requester.email = "reject_req@example.com"

        mock_db = MagicMock()

        def side_effect_query(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = mock_req
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = mock_requester
            return q

        mock_db.query.side_effect = side_effect_query

        email_calls = []

        def fake_notify_decided(**kwargs):
            email_calls.append(kwargs)

        with patch("app.notifications.notify_approval_decided",
                   side_effect=fake_notify_decided), \
             patch("app.routers.approvals.create_db_notification"), \
             patch("app.notifications.get_settings") as ms:

            ms.return_value = MagicMock(
                NOTIFICATION_ENABLED=True,
                SMTP_HOST="smtp.test",
                FRONTEND_URL="http://test",
            )

            result = reject_request(
                approval_id=2,
                body=body,
                db=mock_db,
                current_user=current_user,
            )

        assert len(email_calls) == 1
        assert email_calls[0]["requester_email"] == "reject_req@example.com"
        assert email_calls[0]["decision"] == "rejected"

    def test_reject_request_no_requester_in_db(self, client, admin_cookies, db_session):
        """When requester has no UserRole in DB, reject still works without email."""
        req = ApprovalRequest(
            ticket_iid=31, project_id="1",
            requester_username="unknown_requester",
            status="pending",
        )
        db_session.add(req)
        db_session.commit()
        db_session.refresh(req)

        resp = client.post(
            f"/approvals/{req.id}/reject",
            json={"reason": "Denied"},
            cookies=admin_cookies,
        )

        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

    def test_reject_without_email_succeeds(self, client, admin_cookies, db_session):
        """reject_request works when requester has no email attribute."""
        requester = UserRole(
            gitlab_user_id=800,
            username="req_noemail_reject",
            name="이메일없는반려자",
            role="user",
        )
        db_session.add(requester)
        db_session.commit()

        req = ApprovalRequest(
            ticket_iid=32, project_id="1",
            requester_username="req_noemail_reject", requester_name="이메일없는반려자",
            status="pending",
        )
        db_session.add(req)
        db_session.commit()
        db_session.refresh(req)

        with patch("app.routers.approvals.create_db_notification"):
            resp = client.post(
                f"/approvals/{req.id}/reject",
                json={},
                cookies=admin_cookies,
            )

        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

# ---------------------------------------------------------------------------
# Lines 136-137, 194-195, 253-254 — except Exception: pass blocks
# ---------------------------------------------------------------------------

class TestEmailExceptionSwallowed:
    def _make_mock_req(self, ticket_iid=40, status="pending", requester_username="u"):
        req = MagicMock()
        req.id = 99
        req.status = status
        req.approver_username = None
        req.requester_username = requester_username
        req.requester_name = "요청자"
        req.ticket_iid = ticket_iid
        req.approver_name = "관리자"
        req.reason = None
        req.approved_at = None
        req.project_id = "1"
        req.created_at = None
        req.updated_at = None
        return req

    def _make_requester(self, email="req@test.com"):
        r = MagicMock()
        r.gitlab_user_id = 999
        r.username = "u"
        r.name = "요청자"
        r.email = email
        return r

    def _make_mock_db(self, req, requester):
        mock_db = MagicMock()
        def side_effect_query(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = req
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = requester
            return q
        mock_db.query.side_effect = side_effect_query
        return mock_db

    def test_create_approval_request_email_exception_swallowed(self):
        """Lines 136-137: Exception in notify_approval_requested is swallowed."""
        from app.routers.approvals import create_approval_request, ApprovalCreate

        mock_approver = MagicMock()
        mock_approver.gitlab_user_id = 510
        mock_approver.email = "approver@test.com"
        mock_approver.name = "승인자"
        mock_approver.username = "approver_ex"

        mock_db = MagicMock()
        def side_q(model):
            q = MagicMock()
            if model.__name__ == "ApprovalRequest":
                q.filter.return_value.with_for_update.return_value.first.return_value = None
            elif model.__name__ == "UserRole":
                q.filter.return_value.first.return_value = mock_approver
            return q
        mock_db.query.side_effect = side_q

        def fake_add(obj):
            obj.id = 5
            obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = None
            obj.status = "pending"
            obj.approved_at = None
            obj.requester_name = "req"
            obj.approver_username = "approver_ex"
            obj.approver_name = None
            obj.reason = None
        mock_db.add.side_effect = fake_add

        body = ApprovalCreate(ticket_iid=41, project_id="1",
                              approver_username="approver_ex")
        current_user = {"sub": "42", "username": "req_ex", "name": "req", "role": "user"}

        import app.gitlab_client as _real_gl

        with patch("app.notifications.notify_approval_requested",
                   side_effect=Exception("email error")), \
             patch("app.routers.approvals.create_db_notification"), \
             patch.object(_real_gl, "get_issue", return_value={"iid": 41}):
            # Should not raise — exception is swallowed
            result = create_approval_request(body=body, db=mock_db,
                                             current_user=current_user)

        assert result["ticket_iid"] == 41

    def test_approve_request_email_exception_swallowed(self):
        """Lines 194-195: Exception in notify_approval_decided is swallowed on approve."""
        from app.routers.approvals import approve_request, ApprovalAction

        req = self._make_mock_req(ticket_iid=42, status="pending")
        requester = self._make_requester()
        mock_db = self._make_mock_db(req, requester)

        with patch("app.notifications.notify_approval_decided",
                   side_effect=Exception("email error")), \
             patch("app.routers.approvals.create_db_notification"):
            # Should not raise
            result = approve_request(
                approval_id=99,
                body=ApprovalAction(),
                db=mock_db,
                current_user={"sub": "100", "username": "admin", "name": "Admin",
                               "role": "admin"},
            )

        assert result["status"] == "approved"

    def test_reject_request_email_exception_swallowed(self):
        """Lines 253-254: Exception in notify_approval_decided is swallowed on reject."""
        from app.routers.approvals import reject_request, ApprovalAction

        req = self._make_mock_req(ticket_iid=43, status="pending")
        requester = self._make_requester()
        mock_db = self._make_mock_db(req, requester)

        with patch("app.notifications.notify_approval_decided",
                   side_effect=Exception("email error")), \
             patch("app.routers.approvals.create_db_notification"):
            # Should not raise
            result = reject_request(
                approval_id=99,
                body=ApprovalAction(reason="denied"),
                db=mock_db,
                current_user={"sub": "100", "username": "admin", "name": "Admin",
                               "role": "admin"},
            )

        assert result["status"] == "rejected"
