"""이슈 관계(Linked Issues) 엔드포인트."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...auth import get_current_user
from ... import gitlab_client
from ...rbac import require_agent

logger = logging.getLogger(__name__)

links_router = APIRouter()


class CreateLinkBody(BaseModel):
    target_iid: int
    link_type: str = "relates_to"   # relates_to | blocks | is_blocked_by
    target_project_id: Optional[str] = None


@links_router.get("/{iid}/links", response_model=list)
def get_ticket_links(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """티켓과 연결된 다른 이슈 목록 반환."""
    raw = gitlab_client.get_issue_links(iid, project_id)
    result = []
    for link in raw:
        issue = link.get("issue") or link  # GitLab 응답 구조에 따라 다름
        labels = issue.get("labels", [])
        status = next((lb[8:] for lb in labels if lb.startswith("status::")), "open")
        result.append({
            "link_id": link.get("id"),
            "link_type": link.get("link_type", "relates_to"),
            "iid": issue.get("iid"),
            "title": issue.get("title"),
            "state": issue.get("state"),
            "status": status,
            "web_url": issue.get("web_url"),
        })
    return result


@links_router.post("/{iid}/links", response_model=dict, status_code=201)
def create_ticket_link(
    iid: int,
    body: CreateLinkBody,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
):
    """두 티켓 사이에 관계를 생성한다."""
    if body.link_type not in ("relates_to", "blocks", "is_blocked_by"):
        raise HTTPException(status_code=422, detail="link_type은 relates_to | blocks | is_blocked_by 중 하나여야 합니다.")
    result = gitlab_client.create_issue_link(
        iid=iid,
        target_iid=body.target_iid,
        link_type=body.link_type,
        project_id=project_id,
        target_project_id=body.target_project_id,
    )
    if result is None:
        raise HTTPException(status_code=502, detail="GitLab 이슈 링크 생성에 실패했습니다.")
    return {"ok": True}


@links_router.delete("/{iid}/links/{link_id}", status_code=204)
def delete_ticket_link(
    iid: int,
    link_id: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
):
    """이슈 관계를 제거한다."""
    ok = gitlab_client.delete_issue_link(iid, link_id, project_id)
    if not ok:
        raise HTTPException(status_code=502, detail="GitLab 이슈 링크 삭제에 실패했습니다.")
