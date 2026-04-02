"""반복 티켓 관리 API."""
from datetime import datetime, timezone
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import RecurringTicket
from ...rbac import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/recurring-tickets", tags=["recurring-tickets"])

VALID_CATEGORIES = {"hardware", "software", "network", "account", "other"}
VALID_PRIORITIES = {"critical", "high", "medium", "low"}


class RecurringTicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str = "other"
    priority: str = "medium"
    project_id: str
    assignee_id: Optional[int] = None
    cron_expr: str
    cron_label: Optional[str] = None
    is_active: bool = True

    @field_validator("cron_expr")
    @classmethod
    def validate_cron(cls, v: str) -> str:
        try:
            from croniter import croniter
            if not croniter.is_valid(v):
                raise ValueError("유효하지 않은 cron 표현식입니다.")
        except ImportError:
            pass
        return v

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        if v not in VALID_CATEGORIES:
            raise ValueError(f"category는 {VALID_CATEGORIES} 중 하나여야 합니다.")
        return v


class RecurringTicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    cron_expr: Optional[str] = None
    cron_label: Optional[str] = None
    is_active: Optional[bool] = None


def _serialize(rt: RecurringTicket) -> dict:
    return {
        "id": rt.id,
        "title": rt.title,
        "description": rt.description,
        "category": rt.category,
        "priority": rt.priority,
        "project_id": rt.project_id,
        "assignee_id": rt.assignee_id,
        "cron_expr": rt.cron_expr,
        "cron_label": rt.cron_label,
        "is_active": rt.is_active,
        "last_run_at": rt.last_run_at.isoformat() if rt.last_run_at else None,
        "next_run_at": rt.next_run_at.isoformat() if rt.next_run_at else None,
        "created_by": rt.created_by,
        "created_at": rt.created_at.isoformat() if rt.created_at else None,
    }


@router.get("", response_model=list)
def list_recurring_tickets(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rows = db.query(RecurringTicket).order_by(RecurringTicket.id.desc()).all()
    return [_serialize(r) for r in rows]


@router.post("", response_model=dict, status_code=201)
def create_recurring_ticket(
    body: RecurringTicketCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    # compute next_run_at
    next_run = None
    try:
        from croniter import croniter
        it = croniter(body.cron_expr, datetime.now(timezone.utc))
        next_run = it.get_next(datetime).replace(tzinfo=timezone.utc)
    except Exception:
        pass

    rt = RecurringTicket(
        title=body.title,
        description=body.description,
        category=body.category,
        priority=body.priority,
        project_id=body.project_id,
        assignee_id=body.assignee_id,
        cron_expr=body.cron_expr,
        cron_label=body.cron_label,
        is_active=body.is_active,
        next_run_at=next_run,
        created_by=user.get("username", "unknown"),
    )
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return _serialize(rt)


@router.patch("/{rt_id}", response_model=dict)
def update_recurring_ticket(
    rt_id: int,
    body: RecurringTicketUpdate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rt = db.query(RecurringTicket).filter(RecurringTicket.id == rt_id).first()
    if not rt:
        raise HTTPException(status_code=404, detail="반복 티켓을 찾을 수 없습니다.")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rt, field, value)

    if body.cron_expr:
        try:
            from croniter import croniter
            it = croniter(body.cron_expr, datetime.now(timezone.utc))
            rt.next_run_at = it.get_next(datetime).replace(tzinfo=timezone.utc)
        except Exception:
            pass

    db.commit()
    db.refresh(rt)
    return _serialize(rt)


@router.delete("/{rt_id}", status_code=204)
def delete_recurring_ticket(
    rt_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rt = db.query(RecurringTicket).filter(RecurringTicket.id == rt_id).first()
    if not rt:
        raise HTTPException(status_code=404, detail="반복 티켓을 찾을 수 없습니다.")
    db.delete(rt)
    db.commit()


@router.post("/{rt_id}/run-now", response_model=dict)
def run_recurring_ticket_now(
    rt_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """즉시 실행 (테스트용)."""
    rt = db.query(RecurringTicket).filter(RecurringTicket.id == rt_id).first()
    if not rt:
        raise HTTPException(status_code=404, detail="반복 티켓을 찾을 수 없습니다.")

    from ...tasks import periodic_create_recurring_tickets
    periodic_create_recurring_tickets.apply_async()
    return {"ok": True, "message": "Celery 태스크가 큐에 추가되었습니다."}
