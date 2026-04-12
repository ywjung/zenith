"""문제 관리 (Problem Management, ITIL).

문제(Problem)는 하나 이상의 티켓의 근본 원인이 되는 이슈이다.
티켓 타입이 "problem"으로 설정된 GitLab 이슈를 관리한다.
"""
import logging
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..models import TicketTypeMeta, TicketLink
from ..rbac import require_agent
from .. import gitlab_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/problems", tags=["problems"])


# ── 스키마 ─────────────────────────────────────────────────────────────────

class CreateProblemBody(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=10000)] = ""
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    assignee_id: Optional[int] = None
    project_id: Optional[str] = None


class UpdateProblemBody(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=10000)] = ""
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    assignee_id: Optional[int] = None
    project_id: Optional[str] = None


class LinkIncidentBody(BaseModel):
    incident_iid: int
    project_id: Optional[str] = None


# ── 헬퍼 ─────────────────────────────────────────────────────────────────

def _pid(project_id: Optional[str] = None) -> str:
    return project_id or str(get_settings().GITLAB_PROJECT_ID)


def _serialize_issue(issue: dict, ticket_type: str = "problem") -> dict:
    """GitLab 이슈 dict를 API 응답 형식으로 변환한다."""
    assignee = issue.get("assignee") or {}
    return {
        "iid": issue.get("iid"),
        "title": issue.get("title", ""),
        "description": issue.get("description", ""),
        "state": issue.get("state", ""),
        "priority": next(
            (lb.split("::")[1] for lb in issue.get("labels", []) if lb.startswith("prio::")),
            "medium",
        ),
        "assignee": {
            "id": assignee.get("id"),
            "username": assignee.get("username"),
            "name": assignee.get("name"),
            "avatar_url": assignee.get("avatar_url"),
        } if assignee else None,
        "created_at": issue.get("created_at"),
        "updated_at": issue.get("updated_at"),
        "web_url": issue.get("web_url", ""),
        "ticket_type": ticket_type,
    }


def _fetch_incident_summaries(incident_iids: list[int], pid: str) -> list[dict]:
    """티켓 iid 목록을 받아 GitLab에서 제목·상태·우선순위를 배치 조회한다."""
    if not incident_iids:
        return []
    summaries: list[dict] = []
    CHUNK = 100
    try:
        for start in range(0, len(incident_iids), CHUNK):
            chunk = incident_iids[start:start + CHUNK]
            issues, _ = gitlab_client.get_issues(
                project_id=pid,
                iids=chunk,
                per_page=CHUNK,
                page=1,
            )
            for iss in issues:
                summaries.append({
                    "iid": iss.get("iid"),
                    "title": iss.get("title", ""),
                    "state": iss.get("state", ""),
                    "priority": next(
                        (lb.split("::")[1] for lb in iss.get("labels", []) if lb.startswith("prio::")),
                        "medium",
                    ),
                })
    except Exception as exc:
        logger.warning("incident summary fetch failed: %s", exc)
    # 원래 순서 보장
    order = {iid: i for i, iid in enumerate(incident_iids)}
    summaries.sort(key=lambda s: order.get(s["iid"], 999))
    return summaries


# ── 엔드포인트 ──────────────────────────────────────────────────────────────

