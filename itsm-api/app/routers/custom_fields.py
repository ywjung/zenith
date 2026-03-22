"""커스텀 필드 관리 라우터."""
import re
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..auth import get_current_user
from ..database import get_db
from ..models import CustomFieldDef, TicketCustomValue
from ..rbac import require_admin

logger = logging.getLogger(__name__)

_NAME_RE = re.compile(r'^[a-z][a-z0-9_]{0,98}$')

admin_router = APIRouter(prefix="/admin/custom-fields", tags=["custom-fields"])
ticket_router = APIRouter(tags=["custom-fields"])


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _field_to_dict(f: CustomFieldDef) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "label": f.label,
        "field_type": f.field_type,
        "options": f.options or [],
        "required": f.required,
        "enabled": f.enabled,
        "sort_order": f.sort_order,
        "created_by": f.created_by,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------

class FieldCreate(BaseModel):
    name: str
    label: str
    field_type: str = "text"
    options: list[str] = []
    required: bool = False
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("name은 소문자·숫자·_만 허용하며 소문자로 시작해야 합니다.")
        return v

    @field_validator("field_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in ("text", "number", "select", "checkbox"):
            raise ValueError("field_type: text|number|select|checkbox 중 하나")
        return v


class FieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None

    @field_validator("field_type")
    @classmethod
    def validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("text", "number", "select", "checkbox"):
            raise ValueError("field_type: text|number|select|checkbox 중 하나")
        return v


@admin_router.get("")
def list_fields(
    include_disabled: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = db.query(CustomFieldDef)
    if not include_disabled:
        q = q.filter(CustomFieldDef.enabled == True)  # noqa: E712
    return [_field_to_dict(f) for f in q.order_by(CustomFieldDef.sort_order, CustomFieldDef.id).all()]


@admin_router.post("", status_code=201)
def create_field(
    body: FieldCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    if db.query(CustomFieldDef).filter(CustomFieldDef.name == body.name).first():
        raise HTTPException(status_code=409, detail=f"이미 존재하는 필드 키입니다: {body.name}")
    f = CustomFieldDef(
        name=body.name,
        label=body.label,
        field_type=body.field_type,
        options=body.options,
        required=body.required,
        sort_order=body.sort_order,
        created_by=user.get("username", "unknown"),
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _field_to_dict(f)


@admin_router.patch("/{field_id}")
def update_field(
    field_id: int,
    body: FieldUpdate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    f = db.query(CustomFieldDef).filter(CustomFieldDef.id == field_id).with_for_update().first()
    if not f:
        raise HTTPException(status_code=404, detail="커스텀 필드를 찾을 수 없습니다.")
    for key, val in body.model_dump(exclude_none=True).items():
        setattr(f, key, val)
    db.commit()
    db.refresh(f)
    return _field_to_dict(f)


@admin_router.delete("/{field_id}", status_code=204)
def delete_field(
    field_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    f = db.query(CustomFieldDef).filter(CustomFieldDef.id == field_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="커스텀 필드를 찾을 수 없습니다.")
    # 연관 값도 함께 삭제
    db.query(TicketCustomValue).filter(TicketCustomValue.field_id == field_id).delete(synchronize_session=False)
    db.delete(f)
    db.commit()


# ---------------------------------------------------------------------------
# Ticket custom field values (GET/PUT per ticket)
# ---------------------------------------------------------------------------

@ticket_router.get("/tickets/{iid}/custom-fields")
def get_ticket_custom_fields(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓의 커스텀 필드 값 목록 반환 (정의된 필드 포함, 미설정 값은 null)."""
    from ..config import get_settings
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)

    active_fields = (
        db.query(CustomFieldDef)
        .filter(CustomFieldDef.enabled == True)  # noqa: E712
        .order_by(CustomFieldDef.sort_order, CustomFieldDef.id)
        .all()
    )
    values = {
        v.field_id: v.value
        for v in db.query(TicketCustomValue).filter(
            TicketCustomValue.gitlab_issue_iid == iid,
            TicketCustomValue.project_id == pid,
        ).all()
    }
    return [
        {
            "field_id": f.id,
            "name": f.name,
            "label": f.label,
            "field_type": f.field_type,
            "options": f.options or [],
            "required": f.required,
            "value": values.get(f.id),
        }
        for f in active_fields
    ]


@ticket_router.put("/tickets/{iid}/custom-fields")
def set_ticket_custom_fields(
    iid: int,
    values: dict,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 커스텀 필드 값 일괄 저장 (upsert). body = {field_name: value | null}."""
    from ..config import get_settings
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)

    # Build name→id map for active fields
    active_fields = {
        f.name: f
        for f in db.query(CustomFieldDef).filter(CustomFieldDef.enabled == True).all()  # noqa: E712
    }

    saved: list[dict] = []
    for field_name, raw_value in values.items():
        if field_name not in active_fields:
            continue
        fdef = active_fields[field_name]
        str_value = str(raw_value) if raw_value is not None else None

        stmt = (
            pg_insert(TicketCustomValue)
            .values(
                gitlab_issue_iid=iid,
                project_id=pid,
                field_id=fdef.id,
                value=str_value,
            )
            .on_conflict_do_update(
                index_elements=["gitlab_issue_iid", "project_id", "field_id"],
                set_={"value": str_value},
            )
        )
        db.execute(stmt)
        saved.append({"name": field_name, "value": str_value})

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("set_ticket_custom_fields commit error: %s", e)
        raise HTTPException(status_code=500, detail="커스텀 필드 저장 중 오류가 발생했습니다.")

    return saved
