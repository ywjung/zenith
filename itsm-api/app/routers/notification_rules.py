"""사용자 커스텀 알림 규칙 CRUD."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import UserNotificationRule

router = APIRouter(prefix="/notification-rules", tags=["notification-rules"])


class RuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    enabled: bool = True
    match_priorities: list[str] = []
    match_categories: list[str] = []
    match_states: list[str] = []
    match_sla_warning: bool = False
    notify_in_app: bool = True
    notify_email: bool = False
    notify_push: bool = False


class RuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    enabled: Optional[bool] = None
    match_priorities: Optional[list[str]] = None
    match_categories: Optional[list[str]] = None
    match_states: Optional[list[str]] = None
    match_sla_warning: Optional[bool] = None
    notify_in_app: Optional[bool] = None
    notify_email: Optional[bool] = None
    notify_push: Optional[bool] = None


def _to_dict(r: UserNotificationRule) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "enabled": r.enabled,
        "match_priorities": r.match_priorities or [],
        "match_categories": r.match_categories or [],
        "match_states": r.match_states or [],
        "match_sla_warning": r.match_sla_warning,
        "notify_in_app": r.notify_in_app,
        "notify_email": r.notify_email,
        "notify_push": r.notify_push,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/", response_model=dict)
def list_rules(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rules = (
        db.query(UserNotificationRule)
        .filter_by(username=user["username"])
        .order_by(UserNotificationRule.id)
        .all()
    )
    return {"rules": [_to_dict(r) for r in rules]}


@router.post("/", response_model=dict, status_code=201)
def create_rule(
    data: RuleCreate,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count = db.query(UserNotificationRule).filter_by(username=user["username"]).count()
    if count >= 20:
        raise HTTPException(status_code=400, detail="알림 규칙은 최대 20개까지 생성할 수 있습니다.")
    rule = UserNotificationRule(
        username=user["username"],
        **data.model_dump(),
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _to_dict(rule)


@router.patch("/{rule_id}", response_model=dict)
def update_rule(
    rule_id: int,
    data: RuleUpdate,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.query(UserNotificationRule).filter_by(
        id=rule_id, username=user["username"]
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return _to_dict(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.query(UserNotificationRule).filter_by(
        id=rule_id, username=user["username"]
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    db.delete(rule)
    db.commit()
