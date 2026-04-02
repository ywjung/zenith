"""Admin Failed Notifications router — 알림 최종 실패 기록 관리."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import FailedNotification
from ...rbac import require_admin

logger = logging.getLogger(__name__)

failed_notifications_router = APIRouter(
    prefix="/failed-notifications",
    tags=["admin-failed-notifications"],
)


@failed_notifications_router.get("")
def list_failed_notifications(
    resolved: bool = False,
    skip: int = 0,
    limit: int = 50,
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """실패 알림 목록 조회 (resolved=false 기본, 페이지네이션 지원)."""
    limit = min(limit, 200)
    query = db.query(FailedNotification).filter(
        FailedNotification.resolved == resolved
    )
    total = query.count()
    items = (
        query
        .order_by(FailedNotification.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": item.id,
                "task_name": item.task_name,
                "task_id": item.task_id,
                "payload": item.payload,
                "error_message": item.error_message,
                "retry_count": item.retry_count,
                "resolved": item.resolved,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in items
        ],
    }


@failed_notifications_router.post("/{item_id}/resolve")
def resolve_failed_notification(
    item_id: int,
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """실패 알림 확인(resolved) 처리."""
    record = db.query(FailedNotification).filter(FailedNotification.id == item_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")
    if record.resolved:
        return {"id": item_id, "resolved": True}
    record.resolved = True
    db.commit()
    logger.info("FailedNotification resolved | id=%d admin=%s", item_id, _user.get("username"))
    return {"id": item_id, "resolved": True}


@failed_notifications_router.delete("/{item_id}", status_code=204)
def delete_failed_notification(
    item_id: int,
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """실패 알림 기록 삭제."""
    record = db.query(FailedNotification).filter(FailedNotification.id == item_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")
    db.delete(record)
    db.commit()
    logger.info("FailedNotification deleted | id=%d admin=%s", item_id, _user.get("username"))
