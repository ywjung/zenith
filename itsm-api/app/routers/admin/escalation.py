"""Admin escalation policy endpoints."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import EscalationPolicy, EscalationRecord
from ...rbac import require_admin

escalation_router = APIRouter()

_VALID_NOTIFICATION_CHANNELS = {"email", "slack", "telegram", "webhook"}


class EscalationPolicyCreate(BaseModel):
    name: str
    priority: Optional[str] = None   # None = 전체 우선순위 적용
    trigger: str                      # "warning" | "breach"
    delay_minutes: int = Field(default=0, ge=1, le=10080, description="에스컬레이션 간격(분), 최소 1분 최대 1주일")
    action: str                       # "notify" | "reassign" | "upgrade_priority"
    target_user_id: Optional[str] = None
    target_user_name: Optional[str] = None
    notify_email: Optional[str] = None
    notification_channel: Optional[str] = None
    enabled: bool = True

    @field_validator("notification_channel")
    @classmethod
    def validate_notification_channel(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_NOTIFICATION_CHANNELS:
            raise ValueError(f"허용된 채널: {', '.join(sorted(_VALID_NOTIFICATION_CHANNELS))}")
        return v


class EscalationPolicyResponse(BaseModel):
    id: int
    name: str
    priority: Optional[str]
    trigger: str
    delay_minutes: int
    action: str
    target_user_id: Optional[str]
    target_user_name: Optional[str]
    notify_email: Optional[str]
    enabled: bool
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@escalation_router.get("/escalation-policies", response_model=list[EscalationPolicyResponse])
def list_escalation_policies(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 목록 조회."""
    return db.query(EscalationPolicy).order_by(EscalationPolicy.id).all()


@escalation_router.post("/escalation-policies", response_model=EscalationPolicyResponse, status_code=201)
def create_escalation_policy(
    body: EscalationPolicyCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 생성."""
    valid_triggers = {"warning", "breach"}
    valid_actions = {"notify", "reassign", "upgrade_priority"}
    if body.trigger not in valid_triggers:
        raise HTTPException(400, f"trigger는 {valid_triggers} 중 하나여야 합니다.")
    if body.action not in valid_actions:
        raise HTTPException(400, f"action은 {valid_actions} 중 하나여야 합니다.")
    if body.action == "reassign" and not body.target_user_id:
        raise HTTPException(400, "reassign 액션은 target_user_id가 필요합니다.")

    policy = EscalationPolicy(**body.model_dump(exclude={"notification_channel"}), created_by=user["username"])
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@escalation_router.put("/escalation-policies/{policy_id}", response_model=EscalationPolicyResponse)
def update_escalation_policy(
    policy_id: int,
    body: EscalationPolicyCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 수정."""
    policy = db.query(EscalationPolicy).filter(EscalationPolicy.id == policy_id).with_for_update().first()
    if not policy:
        raise HTTPException(404, "정책을 찾을 수 없습니다.")
    for key, val in body.model_dump().items():
        setattr(policy, key, val)
    db.commit()
    db.refresh(policy)
    return policy


@escalation_router.delete("/escalation-policies/{policy_id}", status_code=204)
def delete_escalation_policy(
    request: Request,
    policy_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 삭제 (실행 기록도 함께 삭제)."""
    from ...routers.auth import verify_sudo_token  # HIGH-03
    verify_sudo_token(request, user, db)
    policy = db.query(EscalationPolicy).filter(EscalationPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(404, "정책을 찾을 수 없습니다.")
    db.query(EscalationRecord).filter(EscalationRecord.policy_id == policy_id).delete()
    db.delete(policy)
    db.commit()
