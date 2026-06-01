"""Targeted coverage tests for app/routers/tickets/links.py missing lines:
  33-36: get_ticket_links — result list with status extraction from labels
  66:    create_ticket_link — gitlab returns None → 502
"""
from unittest.mock import patch, MagicMock
import pytest


# get_ticket_links는 이제 _can_user_view_issue로 view 권한을 검증한다(IDOR 방지).
# 신청자가 토큰 유저(hong)인 비밀 아님 이슈를 get_issue 목으로 제공한다.
_VIEWABLE_ISSUE = {
    "iid": 1, "description": "**작성자:** hong", "author": {"username": "hong"},
    "confidential": False, "labels": [], "state": "opened",
}


# ---------------------------------------------------------------------------
# Lines 33-36 — get_ticket_links builds result with status from labels
# ---------------------------------------------------------------------------

class TestGetTicketLinksGitlab:
    def test_returns_links_with_status_from_labels(self, client, user_cookies):
        """Lines 33-36: get_ticket_links extracts status from labels prefixed 'status::'."""
        mock_links = [
            {
                "id": 1,
                "link_type": "relates_to",
                "issue": {
                    "iid": 42,
                    "title": "Related issue",
                    "state": "opened",
                    "labels": ["status::in_progress", "priority::high"],
                    "web_url": "https://gitlab.example.com/issues/42",
                },
            }
        ]

        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.get_issue.return_value = _VIEWABLE_ISSUE
            mock_gl.get_issue_links.return_value = mock_links

            resp = client.get(
                "/tickets/1/links",
                params={"project_id": "1"},
                cookies=user_cookies,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        link = data[0]
        assert link["target_iid"] == 42
        assert link["link_type"] == "relates_to"
        assert link["status"] == "in_progress"  # extracted from "status::in_progress"
        assert link["state"] == "opened"
        assert link["title"] == "Related issue"

    def test_returns_links_without_status_label(self, client, user_cookies):
        """get_ticket_links uses 'open' as default status when no status label present."""
        mock_links = [
            {
                "id": 2,
                "link_type": "blocks",
                "issue": {
                    "iid": 99,
                    "title": "Another issue",
                    "state": "closed",
                    "labels": ["bug", "priority::low"],
                    "web_url": "https://gitlab.example.com/issues/99",
                },
            }
        ]

        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.get_issue.return_value = _VIEWABLE_ISSUE
            mock_gl.get_issue_links.return_value = mock_links

            resp = client.get(
                "/tickets/5/links",
                params={"project_id": "1"},
                cookies=user_cookies,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["status"] == "open"  # default when no status:: label

    def test_returns_empty_list_when_no_links(self, client, user_cookies):
        """get_ticket_links returns empty list when GitLab returns no links."""
        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.get_issue.return_value = _VIEWABLE_ISSUE
            mock_gl.get_issue_links.return_value = []

            resp = client.get(
                "/tickets/10/links",
                params={"project_id": "1"},
                cookies=user_cookies,
            )

        assert resp.status_code == 200
        assert resp.json() == []

    def test_link_structure_when_issue_is_at_top_level(self, client, user_cookies):
        """Lines 33-34: When link dict has no 'issue' key, uses top-level link dict."""
        mock_links = [
            {
                "id": 3,
                "link_type": "is_blocked_by",
                "iid": 77,
                "title": "Flat structure issue",
                "state": "opened",
                "labels": ["status::done"],
                "web_url": "https://gitlab.example.com/issues/77",
            }
        ]

        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.get_issue.return_value = _VIEWABLE_ISSUE
            mock_gl.get_issue_links.return_value = mock_links

            resp = client.get(
                "/tickets/7/links",
                cookies=user_cookies,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "done"


# ---------------------------------------------------------------------------
# Line 66 — create_ticket_link returns 502 when GitLab returns None
# ---------------------------------------------------------------------------

class TestCreateTicketLinkGitlab:
    def test_create_link_returns_ok_when_gitlab_succeeds(self, client, admin_cookies):
        """create_ticket_link returns 201 when GitLab creates the link."""
        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.create_issue_link.return_value = {"id": 10}

            resp = client.post(
                "/tickets/1/links",
                params={"project_id": "1"},
                json={"target_iid": 2, "link_type": "relates_to"},
                cookies=admin_cookies,
            )

        assert resp.status_code == 201
        assert resp.json()["ok"] is True

    def test_create_link_gitlab_none_falls_back_to_local_db(self, client, admin_cookies):
        """GitLab 링크 생성 실패(None) 시 502가 아니라 로컬 DB에만 저장하고 201로 폴백한다.
        (GitLab CE 미지원 등 — 'Fall through — still write to local DB')"""
        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.create_issue_link.return_value = None

            resp = client.post(
                "/tickets/1/links",
                params={"project_id": "1"},
                json={"target_iid": 2, "link_type": "relates_to"},
                cookies=admin_cookies,
            )

        assert resp.status_code == 201
        assert resp.json()["ok"] is True

    def test_create_link_invalid_link_type_returns_422(self, client, admin_cookies):
        """create_ticket_link returns 422 for invalid link_type."""
        resp = client.post(
            "/tickets/1/links",
            params={"project_id": "1"},
            json={"target_iid": 2, "link_type": "invalid"},
            cookies=admin_cookies,
        )

        assert resp.status_code == 422

    def test_create_link_blocks_type(self, client, admin_cookies):
        """create_ticket_link accepts 'blocks' link type."""
        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.create_issue_link.return_value = {"id": 11}

            resp = client.post(
                "/tickets/2/links",
                params={"project_id": "1"},
                json={"target_iid": 3, "link_type": "blocks"},
                cookies=admin_cookies,
            )

        assert resp.status_code == 201

    def test_create_link_duplicate_of_type(self, client, admin_cookies):
        """create_ticket_link accepts 'duplicate_of' (로컬 DB 전용) link type."""
        with patch("app.routers.tickets.links.gitlab_client") as mock_gl:
            mock_gl.create_issue_link.return_value = {"id": 12}

            resp = client.post(
                "/tickets/3/links",
                params={"project_id": "1"},
                json={"target_iid": 4, "link_type": "duplicate_of"},
                cookies=admin_cookies,
            )

        assert resp.status_code == 201