@router.get("", response_model=dict)
def list_problems(
    state: str = Query(default="all", description="all | open | closed"),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=20, ge=1, le=100),
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """문제(Problem) 티켓 목록을 반환한다."""
    pid = _pid(project_id)

    problem_metas = (
        db.query(TicketTypeMeta)
        .filter_by(ticket_type="problem", project_id=pid)
        .all()
    )
    if not problem_metas:
        return {"problems": [], "total": 0, "page": page, "per_page": per_page}

    problem_iids = [m.ticket_iid for m in problem_metas]

    gl_state = "all"
    if state == "open":
        gl_state = "opened"
    elif state == "closed":
        gl_state = "closed"

    CHUNK = 100
    all_issues: list[dict] = []
    try:
        for _start in range(0, len(problem_iids), CHUNK):
            chunk_iids = problem_iids[_start:_start + CHUNK]
            issues, _ = gitlab_client.get_issues(
                state=gl_state,
                search=search,
                project_id=pid,
                iids=chunk_iids,
                per_page=CHUNK,
                page=1,
            )
            all_issues.extend(issues)
    except Exception as exc:
        logger.error("GitLab issue fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitLab 연결 오류")

    total = len(all_issues)
    start = (page - 1) * per_page
    paged = all_issues[start:start + per_page]

    # 연결된 티켓 iid 배치 조회 (N+1 방지)
    paged_iids = [iss["iid"] for iss in paged]
    links = (
        db.query(TicketLink)
        .filter(
            TicketLink.source_iid.in_(paged_iids),
            TicketLink.project_id == pid,
            TicketLink.link_type == "causes",
        )
        .all()
    )
    link_map: dict[int, list[int]] = {}
    for lk in links:
        link_map.setdefault(lk.source_iid, []).append(lk.target_iid)

    # 연결된 티켓 전체의 제목·상태를 한 번에 조회
    all_incident_iids: list[int] = []
    for iids in link_map.values():
        all_incident_iids.extend(iids)
    incident_summary_map = {
        s["iid"]: s for s in _fetch_incident_summaries(list(set(all_incident_iids)), pid)
    }

    problems_out = []
    for iss in paged:
        item = _serialize_issue(iss)
        inc_iids = link_map.get(iss["iid"], [])
        item["linked_incident_iids"] = inc_iids
        item["linked_incidents"] = [
            incident_summary_map.get(iid, {"iid": iid, "title": f"#{iid}", "state": "unknown", "priority": "medium"})
            for iid in inc_iids
        ]
        problems_out.append(item)

    return {
        "problems": problems_out,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("", status_code=201, response_model=dict)
def create_problem(
    body: CreateProblemBody,
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """새 문제(Problem) 티켓을 생성한다."""
    pid = _pid(body.project_id)
    labels = ["problem", f"prio::{body.priority}"]

    try:
        issue = gitlab_client.create_issue(
            title=body.title,
            description=body.description,
            labels=labels,
            project_id=pid,
            assignee_id=body.assignee_id,
            gitlab_token=user.get("gitlab_token"),
        )
    except Exception as exc:
        logger.error("Problem ticket creation failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitLab 이슈 생성 실패")

    iid = issue["iid"]

    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid).first()
    if meta:
        meta.ticket_type = "problem"
        meta.updated_by = user["username"]
    else:
        meta = TicketTypeMeta(
            ticket_iid=iid,
            project_id=pid,
            ticket_type="problem",
            created_by=user["username"],
            updated_by=user["username"],
        )
        db.add(meta)
    db.commit()

    result = _serialize_issue(issue)
    result["linked_incident_iids"] = []
    result["linked_incidents"] = []
    return result


@router.get("/stats/summary", response_model=dict)
def get_problem_stats(
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """문제 관리 요약 통계를 반환한다."""
    pid = _pid(project_id)

    problem_metas = (
        db.query(TicketTypeMeta)
        .filter_by(ticket_type="problem", project_id=pid)
        .all()
    )
    total_problems = len(problem_metas)
    problem_iids = [m.ticket_iid for m in problem_metas]

    link_counts: dict[int, int] = {}
    if problem_iids:
        from sqlalchemy import func as sa_func
        rows = (
            db.query(TicketLink.source_iid, sa_func.count(TicketLink.id))
            .filter(
                TicketLink.source_iid.in_(problem_iids),
                TicketLink.link_type == "causes",
            )
            .group_by(TicketLink.source_iid)
            .all()
        )
        link_counts = {row[0]: row[1] for row in rows}

    total_linked_incidents = sum(link_counts.values())

    return {
        "total_problems": total_problems,
        "total_linked_incidents": total_linked_incidents,
        "avg_incidents_per_problem": (
            round(total_linked_incidents / total_problems, 1) if total_problems else 0
        ),
    }


@router.get("/{iid}", response_model=dict)
def get_problem(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """단일 문제 티켓 상세 조회."""
    pid = _pid(project_id)

    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid, ticket_type="problem").first()
    if not meta:
        raise HTTPException(status_code=404, detail="Problem ticket not found")

    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
    except Exception as exc:
        logger.error("GitLab get_issue failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitLab 연결 오류")

    linked = (
        db.query(TicketLink)
        .filter(
            TicketLink.source_iid == iid,
            TicketLink.project_id == pid,
            TicketLink.link_type == "causes",
        )
        .all()
    )
    incident_iids = [lk.target_iid for lk in linked]

    result = _serialize_issue(issue)
    result["linked_incident_iids"] = incident_iids
    result["linked_incidents"] = _fetch_incident_summaries(incident_iids, pid)
    return result


@router.patch("/{iid}", response_model=dict)
def update_problem(
    iid: int,
    body: UpdateProblemBody,
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """문제 티켓 수정 (제목·설명·우선순위·담당자)."""
    pid = _pid(body.project_id)

    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid, ticket_type="problem").first()
    if not meta:
        raise HTTPException(status_code=404, detail="Problem ticket not found")

    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
    except Exception as exc:
        logger.error("GitLab get_issue failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitLab 연결 오류")

    # 기존 라벨에서 prio:: 만 교체
    old_labels = [lb for lb in issue.get("labels", []) if not lb.startswith("prio::")]
    new_labels = old_labels + [f"prio::{body.priority}"]

    try:
        import httpx
        settings = get_settings()
        token = user.get("gitlab_token") or settings.GITLAB_PROJECT_TOKEN
        with httpx.Client(timeout=15.0) as client:
            resp = client.put(
                f"{settings.GITLAB_API_URL}/api/v4/projects/{pid}/issues/{iid}",
                headers={"PRIVATE-TOKEN": token},
                json={
                    "title": body.title,
                    "description": body.description,
                    "labels": ",".join(new_labels),
                    **({"assignee_id": body.assignee_id} if body.assignee_id is not None else {"assignee_ids": []}),
                },
            )
            resp.raise_for_status()
            updated_issue = resp.json()
    except Exception as exc:
        logger.error("Problem update failed: %s", exc)
        raise HTTPException(status_code=502, detail="GitLab 이슈 수정 실패")

    meta.updated_by = user["username"]
    db.commit()

    result = _serialize_issue(updated_issue)
    linked = (
        db.query(TicketLink)
        .filter(
            TicketLink.source_iid == iid,
            TicketLink.project_id == pid,
            TicketLink.link_type == "causes",
        )
        .all()
    )
    incident_iids = [lk.target_iid for lk in linked]
    result["linked_incident_iids"] = incident_iids
    result["linked_incidents"] = _fetch_incident_summaries(incident_iids, pid)
    return result


@router.post("/{iid}/link-incident", status_code=201, response_model=dict)
def link_incident(
    iid: int,
    body: LinkIncidentBody,
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """티켓을 문제에 연결한다."""
    pid = _pid(body.project_id)

    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid, ticket_type="problem").first()
    if not meta:
        raise HTTPException(status_code=404, detail="Problem ticket not found")

    if body.incident_iid == iid:
        raise HTTPException(status_code=422, detail="문제 티켓 자신을 연결할 수 없습니다.")

    try:
        gitlab_client.get_issue(body.incident_iid, project_id=pid)
    except Exception:
        raise HTTPException(status_code=404, detail=f"티켓 #{body.incident_iid}을(를) 찾을 수 없습니다.")

    existing = (
        db.query(TicketLink)
        .filter_by(
            source_iid=iid,
            project_id=pid,
            target_iid=body.incident_iid,
            link_type="causes",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 연결된 티켓입니다.")

    link = TicketLink(
        source_iid=iid,
        project_id=pid,
        target_iid=body.incident_iid,
        link_type="causes",
        created_by=user["username"],
    )
    db.add(link)
    db.commit()
    return {"problem_iid": iid, "incident_iid": body.incident_iid, "link_type": "causes"}


@router.delete("/{iid}/link-incident/{incident_iid}", status_code=200)
def unlink_incident(
    iid: int,
    incident_iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """티켓-문제 연결을 해제한다."""
    pid = _pid(project_id)
    link = (
        db.query(TicketLink)
        .filter_by(
            source_iid=iid,
            project_id=pid,
            target_iid=incident_iid,
            link_type="causes",
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="연결된 티켓을 찾을 수 없습니다.")
    db.delete(link)
    db.commit()
    return {"status": "unlinked"}
