"""티켓 타입 메타데이터 (incident / service_request / change / problem)."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import TicketTypeMeta
from ..rbac import require_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ticket-types", tags=["ticket-types"])

VALID_TYPES = {"incident", "service_request", "change", "problem"}

TYPE_LABELS = {
    "incident": "티켓",
    "service_request": "서비스 요청",
    "change": "변경 요청",
    "problem": "문제",
}


class TicketTypeSet(BaseModel):
    ticket_type: str
    project_id: Optional[str] = None


def _serialize(meta: TicketTypeMeta) -> dict:
    return {
        "ticket_iid": meta.ticket_iid,
        "project_id": meta.project_id,
        "ticket_type": meta.ticket_type,
        "label": TYPE_LABELS.get(meta.ticket_type, meta.ticket_type),
        "updated_by": meta.updated_by,
        "updated_at": meta.updated_at.isoformat() if meta.updated_at else None,
    }


@router.get("/{iid}", response_model=dict)
def get_ticket_type(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..config import get_settings
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid).first()
    if not meta:
        return {
            "ticket_iid": iid,
            "project_id": pid,
            "ticket_type": "incident",
            "label": TYPE_LABELS["incident"],
            "updated_by": None,
            "updated_at": None,
        }
    return _serialize(meta)


@router.put("/{iid}", response_model=dict)
def set_ticket_type(
    iid: int,
    data: TicketTypeSet,
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    if data.ticket_type not in VALID_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid ticket_type. Must be one of: {', '.join(sorted(VALID_TYPES))}",
        )
    from ..config import get_settings
    pid = data.project_id or str(get_settings().GITLAB_PROJECT_ID)
    meta = db.query(TicketTypeMeta).filter_by(ticket_iid=iid, project_id=pid).with_for_update().first()
    if meta:
        meta.ticket_type = data.ticket_type
        meta.updated_by = user["username"]
    else:
        meta = TicketTypeMeta(
            ticket_iid=iid,
            project_id=pid,
            ticket_type=data.ticket_type,
            created_by=user["username"],
            updated_by=user["username"],
        )
        db.add(meta)
    db.commit()
    db.refresh(meta)
    return _serialize(meta)


@router.get("", response_model=list)
def bulk_get_ticket_types(
    ticket_iids: str = Query(..., description="쉼표로 구분된 ticket iid 목록"),
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """여러 티켓의 타입을 한 번에 조회 (목록 페이지 최적화)."""
    from ..config import get_settings
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    try:
        iids = [int(x.strip()) for x in ticket_iids.split(",") if x.strip()][:200]
    except ValueError:
        raise HTTPException(status_code=422, detail="ticket_iids must be comma-separated integers")

    metas = db.query(TicketTypeMeta).filter(
        TicketTypeMeta.ticket_iid.in_(iids),
        TicketTypeMeta.project_id == pid,
    ).all()
    by_iid = {m.ticket_iid: m.ticket_type for m in metas}
    return [
        {
            "ticket_iid": iid,
            "ticket_type": by_iid.get(iid, "incident"),
            "label": TYPE_LABELS.get(by_iid.get(iid, "incident"), "incident"),
        }
        for iid in iids
    ]
