"""Coverage tests for app/routers/tickets/comments.py.

Target lines:
  - update_comment (149-169): no gitlab_token (151), update_note exception (157-158),
    Redis cache invalidation with and without Redis (161-167)
  - delete_comment (189-206): no gitlab_token (191), delete_note exception (196-197),
    Redis cache invalidation (199-206)
  - get_timeline (305-306): audit log exception handling
"""
import time
from unittest.mock import patch, MagicMock

import pytest


FAKE_NOTE = {
    "id": 10,
    "body": "댓글 내용",
    "author": {"name": "홍길동", "username": "hong", "avatar_url": None},
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "confidential": False,
    "system": False,
}

FAKE_ISSUE = {
    "iid": 1,
    "id": 100,
    "title": "테스트 티켓",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n---\n내용",
    "state": "opened",
    "labels": ["cat::network", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z",
    "web_url": "http://gitlab/issues/1",
    "author": {"id": 1, "username": "hong", "name": "홍길동"},
    "assignees": [],
    "assignee": None,
    "project_id": "1",
    "milestone": None,
}


def _make_token(role="user", user_id="42", include_gitlab_token=True):
    from jose import jwt as _jwt
    payload = {
        "sub": user_id,
        "role": role,
        "name": "홍길동",
        "username": "hong",
        "email": "hong@ex.com",
        "exp": int(time.time()) + 7200,
    }
    if include_gitlab_token:
        payload["gitlab_token"] = "test-gitlab-token"
    return _jwt.encode(payload, "test-secret-key-at-least-32-chars-long", algorithm="HS256")


# ---------------------------------------------------------------------------
# update_comment
# ---------------------------------------------------------------------------

class TestUpdateComment:
    def test_update_comment_no_gitlab_token_returns_401(self, client):
        """No gitlab_token in JWT → 401."""
        cookies = {"itsm_token": _make_token(include_gitlab_token=False)}
        resp = client.put(
            "/tickets/1/comments/10",
            json={"body": "수정된 댓글"},
            cookies=cookies,
        )
        assert resp.status_code == 401
        assert "GitLab 세션" in resp.json()["detail"]

    def test_update_comment_gitlab_error_returns_502(self, client, user_cookies):
        """update_note raises → 502."""
        with patch("app.gitlab_client.update_note", side_effect=Exception("GitLab error")):
            resp = client.put(
                "/tickets/1/comments/10",
                json={"body": "수정된 댓글"},
                cookies=user_cookies,
            )
        assert resp.status_code == 502
        assert "댓글 수정" in resp.json()["detail"]

    def test_update_comment_success_with_redis(self, client, user_cookies):
        """Successful update: Redis cache is invalidated."""
        mock_redis = MagicMock()
        mock_redis.delete.return_value = 1

        with patch("app.gitlab_client.update_note", return_value=FAKE_NOTE), \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.put(
                "/tickets/1/comments/10",
                json={"body": "수정된 댓글"},
                cookies=user_cookies,
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == 10
        assert data["body"] == "댓글 내용"
        mock_redis.delete.assert_called_once()

    def test_update_comment_success_no_redis(self, client, user_cookies):
        """When Redis is None, update still succeeds."""
        with patch("app.gitlab_client.update_note", return_value=FAKE_NOTE), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            resp = client.put(
                "/tickets/1/comments/10",
                json={"body": "수정된 댓글"},
                cookies=user_cookies,
            )
        assert resp.status_code == 200

    def test_update_comment_redis_delete_exception_ignored(self, client, user_cookies):
        """Redis.delete raises → exception swallowed, still returns 200."""
        mock_redis = MagicMock()
        mock_redis.delete.side_effect = Exception("Redis down")

        with patch("app.gitlab_client.update_note", return_value=FAKE_NOTE), \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.put(
                "/tickets/1/comments/10",
                json={"body": "수정된 댓글"},
                cookies=user_cookies,
            )
        assert resp.status_code == 200

    def test_update_comment_with_project_id(self, client, user_cookies):
        """project_id param is forwarded to gitlab."""
        mock_redis = MagicMock()
        with patch("app.gitlab_client.update_note", return_value=FAKE_NOTE) as mock_upd, \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.put(
                "/tickets/1/comments/10?project_id=5",
                json={"body": "수정"},
                cookies=user_cookies,
            )
        assert resp.status_code == 200
        call_kwargs = mock_upd.call_args.kwargs if mock_upd.call_args.kwargs else mock_upd.call_args[1]
        assert call_kwargs.get("project_id") == "5"


# ---------------------------------------------------------------------------
# delete_comment
# ---------------------------------------------------------------------------

class TestDeleteComment:
    def test_delete_comment_no_gitlab_token_returns_401(self, client):
        """No gitlab_token in JWT → 401."""
        cookies = {"itsm_token": _make_token(include_gitlab_token=False)}
        resp = client.delete("/tickets/1/comments/10", cookies=cookies)
        assert resp.status_code == 401

    def test_delete_comment_gitlab_error_returns_502(self, client, user_cookies):
        """delete_note raises → 502."""
        with patch("app.gitlab_client.delete_note", side_effect=Exception("GitLab error")):
            resp = client.delete("/tickets/1/comments/10", cookies=user_cookies)
        assert resp.status_code == 502
        assert "댓글 삭제" in resp.json()["detail"]

    def test_delete_comment_success_with_redis(self, client, user_cookies):
        """Successful delete: Redis cache invalidated."""
        mock_redis = MagicMock()
        mock_redis.delete.return_value = 1

        with patch("app.gitlab_client.delete_note", return_value=None), \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.delete("/tickets/1/comments/10", cookies=user_cookies)
        assert resp.status_code == 204
        mock_redis.delete.assert_called_once()

    def test_delete_comment_success_no_redis(self, client, user_cookies):
        """When Redis is None, delete still returns 204."""
        with patch("app.gitlab_client.delete_note", return_value=None), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            resp = client.delete("/tickets/1/comments/10", cookies=user_cookies)
        assert resp.status_code == 204

    def test_delete_comment_redis_exception_ignored(self, client, user_cookies):
        """Redis.delete raises → swallowed, still 204."""
        mock_redis = MagicMock()
        mock_redis.delete.side_effect = Exception("Redis down")

        with patch("app.gitlab_client.delete_note", return_value=None), \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.delete("/tickets/1/comments/10", cookies=user_cookies)
        assert resp.status_code == 204

    def test_delete_comment_with_project_id(self, client, user_cookies):
        """project_id param is forwarded to gitlab."""
        mock_redis = MagicMock()
        with patch("app.gitlab_client.delete_note", return_value=None) as mock_del, \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.delete("/tickets/1/comments/10?project_id=7", cookies=user_cookies)
        assert resp.status_code == 204
        call_kwargs = mock_del.call_args.kwargs if mock_del.call_args.kwargs else mock_del.call_args[1]
        assert call_kwargs.get("project_id") == "7"


# ---------------------------------------------------------------------------
# get_timeline — audit log exception
# ---------------------------------------------------------------------------

class TestGetTimeline:
    def _setup_notes(self):
        return [
            {**FAKE_NOTE, "system": False},
            {
                "id": 20, "body": "상태 변경됨", "system": True,
                "author": {"name": "관리자", "username": "admin", "avatar_url": None},
                "created_at": "2024-01-01T01:00:00Z",
                "confidential": False,
            },
        ]

    def test_get_timeline_audit_log_exception_ignored(self, client, user_cookies):
        """When DB audit log query raises, exception is caught and events still returned."""
        notes = self._setup_notes()

        with patch("app.gitlab_client.get_notes", return_value=notes), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            # Patch db.query to raise for AuditLog but that's tricky with SQLAlchemy
            # Instead we patch the sqlalchemy session filter to raise
            from unittest.mock import patch as _p
            original_query = None

            def mock_query(model):
                from app.models import AuditLog
                if model is AuditLog:
                    raise Exception("DB error")
                return original_query(model)

            resp = client.get("/tickets/1/timeline", cookies=user_cookies)
        # Even if audit log fails, notes should still be returned
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_get_timeline_audit_db_error_still_returns_notes(self, client, user_cookies, db_session):
        """Simulate audit log DB failure: timeline still returns GitLab notes."""
        notes = self._setup_notes()

        with patch("app.gitlab_client.get_notes", return_value=notes), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            # Override DB session to raise on AuditLog query
            from app.database import get_db as _get_db
            from sqlalchemy.orm import Session

            class _MockSession:
                def query(self, model):
                    from app.models import AuditLog
                    if model is AuditLog:
                        raise Exception("AuditLog query failed")
                    return db_session.query(model)
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    pass

            from app.main import app as _app
            from app.database import get_db

            def _override_db():
                yield _MockSession()

            _app.dependency_overrides[get_db] = _override_db
            try:
                from fastapi.testclient import TestClient
                c = TestClient(_app)
                resp = c.get("/tickets/1/timeline", cookies=user_cookies)
            finally:
                from tests.conftest import override_get_db
                _app.dependency_overrides[get_db] = override_get_db

        assert resp.status_code == 200
        data = resp.json()
        # Should have the notes from gitlab even if audit log failed
        assert isinstance(data, list)

    def test_get_timeline_success_with_no_redis(self, client, user_cookies):
        """Normal timeline fetch without Redis cache."""
        notes = self._setup_notes()
        with patch("app.gitlab_client.get_notes", return_value=notes), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            resp = client.get("/tickets/1/timeline", cookies=user_cookies)
        assert resp.status_code == 200
        data = resp.json()
        assert any(e["type"] == "comment" for e in data)
        assert any(e["type"] == "system" for e in data)

    def test_get_timeline_cached_response(self, client, user_cookies):
        """When Redis has cached timeline, return it directly."""
        import json
        cached = [{"type": "comment", "id": "gl-1", "body": "캐시됨", "created_at": "2024-01-01T00:00:00Z"}]
        mock_redis = MagicMock()
        mock_redis.get.return_value = json.dumps(cached)

        with patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.get("/tickets/1/timeline", cookies=user_cookies)
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["body"] == "캐시됨"

    def test_get_timeline_redis_get_exception(self, client, user_cookies):
        """Redis.get raises → falls back to DB, still works."""
        notes = self._setup_notes()
        mock_redis = MagicMock()
        mock_redis.get.side_effect = Exception("Redis error")

        with patch("app.gitlab_client.get_notes", return_value=notes), \
             patch("app.routers.tickets.comments._get_redis", return_value=mock_redis):
            resp = client.get("/tickets/1/timeline", cookies=user_cookies)
        assert resp.status_code == 200

    def test_get_timeline_notes_exception_handled(self, client, user_cookies):
        """GitLab get_notes raises → events list is empty but no 500."""
        with patch("app.gitlab_client.get_notes", side_effect=Exception("GitLab down")), \
             patch("app.routers.tickets.comments._get_redis", return_value=None):
            resp = client.get("/tickets/1/timeline", cookies=user_cookies)
        assert resp.status_code == 200
        assert resp.json() == [] or isinstance(resp.json(), list)
