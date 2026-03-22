"""Ticket custom field value endpoints — GET / PUT /{iid}/custom-fields."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ...auth import get_current_user
from ...audit import write_audit_log
from ...config import get_settings
from ...database import get_db
from ...models import CustomFieldDef, TicketCustomValue

logger = logging.getLogger(__name__)

custom_fields_router = APIRouter()


@custom_fields_router.get("/{iid}/custom-fields", response_model=list[dict])
def get_ticket_custom_fields(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓의 커스텀 필드 정의 + 값을 합쳐서 반환."""
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    fields = (
        db.query(CustomFieldDef)
        .filter(CustomFieldDef.enabled == True)  # noqa: E712
        .order_by(CustomFieldDef.sort_order, CustomFieldDef.id)
        .all()
    )
    values = {
        v.field_id: v.value
        for v in db.query(TicketCustomValue).filter(
            TicketCustomValue.gitlab_issue_iid == iid,
            TicketCustomValue.project_id == str(pid),
        ).all()
    }
    return [
        {
            "id": f.id,
            "name": f.name,
            "label": f.label,
            "field_type": f.field_type,
            "options": f.options or [],
            "required": f.required,
            "value": values.get(f.id),
        }
        for f in fields
    ]


@custom_fields_router.put("/{iid}/custom-fields", response_model=list[dict])
def set_ticket_custom_fields(
    request: Request,
    iid: int,
    body: dict,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓 커스텀 필드 값을 일괄 저장. body: {field_id: value, ...}"""
    pid = str(project_id or get_settings().GITLAB_PROJECT_ID)

    field_defs = {f.id: f for f in db.query(CustomFieldDef).filter(CustomFieldDef.enabled == True).all()}  # noqa: E712
    field_ids = set(field_defs.keys())

    # 수정할 field_id 목록 추출 (유효한 것만)
    updates: dict[int, object] = {}
    for field_id_str, value in body.items():
        try:
            fid = int(field_id_str)
        except (ValueError, TypeError):
            continue
        if fid not in field_ids:
            continue
        fdef = field_defs[fid]
        if value is not None:
            if fdef.field_type == "number":
                try:
                    float(value)
                except (ValueError, TypeError):
                    raise HTTPException(status_code=400, detail=f"필드 '{fdef.label}'은(는) 숫자여야 합니다.")
            elif fdef.field_type == "checkbox":
                if not isinstance(value, bool) and str(value).lower() not in ("true", "false", "1", "0"):
                    raise HTTPException(status_code=400, detail=f"필드 '{fdef.label}'은(는) 체크박스(true/false)여야 합니다.")
            elif fdef.field_type == "select" and fdef.options:
                if str(value) not in fdef.options:
                    raise HTTPException(status_code=400, detail=f"필드 '{fdef.label}'의 값이 허용된 옵션 목록에 없습니다.")
        updates[fid] = value

    if updates:
        # N+1 방지: 해당 티켓의 기존 값을 한 번에 SELECT FOR UPDATE
        existing_rows = {
            r.field_id: r
            for r in db.query(TicketCustomValue).filter(
                TicketCustomValue.gitlab_issue_iid == iid,
                TicketCustomValue.project_id == pid,
                TicketCustomValue.field_id.in_(list(updates.keys())),
            ).with_for_update().all()
        }
        for fid, value in updates.items():
            str_val = str(value) if value is not None else None
            if fid in existing_rows:
                existing_rows[fid].value = str_val
            else:
                db.add(TicketCustomValue(
                    gitlab_issue_iid=iid,
                    project_id=pid,
                    field_id=fid,
                    value=str_val,
                ))
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Custom fields update failed for ticket #%d: %s", iid, e)
        raise HTTPException(status_code=500, detail="내부 오류가 발생했습니다.")
    write_audit_log(db, user, "ticket.custom_fields.update", "ticket", str(iid), request=request)

    return get_ticket_custom_fields(iid=iid, project_id=pid, _user=user, db=db)
