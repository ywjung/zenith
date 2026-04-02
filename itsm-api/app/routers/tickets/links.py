"""이슈 관계(Linked Issues) 엔드포인트."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth import get_current_user
from ... import gitlab_client
from ...rbac import require_agent
from ...database import get_db
from ...models import TicketLink
from ...config import get_settings
from ...redis_client import get_redis

logger = logging.getLogger(__name__)

links_router = APIRouter()

# GitLab CE only supports relates_to; blocks/duplicate_of live in local DB only
_VALID_LINK_TYPES = ("relates_to", "blocks", "duplicate_of")
_GITLAB_SUPPORTED = {"relates_to"}
_LINKS_CACHE_TTL = 30  # 30초


class CreateLinkBody(BaseModel):
    target_iid: int
    link_type: str = "relates_to"   # relates_to | blocks | duplicate_of
    target_project_id: Optional[str] = None
    project_id: Optional[str] = None


@links_router.get("/{iid}/links", response_model=list)
def get_ticket_links(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓과 연결된 다른 이슈 목록 반환.
    GitLab API 링크와 로컬 DB 링크를 통합하여 반환합니다."""
    s = get_settings()
    pid = project_id or str(s.GITLAB_PROJECT_ID)

    # Redis 캐시 조회
    _r = get_redis()
    _cache_key = f"links:{pid}:{iid}"
    if _r:
        try:
            _cached = _r.get(_cache_key)
            if _cached:
                return json.loads(_cached)
        except Exception:
            pass

    # 1) GitLab API links (relates_to only on CE)
    gitlab_links: dict[int, dict] = {}
    try:
        raw = gitlab_client.get_issue_links(iid, project_id)
        for link in raw:
            issue = link.get("issue") or link
            labels = issue.get("labels", [])
            status = next((lb[8:] for lb in labels if lb.startswith("status::")), "open")
            target = issue.get("iid")
            if target:
                gitlab_links[target] = {
                    "id": link.get("id"),
                    "link_type": link.get("link_type", "relates_to"),
                    "target_iid": target,
                    "title": issue.get("title"),
                    "state": issue.get("state"),
                    "status": status,
                    "web_url": issue.get("web_url"),
                    "source": "gitlab",
                }
    except Exception as e:
        logger.warning("Failed to fetch GitLab links for #%s: %s", iid, e)

    # 2) Local DB links (source or target matching iid)
    db_rows = db.query(TicketLink).filter(
        TicketLink.project_id == pid,
        (TicketLink.source_iid == iid) | (TicketLink.target_iid == iid),
    ).all()

    result = list(gitlab_links.values())
    seen_iids = set(gitlab_links.keys())

    for row in db_rows:
        # Determine the "other" iid
        other_iid = row.target_iid if row.source_iid == iid else row.source_iid
        effective_type = row.link_type
        if row.target_iid == iid:
            # Reverse the relationship label for display
            if row.link_type == "blocks":
                effective_type = "is_blocked_by"

        if other_iid in seen_iids:
            continue  # already from GitLab
        seen_iids.add(other_iid)

        result.append({
            "id": f"local:{row.id}",
            "link_type": effective_type,
            "target_iid": other_iid,
            "title": f"티켓 #{other_iid}",
            "state": "opened",
            "status": "open",
            "web_url": None,
            "source": "local",
        })

    if _r:
        try:
            _r.setex(_cache_key, _LINKS_CACHE_TTL, json.dumps(result))
        except Exception:
            pass
    return result


@links_router.post("/{iid}/links", response_model=dict, status_code=201)
def create_ticket_link(
    iid: int,
    body: CreateLinkBody,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """두 티켓 사이에 관계를 생성한다.
    relates_to: GitLab + 로컬 DB 모두 저장
    blocks / duplicate_of: 로컬 DB에만 저장 (GitLab CE 미지원)"""
    if body.link_type not in _VALID_LINK_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"link_type은 {' | '.join(_VALID_LINK_TYPES)} 중 하나여야 합니다.",
        )

    s = get_settings()
    pid = project_id or body.project_id or str(s.GITLAB_PROJECT_ID)

    # Try GitLab only for supported types
    if body.link_type in _GITLAB_SUPPORTED:
        result = gitlab_client.create_issue_link(
            iid=iid,
            target_iid=body.target_iid,
            link_type=body.link_type,
            project_id=project_id,
            target_project_id=body.target_project_id,
        )
        if result is None:
            logger.warning("GitLab link creation failed for #%s → #%s", iid, body.target_iid)
            # Fall through — still write to local DB

    # Always write to local DB
    existing = db.query(TicketLink).filter(
        TicketLink.source_iid == iid,
        TicketLink.target_iid == body.target_iid,
        TicketLink.project_id == pid,
    ).first()
    if not existing:
        db.add(TicketLink(
            source_iid=iid,
            target_iid=body.target_iid,
            project_id=pid,
            link_type=body.link_type,
            created_by=user.get("username", "unknown"),
        ))
        db.commit()

    # 캐시 무효화
    _r = get_redis()
    if _r:
        try:
            _r.delete(f"links:{pid}:{iid}", f"links:{pid}:{body.target_iid}")
        except Exception:
            pass

    return {"ok": True}


@links_router.delete("/{iid}/links/{link_id}", status_code=204)
def delete_ticket_link(
    iid: int,
    link_id: str,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """이슈 관계를 제거한다."""
    s = get_settings()
    pid = project_id or str(s.GITLAB_PROJECT_ID)

    if str(link_id).startswith("local:"):
        # Local DB only
        local_id = int(str(link_id).split(":", 1)[1])
        row = db.query(TicketLink).filter(TicketLink.id == local_id).first()
        if row:
            db.delete(row)
            db.commit()
    else:
        # GitLab link
        try:
            lid = int(link_id)
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="link_id가 올바르지 않습니다.")

        ok = gitlab_client.delete_issue_link(iid, lid, project_id)
        if not ok:
            raise HTTPException(status_code=502, detail="GitLab 이슈 링크 삭제에 실패했습니다.")

        # Also clean up local DB if exists
        row = db.query(TicketLink).filter(
            TicketLink.source_iid == iid,
            TicketLink.project_id == pid,
        ).first()
        if row:
            db.delete(row)
            db.commit()

    # 캐시 무효화
    _rd = get_redis()
    if _rd:
        try:
            _rd.delete(f"links:{pid}:{iid}")
        except Exception:
            pass
