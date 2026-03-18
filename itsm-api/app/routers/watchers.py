"""Ticket watcher (subscription) endpoints."""
import logging
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..auth import get_current_user
from ..database import get_db
from ..models import TicketWatcher
from ..config import get_settings

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')


def _validate_email(email: str) -> str:
    """이메일 형식을 검증하고 소문자로 정규화한다."""
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="유효하지 않은 이메일 주소")
    return email.lower()


router = APIRouter(prefix="/tickets", tags=["watchers"])
# 내 구독 목록은 /notifications 아래에 별도 라우터로 등록
my_router = APIRouter(prefix="/notifications", tags=["watchers"])


@router.get("/{iid}/watchers")
def list_watchers(
    iid: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    settings = get_settings()
    project_id = str(settings.GITLAB_PROJECT_ID)
    watchers = (
        db.query(TicketWatcher)
        .filter(TicketWatcher.ticket_iid == iid, TicketWatcher.project_id == project_id)
        .all()
    )
    return [_to_dict(w) for w in watchers]


@router.post("/{iid}/watch", status_code=201)
def watch_ticket(
    iid: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    settings = get_settings()
    project_id = str(settings.GITLAB_PROJECT_ID)
    user_id = str(user.get("sub", ""))

    existing = (
        db.query(TicketWatcher)
        .filter(
            TicketWatcher.ticket_iid == iid,
            TicketWatcher.project_id == project_id,
            TicketWatcher.user_id == user_id,
        )
        .first()
    )
    if existing:
        return _to_dict(existing)

    watcher = TicketWatcher(
        ticket_iid=iid,
        project_id=project_id,
        user_id=user_id,
        user_email=_validate_email(user.get("email", "")),
        user_name=user.get("name", user.get("username", "")),
    )
    try:
        db.add(watcher)
        db.commit()
        db.refresh(watcher)
    except IntegrityError:
        db.rollback()
        watcher = (
            db.query(TicketWatcher)
            .filter(
                TicketWatcher.ticket_iid == iid,
                TicketWatcher.project_id == project_id,
                TicketWatcher.user_id == user_id,
            )
            .first()
        )
    return _to_dict(watcher)


@router.delete("/{iid}/watch", status_code=204)
def unwatch_ticket(
    iid: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    settings = get_settings()
    project_id = str(settings.GITLAB_PROJECT_ID)
    user_id = str(user.get("sub", ""))

    watcher = (
        db.query(TicketWatcher)
        .filter(
            TicketWatcher.ticket_iid == iid,
            TicketWatcher.project_id == project_id,
            TicketWatcher.user_id == user_id,
        )
        .first()
    )
    if not watcher:
        raise HTTPException(status_code=404, detail="구독 중이지 않습니다.")
    db.delete(watcher)
    db.commit()


@my_router.get("/my-watches")
def list_my_watches(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """내가 구독 중인 티켓 목록 반환 (티켓 기본 정보 포함)."""
    from .. import gitlab_client
    from concurrent.futures import ThreadPoolExecutor, as_completed

    settings = get_settings()
    project_id = str(settings.GITLAB_PROJECT_ID)
    user_id = str(user.get("sub", ""))

    watches = (
        db.query(TicketWatcher)
        .filter(TicketWatcher.user_id == user_id, TicketWatcher.project_id == project_id)
        .order_by(TicketWatcher.created_at.desc())
        .limit(100)
        .all()
    )
    if not watches:
        return []

    # GitLab에서 티켓 기본 정보 병렬 조회
    def _fetch_issue(w: TicketWatcher) -> dict:
        try:
            issue = gitlab_client.get_issue(w.ticket_iid, project_id=project_id)
            labels = issue.get("labels", [])
            status = "closed" if issue.get("state") == "closed" else "open"
            for lbl in labels:
                if lbl.startswith("status::"):
                    status = lbl[8:]
                    break
            priority = "medium"
            for lbl in labels:
                if lbl.startswith("prio::"):
                    raw = lbl[6:]
                    # corrupt 라벨 정규화: PriorityEnum.MEDIUM → medium
                    if "." in raw and raw[0].isupper():
                        raw = raw.split(".")[-1].lower()
                    priority = raw
                    break
            return {
                "watch_id": w.id,
                "ticket_iid": w.ticket_iid,
                "subscribed_at": w.created_at.isoformat() if w.created_at else None,
                "title": issue.get("title", ""),
                "status": status,
                "priority": priority,
                "state": issue.get("state", ""),
                "web_url": issue.get("web_url", ""),
                "assignee_name": (issue.get("assignees") or [{}])[0].get("name") if issue.get("assignees") else None,
                "updated_at": issue.get("updated_at", ""),
                "project_id": project_id,
            }
        except Exception as e:
            logger.warning("my-watches: failed to fetch issue #%d: %s", w.ticket_iid, e)
            return {
                "watch_id": w.id,
                "ticket_iid": w.ticket_iid,
                "subscribed_at": w.created_at.isoformat() if w.created_at else None,
                "title": f"티켓 #{w.ticket_iid}",
                "status": "unknown",
                "priority": "medium",
                "state": "",
                "web_url": "",
                "assignee_name": None,
                "updated_at": "",
                "project_id": project_id,
            }

    results = []
    with ThreadPoolExecutor(max_workers=min(len(watches), 4)) as pool:
        futures = {pool.submit(_fetch_issue, w): w for w in watches}
        for future in as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda x: x["subscribed_at"] or "", reverse=True)
    return results


def _to_dict(w: TicketWatcher) -> dict:
    return {
        "id": w.id,
        "ticket_iid": w.ticket_iid,
        "user_id": w.user_id,
        "user_name": w.user_name,
        "user_email": w.user_email,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }
