"""Comments and timeline endpoints."""
import json as _json
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth import get_current_user
from ...config import get_settings
from ...database import get_db
from ... import gitlab_client
from ... import sla as sla_module
from ...models import AuditLog
from ...notifications import notify_comment_added, create_db_notification
from ...schemas import CommentCreate
from ...redis_client import get_redis as _get_redis
from .helpers import (
    _dispatch_notification,
    _issue_to_response,
    _sanitize_comment,
    user_limiter,
    LIMIT_COMMENT,
)

logger = logging.getLogger(__name__)

comments_router = APIRouter()


@comments_router.post("/{iid}/comments", response_model=dict, status_code=201)
@(user_limiter.limit(LIMIT_COMMENT) if user_limiter else lambda f: f)
def add_comment(
    request: Request,
    iid: int,
    data: CommentCreate,
    background_tasks: BackgroundTasks,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # S-9: 비밀 스캐닝 — 댓글 내용 검사 (경고만)
    from ...secret_scanner import check_and_warn as _secret_check
    from ...pii_masker import check_and_warn as _pii_check
    _secret_check(data.body, context=f"ticket.comment.{iid}", actor=user.get("username", "?"))
    _pii_check(data.body, context=f"ticket.comment.{iid}")

    if data.internal:
        role = user.get("role", "user")
        from ...rbac import ROLE_LEVELS
        if ROLE_LEVELS.get(role, 0) < ROLE_LEVELS["developer"]:
            raise HTTPException(status_code=403, detail="내부 메모는 IT 개발자 이상만 작성할 수 있습니다.")

    gitlab_token = user.get("gitlab_token")
    if not gitlab_token:
        raise HTTPException(
            status_code=401,
            detail="GitLab 세션이 만료됐습니다. 다시 로그인해 주세요.",
        )

    sanitized_body = _sanitize_comment(data.body)

    try:
        note = gitlab_client.add_note(
            iid, sanitized_body,
            project_id=project_id,
            confidential=data.internal,
            gitlab_token=gitlab_token,
        )
    except Exception as e:
        logger.error("GitLab add_note %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="댓글 추가 중 오류가 발생했습니다.")

    pid = project_id or get_settings().GITLAB_PROJECT_ID
    role = user.get("role", "user")
    from ...rbac import ROLE_LEVELS
    if ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["developer"]:
        sla_module.mark_first_response(db, iid, pid)

    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
        ticket = _issue_to_response(issue)
        _author = user.get("name", user.get("username", ""))
        from ...tasks import send_comment_notification
        _dispatch_notification(
            background_tasks, send_comment_notification, notify_comment_added,
            ticket, data.body, _author, data.internal,
        )
    except Exception as e:
        logger.warning("Failed to fetch ticket for comment notification on ticket %d: %s", iid, e)

    try:
        import re as _re
        from ...database import SessionLocal as _SL
        from ...models import UserRole as _UserRole
        _USERNAME_RE = _re.compile(r'^[a-zA-Z0-9_.\-]{1,100}$')
        raw_mentions = _re.findall(r'data-id="([^"]{1,100})"', data.body)
        mentioned_usernames = list({u for u in raw_mentions if _USERNAME_RE.match(u)})
        if mentioned_usernames:
            actor_username = user.get("username", "")
            actor_id = str(user.get("sub", ""))
            targets = [u for u in mentioned_usernames if u != actor_username]
            if targets:
                with _SL() as _db:
                    user_roles = _db.query(_UserRole).filter(
                        _UserRole.username.in_(targets)
                    ).all()
                    for ur in user_roles:
                        recipient_id = str(ur.gitlab_user_id)
                        if recipient_id != actor_id:
                            create_db_notification(
                                _db,
                                recipient_id=recipient_id,
                                title=f"티켓 #{iid}에서 멘션됨",
                                body=f"{user.get('name', actor_username)}님이 댓글에서 @{ur.username}을 멘션했습니다.",
                                link=f"/tickets/{iid}",
                                dedup_key=f"mention:{iid}:{note['id']}",
                                dedup_ttl=300,
                            )
                    _db.commit()
    except Exception as _e:
        logger.warning("@mention notification error on ticket #%d: %s", iid, _e)

    return {
        "id": note["id"],
        "body": note["body"],
        "author_name": note["author"]["name"],
        "author_avatar": note["author"].get("avatar_url"),
        "created_at": note["created_at"],
        "internal": note.get("confidential", False),
    }


class CommentUpdate(BaseModel):
    body: str


@comments_router.put("/{iid}/comments/{note_id}", response_model=dict)
def update_comment(
    iid: int,
    note_id: int,
    data: CommentUpdate,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """댓글 수정 — 작성자 본인 또는 관리자만 가능."""
    gitlab_token = user.get("gitlab_token")
    if not gitlab_token:
        raise HTTPException(status_code=401, detail="GitLab 세션이 만료됐습니다. 다시 로그인해 주세요.")

    sanitized_body = _sanitize_comment(data.body)
    try:
        note = gitlab_client.update_note(iid, note_id, sanitized_body, project_id=project_id, gitlab_token=gitlab_token)
    except Exception as e:
        logger.error("GitLab update_note %d/#%d error: %s", note_id, iid, e)
        raise HTTPException(status_code=502, detail="댓글 수정 중 오류가 발생했습니다.")

    # 타임라인 캐시 무효화
    _r = _get_redis()
    if _r:
        pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
        try:
            _r.delete(f"itsm:timeline:{pid}:{iid}")
        except Exception:
            pass

    return {
        "id": note["id"],
        "body": note["body"],
        "author_name": note["author"]["name"],
        "author_avatar": note["author"].get("avatar_url"),
        "created_at": note["created_at"],
        "updated_at": note.get("updated_at"),
        "internal": note.get("confidential", False),
    }


@comments_router.delete("/{iid}/comments/{note_id}", status_code=204)
def delete_comment(
    iid: int,
    note_id: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """댓글 삭제 — 작성자 본인 또는 관리자만 가능."""
    gitlab_token = user.get("gitlab_token")
    if not gitlab_token:
        raise HTTPException(status_code=401, detail="GitLab 세션이 만료됐습니다. 다시 로그인해 주세요.")

    try:
        gitlab_client.delete_note(iid, note_id, project_id=project_id, gitlab_token=gitlab_token)
    except Exception as e:
        logger.error("GitLab delete_note %d/#%d error: %s", note_id, iid, e)
        raise HTTPException(status_code=502, detail="댓글 삭제 중 오류가 발생했습니다.")

    # 타임라인 캐시 무효화
    _r = _get_redis()
    if _r:
        pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
        try:
            _r.delete(f"itsm:timeline:{pid}:{iid}")
        except Exception:
            pass


@comments_router.get("/{iid}/comments", response_model=list[dict])
def get_comments(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    try:
        notes = gitlab_client.get_notes(iid, project_id=project_id)
        return [
            {
                "id": n["id"],
                "body": n["body"],
                "author_name": n["author"]["name"],
                "author_avatar": n["author"].get("avatar_url"),
                "created_at": n["created_at"],
                "internal": n.get("confidential", False),
            }
            for n in notes
            if not n.get("system", False)
        ]
    except Exception as e:
        logger.error("GitLab get_comments %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="댓글 조회 중 오류가 발생했습니다.")


@comments_router.get("/{iid}/timeline", response_model=list[dict])
def get_timeline(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """댓글 + 감사로그 + GitLab 시스템 노트를 시간순으로 병합한 타임라인."""
    import json as _json
    from ...config import get_settings as _gs

    _pid = project_id or str(_gs().GITLAB_PROJECT_ID)
    _cache_key = f"itsm:timeline:{_pid}:{iid}"
    _TTL = 60

    _r = _get_redis()
    try:
        if _r:
            _cached = _r.get(_cache_key)
            if _cached:
                return _json.loads(_cached)
    except Exception as _re:
        logger.warning("Timeline #%d: Redis error: %s", iid, _re)
        _r = None

    events: list[dict] = []

    try:
        notes = gitlab_client.get_notes(iid, project_id=project_id)
        for n in notes:
            if n.get("system", False):
                events.append({
                    "type": "system",
                    "id": f"gl-sys-{n['id']}",
                    "body": n["body"],
                    "author_name": n["author"]["name"],
                    "author_avatar": n["author"].get("avatar_url"),
                    "created_at": n["created_at"],
                })
            else:
                events.append({
                    "type": "comment",
                    "id": f"gl-{n['id']}",
                    "body": n["body"],
                    "author_name": n["author"]["name"],
                    "author_avatar": n["author"].get("avatar_url"),
                    "created_at": n["created_at"],
                    "internal": n.get("confidential", False),
                })
    except Exception as e:
        logger.warning("Timeline: GitLab notes error for #%d: %s", iid, e)

    try:
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.resource_type == "ticket", AuditLog.resource_id == str(iid))
            .order_by(AuditLog.created_at)
            .limit(200)
            .all()
        )
        for log in logs:
            events.append({
                "type": "audit",
                "id": f"audit-{log.id}",
                "action": log.action,
                "actor_name": log.actor_name or log.actor_username,
                "actor_username": log.actor_username,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            })
    except Exception as e:
        logger.warning("Timeline: audit log error for #%d: %s", iid, e)

    def _sort_key(e: dict) -> str:
        return e.get("created_at") or ""

    events.sort(key=_sort_key)

    try:
        if _r:
            _r.setex(_cache_key, _TTL, _json.dumps(events, default=str))
    except Exception as _ce:
        logger.warning("Timeline #%d: cache save failed: %s", iid, _ce)

    return events
