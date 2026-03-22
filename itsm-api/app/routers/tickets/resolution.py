"""Ticket resolution note endpoints."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import get_current_user
from ...config import get_settings
from ...database import get_db
from ... import gitlab_client
from ...rbac import require_pl

logger = logging.getLogger(__name__)

resolution_router = APIRouter()


@resolution_router.get("/{iid}/resolution", response_model=dict)
def get_resolution_note(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 해결 노트 조회."""
    from ...models import ResolutionNote
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    rn = (
        db.query(ResolutionNote)
        .filter(ResolutionNote.ticket_iid == iid, ResolutionNote.project_id == pid)
        .order_by(ResolutionNote.created_at.desc())
        .first()
    )
    if not rn:
        return {}
    return {
        "id": rn.id, "note": rn.note, "resolution_type": rn.resolution_type,
        "created_by_name": rn.created_by_name, "created_at": rn.created_at.isoformat() if rn.created_at else None,
        "kb_article_id": rn.kb_article_id,
    }


@resolution_router.post("/{iid}/resolution/convert-to-kb", response_model=dict, status_code=201)
def convert_resolution_to_kb(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_pl),
):
    """해결 노트를 KB 아티클 초안으로 변환."""
    from ...models import ResolutionNote, KBArticle
    import re as _re
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    rn = (
        db.query(ResolutionNote)
        .filter(ResolutionNote.ticket_iid == iid, ResolutionNote.project_id == pid)
        .order_by(ResolutionNote.created_at.desc())
        .first()
    )
    if not rn:
        raise HTTPException(status_code=404, detail="해결 노트가 없습니다. 먼저 해결 노트를 작성하세요.")
    if rn.kb_article_id:
        raise HTTPException(status_code=409, detail=f"이미 KB 아티클(id={rn.kb_article_id})로 변환됐습니다.")

    # 이슈 제목으로 KB 슬러그 생성
    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
        original_title = issue.get("title", f"티켓 #{iid} 해결 방법")
    except Exception:
        original_title = f"티켓 #{iid} 해결 방법"

    base_slug = _re.sub(r"[^\w\s-]", "", original_title.lower())
    base_slug = _re.sub(r"[\s_-]+", "-", base_slug).strip("-")[:100] or f"ticket-{iid}-solution"

    # 슬러그 유일성 확보
    slug = base_slug
    counter = 1
    while db.query(KBArticle).filter(KBArticle.slug == slug).first():
        slug = f"{base_slug}-{counter}"; counter += 1

    article = KBArticle(
        title=f"[해결 사례] {original_title}",
        slug=slug,
        content=f"## 증상\n\n티켓 #{iid}에서 보고된 문제입니다.\n\n## 해결 방법\n\n{rn.note}",
        author_id=str(user.get("sub", "")),
        author_name=user.get("name", user.get("username", "")),
        published=False,  # 초안으로 생성
        tags=[],
    )
    try:
        db.add(article)
        db.flush()
        rn.kb_article_id = article.id
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("KB article creation failed for ticket #%d: %s", iid, e)
        raise HTTPException(status_code=500, detail="내부 오류가 발생했습니다.")
    db.refresh(article)

    logger.info("Ticket #%d resolution note converted to KB article id=%d (draft)", iid, article.id)
    return {"kb_article_id": article.id, "slug": article.slug, "title": article.title}
