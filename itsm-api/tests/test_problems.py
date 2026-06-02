"""Tests for /problems endpoints — GitLab is mocked via unittest.mock.

require_agent(=role level >= 3) 권한 가드와 핵심 happy path를 검증한다.
"""
from unittest.mock import patch

from tests.conftest import auth_cookies

PID = "1"

FAKE_PROBLEM = {
    "iid": 10,
    "title": "반복되는 VPN 끊김 문제",
    "description": "근본 원인 분석 필요",
    "state": "opened",
    "labels": ["problem", "prio::high"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "web_url": "http://gitlab/issues/10",
}


def _agent_cookies():
    return auth_cookies("agent", user_id="300")


def _seed_problem_meta(db_session, iid=10, pid=PID):
    from app.models import TicketTypeMeta
    meta = TicketTypeMeta(
        ticket_iid=iid, project_id=pid, ticket_type="problem",
        created_by="agent", updated_by="agent",
    )
    db_session.add(meta)
    db_session.commit()
    return meta


# ── list ───────────────────────────────────────────────────────────────────

def test_list_problems_requires_auth(client):
    assert client.get("/problems").status_code == 401


def test_list_problems_empty_when_no_metas(client, admin_cookies):
    r = client.get(f"/problems?project_id={PID}", cookies=admin_cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["problems"] == []
    assert body["total"] == 0


def test_list_problems_returns_seeded(client, admin_cookies, db_session):
    _seed_problem_meta(db_session)
    with patch("app.gitlab_client.get_issues", return_value=([FAKE_PROBLEM], 1)):
        r = client.get(f"/problems?project_id={PID}", cookies=admin_cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["problems"][0]["iid"] == 10


# ── create (require_agent) ───────────────────────────────────────────────────

_CREATE_PAYLOAD = {"title": "신규 문제 티켓", "description": "분석 대상", "priority": "high", "project_id": PID}


def test_create_problem_requires_auth(client):
    assert client.post("/problems", json=_CREATE_PAYLOAD).status_code == 401


def test_create_problem_forbidden_for_user(client, user_cookies):
    assert client.post("/problems", json=_CREATE_PAYLOAD, cookies=user_cookies).status_code == 403


def test_create_problem_forbidden_for_developer(client, developer_cookies):
    assert client.post("/problems", json=_CREATE_PAYLOAD, cookies=developer_cookies).status_code == 403


def test_create_problem_agent_ok(client, db_session):
    with patch("app.gitlab_client.create_issue", return_value={**FAKE_PROBLEM, "iid": 11}):
        r = client.post("/problems", json=_CREATE_PAYLOAD, cookies=_agent_cookies())
    assert r.status_code == 201
    assert r.json()["iid"] == 11
    # meta가 생성됐는지 확인
    from app.models import TicketTypeMeta
    meta = db_session.query(TicketTypeMeta).filter_by(ticket_iid=11, project_id=PID).first()
    assert meta is not None and meta.ticket_type == "problem"


def test_create_problem_gitlab_error_returns_502(client):
    with patch("app.gitlab_client.create_issue", side_effect=Exception("boom")):
        r = client.post("/problems", json=_CREATE_PAYLOAD, cookies=_agent_cookies())
    assert r.status_code == 502


def test_create_problem_title_required(client):
    r = client.post("/problems", json={"description": "x", "project_id": PID}, cookies=_agent_cookies())
    assert r.status_code == 422


# ── stats ────────────────────────────────────────────────────────────────────

def test_problem_stats_requires_auth(client):
    assert client.get("/problems/stats/summary").status_code == 401


def test_problem_stats_returns_dict(client, admin_cookies):
    with patch("app.gitlab_client.get_issues", return_value=([], 0)):
        r = client.get(f"/problems/stats/summary?project_id={PID}", cookies=admin_cookies)
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


# ── get single ───────────────────────────────────────────────────────────────

def test_get_problem_404_when_missing(client, admin_cookies):
    r = client.get(f"/problems/99999?project_id={PID}", cookies=admin_cookies)
    assert r.status_code == 404


def test_get_problem_ok(client, admin_cookies, db_session):
    _seed_problem_meta(db_session, iid=10)
    with patch("app.gitlab_client.get_issue", return_value=FAKE_PROBLEM):
        r = client.get(f"/problems/10?project_id={PID}", cookies=admin_cookies)
    assert r.status_code == 200
    assert r.json()["iid"] == 10


# ── update (require_agent) ───────────────────────────────────────────────────

def test_update_problem_forbidden_for_user(client, user_cookies, db_session):
    _seed_problem_meta(db_session, iid=10)
    payload = {"title": "수정된 제목", "priority": "low", "project_id": PID}
    assert client.patch("/problems/10", json=payload, cookies=user_cookies).status_code == 403


# ── link-incident (require_agent) ────────────────────────────────────────────

def test_link_incident_forbidden_for_user(client, user_cookies):
    payload = {"incident_iid": 5, "project_id": PID}
    assert client.post("/problems/10/link-incident", json=payload, cookies=user_cookies).status_code == 403
