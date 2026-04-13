"""SEC #1: 단일 티켓 GET endpoint의 IDOR 차단 회귀 테스트.

`_can_user_view_issue(issue, user)` 헬퍼가:
- role==user는 본인 신청 티켓만 통과
- developer 이상은 모든 일반 티켓 통과
- confidential 티켓은 pl+ 또는 신청자만 통과

이 helper가 변경/회귀되면 모든 단일 티켓 endpoint에서 IDOR이 재발하므로
단위 테스트로 고정한다.
"""
import pytest


def _make_issue(*, requester: str, confidential: bool = False, state: str = "opened") -> dict:
    """테스트용 GitLab issue payload mock."""
    return {
        "iid": 42,
        "state": state,
        "confidential": confidential,
        "labels": ["status::open"],
        "author": {"username": requester, "name": requester},
        "description": f"created_by_username::{requester}\n",
        "assignees": [],
    }


def _user(username: str, role: str = "user", sub: int = 1) -> dict:
    return {"sub": sub, "username": username, "role": role}


# ── 일반 티켓 (non-confidential) ──────────────────────────────────────────

def test_user_can_view_own_ticket():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("alice", "user")) is True


def test_user_blocked_from_other_ticket():
    """SEC #1 핵심 회귀 — 일반 사용자가 타인 티켓 조회 차단."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("bob", "user")) is False


def test_developer_can_view_any_ticket():
    """developer 이상은 운영 워크플로우 위해 모든 일반 티켓 조회 가능."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("dev1", "developer")) is True


def test_pl_can_view_any_ticket():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("pl1", "pl")) is True


def test_agent_can_view_any_ticket():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("agent1", "agent")) is True


def test_admin_can_view_any_ticket():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("admin1", "admin")) is True


# ── Confidential 티켓 ────────────────────────────────────────────────────

def test_confidential_blocked_for_user():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice", confidential=True)
    assert _can_user_view_issue(issue, _user("bob", "user")) is False


def test_confidential_visible_to_requester_even_user_role():
    """confidential 티켓도 신청자 본인은 조회 가능."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice", confidential=True)
    assert _can_user_view_issue(issue, _user("alice", "user")) is True


def test_confidential_blocked_for_developer():
    """SEC #1: confidential 티켓은 developer로는 부족 — pl 이상 또는 신청자만."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice", confidential=True)
    assert _can_user_view_issue(issue, _user("dev1", "developer")) is False


def test_confidential_visible_to_pl():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice", confidential=True)
    assert _can_user_view_issue(issue, _user("pl1", "pl")) is True


def test_confidential_visible_to_admin():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice", confidential=True)
    assert _can_user_view_issue(issue, _user("admin1", "admin")) is True


# ── Edge cases ────────────────────────────────────────────────────────────

def test_unknown_role_treated_as_user():
    """알 수 없는 role 값은 가장 낮은 권한(user)으로 처리."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("bob", "anonymous")) is False


def test_empty_username_blocked():
    """username 없는 사용자는 차단 (anonymous 시도 방지)."""
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    assert _can_user_view_issue(issue, _user("", "user")) is False


def test_missing_role_treated_as_user():
    from app.routers.tickets.helpers import _can_user_view_issue
    issue = _make_issue(requester="alice")
    user_no_role = {"sub": 1, "username": "bob"}  # role 누락
    assert _can_user_view_issue(issue, user_no_role) is False
