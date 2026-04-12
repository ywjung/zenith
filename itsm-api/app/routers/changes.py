"""변경 관리 (Change Management) 라우터 — ITIL RFC 워크플로우."""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import ChangeRequest
from ..notifications import create_db_notification
from ..rbac import require_agent, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/changes", tags=["changes"])

# ── 유효 상태 전이 ──────────────────────────────────────────
VALID_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["submitted", "cancelled"],
    "submitted": ["reviewing", "cancelled"],
    "reviewing": ["approved", "rejected", "cancelled"],
    "approved": ["implementing", "cancelled"],
    "implementing": ["implemented", "failed", "cancelled"],
    # 터미널 상태 — 전이 없음
    "rejected": [],
    "implemented": [],
    "failed": [],
    "cancelled": [],
}

VALID_CHANGE_TYPES = {"standard", "normal", "emergency"}
VALID_RISK_LEVELS = {"low", "medium", "high", "critical"}


def _cr_to_dict(cr: ChangeRequest) -> dict:
    return {
        "id": cr.id,
        "title": cr.title,
        "description": cr.description,
        "change_type": cr.change_type,
        "risk_level": cr.risk_level,
        "status": cr.status,
        "related_ticket_iid": cr.related_ticket_iid,
        "project_id": cr.project_id,
        "scheduled_start_at": cr.scheduled_start_at.isoformat() if cr.scheduled_start_at else None,
        "scheduled_end_at": cr.scheduled_end_at.isoformat() if cr.scheduled_end_at else None,
        "actual_start_at": cr.actual_start_at.isoformat() if cr.actual_start_at else None,
        "actual_end_at": cr.actual_end_at.isoformat() if cr.actual_end_at else None,
        "rollback_plan": cr.rollback_plan,
        "impact": cr.impact,
        "requester_username": cr.requester_username,
        "requester_name": cr.requester_name,
        "approver_username": cr.approver_username,
        "approver_name": cr.approver_name,
        "approved_at": cr.approved_at.isoformat() if cr.approved_at else None,
        "approval_comment": cr.approval_comment,
        "implementer_username": cr.implementer_username,
        "result_note": cr.result_note,
        "created_at": cr.created_at.isoformat() if cr.created_at else None,
        "updated_at": cr.updated_at.isoformat() if cr.updated_at else None,
    }


# ── 요청 스키마 ─────────────────────────────────────────────

class ChangeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=10000)
    change_type: str = "normal"
    risk_level: str = "medium"
    related_ticket_iid: Optional[int] = None
    project_id: str
    scheduled_start_at: Optional[str] = None
    scheduled_end_at: Optional[str] = None
    rollback_plan: Optional[str] = Field(default=None, max_length=10000)
    impact: Optional[str] = Field(default=None, max_length=10000)

    @field_validator("change_type")
    @classmethod
    def validate_change_type(cls, v: str) -> str:
        if v not in VALID_CHANGE_TYPES:
            raise ValueError(f"change_type은 {VALID_CHANGE_TYPES} 중 하나여야 합니다.")
        return v

    @field_validator("risk_level")
    @classmethod
    def validate_risk_level(cls, v: str) -> str:
        if v not in VALID_RISK_LEVELS:
            raise ValueError(f"risk_level은 {VALID_RISK_LEVELS} 중 하나여야 합니다.")
        return v

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, v: str) -> str:
        from ..config import get_settings
        s = get_settings()
        if v != str(s.GITLAB_PROJECT_ID):
            raise ValueError("유효하지 않은 project_id입니다.")
        return v


class ChangeUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=10000)
    change_type: Optional[str] = None
    risk_level: Optional[str] = None
    scheduled_start_at: Optional[str] = None
    scheduled_end_at: Optional[str] = None
    rollback_plan: Optional[str] = Field(default=None, max_length=10000)
    impact: Optional[str] = Field(default=None, max_length=10000)
    implementer_username: Optional[str] = Field(default=None, max_length=100)

    @field_validator("change_type")
    @classmethod
    def validate_change_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CHANGE_TYPES:
            raise ValueError(f"change_type은 {VALID_CHANGE_TYPES} 중 하나여야 합니다.")
        return v

    @field_validator("risk_level")
    @classmethod
    def validate_risk_level(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_RISK_LEVELS:
            raise ValueError(f"risk_level은 {VALID_RISK_LEVELS} 중 하나여야 합니다.")
        return v


class ChangeTransition(BaseModel):
    status: str
    comment: Optional[str] = None  # 승인/반려 시 코멘트, 완료 시 결과 메모


# ── 엔드포인트 ──────────────────────────────────────────────

@router.get("")
def list_changes(
    status: Optional[str] = None,
    change_type: Optional[str] = None,
    risk_level: Optional[str] = None,
    requester_username: Optional[str] = None,
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """변경 요청 목록 조회."""
    role = current_user.get("role", "user")
    q = db.query(ChangeRequest)

    # 일반 사용자는 자신이 요청한 것만 조회
    if role == "user":
        q = q.filter(ChangeRequest.requester_username == current_user.get("username"))
    elif requester_username:
        q = q.filter(ChangeRequest.requester_username == requester_username)

    if status:
        q = q.filter(ChangeRequest.status == status)
    if change_type:
        q = q.filter(ChangeRequest.change_type == change_type)
    if risk_level:
        q = q.filter(ChangeRequest.risk_level == risk_level)

    total = q.count()
    items = q.order_by(ChangeRequest.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {"changes": [_cr_to_dict(c) for c in items], "total": total, "page": page, "per_page": per_page}


@router.post("", status_code=201)
def create_change(
    body: ChangeCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """새 변경 요청 생성 (draft 상태로 시작)."""
    scheduled_start = None
    scheduled_end = None
    if body.scheduled_start_at:
        try:
            scheduled_start = datetime.fromisoformat(body.scheduled_start_at)
        except ValueError:
            raise HTTPException(status_code=422, detail="scheduled_start_at 형식 오류 (ISO 8601)")
    if body.scheduled_end_at:
        try:
            scheduled_end = datetime.fromisoformat(body.scheduled_end_at)
        except ValueError:
            raise HTTPException(status_code=422, detail="scheduled_end_at 형식 오류 (ISO 8601)")
    if scheduled_start and scheduled_end and scheduled_end <= scheduled_start:
        raise HTTPException(status_code=422, detail="종료 예정 시각은 시작 예정 시각 이후여야 합니다.")

    cr = ChangeRequest(
        title=body.title,
        description=body.description,
        change_type=body.change_type,
        risk_level=body.risk_level,
        status="draft",
        related_ticket_iid=body.related_ticket_iid,
        project_id=body.project_id,
        scheduled_start_at=scheduled_start,
        scheduled_end_at=scheduled_end,
        rollback_plan=body.rollback_plan,
        impact=body.impact,
        requester_username=current_user.get("username", ""),
        requester_name=current_user.get("name", ""),
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    logger.info("변경 요청 생성: id=%d title=%s requester=%s", cr.id, cr.title, cr.requester_username)
    return _cr_to_dict(cr)


@router.get("/stats/summary")
def change_stats(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    """변경 요청 상태별 집계."""
    from sqlalchemy import func
    rows = db.query(ChangeRequest.status, func.count(ChangeRequest.id)).group_by(ChangeRequest.status).all()
    return {status: count for status, count in rows}


@router.get("/{change_id}")
def get_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """변경 요청 상세 조회."""
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == change_id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="변경 요청을 찾을 수 없습니다.")

    role = current_user.get("role", "user")
    if role == "user" and cr.requester_username != current_user.get("username"):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    return _cr_to_dict(cr)


@router.patch("/{change_id}")
def update_change(
    change_id: int,
    body: ChangeUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """변경 요청 내용 수정 (draft/submitted 상태에서만 가능)."""
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == change_id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="변경 요청을 찾을 수 없습니다.")

    role = current_user.get("role", "user")
    is_owner = cr.requester_username == current_user.get("username")
    if role == "user" and not is_owner:
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")
    if cr.status not in ("draft", "submitted") and role not in ("admin", "agent"):
        raise HTTPException(status_code=400, detail="심의 중인 변경 요청은 수정할 수 없습니다.")

    # M-06: 명시적 허용 필드만 업데이트 — 향후 스키마 확장 시 mass assignment 방지
    _UPDATABLE_FIELDS = frozenset({
        "title", "description", "change_type", "risk_level",
        "scheduled_start_at", "scheduled_end_at",
        "rollback_plan", "impact", "implementer_username",
    })
    update_data = {k: v for k, v in body.model_dump(exclude_none=True).items() if k in _UPDATABLE_FIELDS}
    for key in ("scheduled_start_at", "scheduled_end_at"):
        if key in update_data:
            try:
                update_data[key] = datetime.fromisoformat(update_data[key])
            except ValueError:
                raise HTTPException(status_code=422, detail=f"{key} 형식 오류 (ISO 8601)")
    _start = update_data.get("scheduled_start_at") or cr.scheduled_start_at
    _end = update_data.get("scheduled_end_at") or cr.scheduled_end_at
    if _start and _end and _end <= _start:
        raise HTTPException(status_code=422, detail="종료 예정 시각은 시작 예정 시각 이후여야 합니다.")

    for field, value in update_data.items():
        setattr(cr, field, value)
    cr.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cr)
    return _cr_to_dict(cr)


@router.post("/{change_id}/transition")
def transition_change(
    change_id: int,
    body: ChangeTransition,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """상태 전이. 권한 규칙:
    - submitted: 요청자 또는 agent/admin
    - reviewing: agent 이상
    - approved/rejected: agent 이상 (승인자 정보 기록)
    - implementing/implemented/failed/cancelled: agent 이상
    """
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == change_id).with_for_update().first()
    if not cr:
        raise HTTPException(status_code=404, detail="변경 요청을 찾을 수 없습니다.")

    new_status = body.status
    role = current_user.get("role", "user")
    username = current_user.get("username", "")

    # 전이 유효성
    allowed = VALID_TRANSITIONS.get(cr.status, [])
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"'{cr.status}' 상태에서 '{new_status}'으로 전이할 수 없습니다. 가능: {allowed}",
        )

    # 권한 검사
    if new_status == "submitted":
        if role == "user" and cr.requester_username != username:
            raise HTTPException(status_code=403, detail="본인의 변경 요청만 제출할 수 있습니다.")
    elif new_status in ("reviewing", "approved", "rejected", "implementing", "implemented", "failed"):
        if role not in ("admin", "agent"):
            raise HTTPException(status_code=403, detail="에이전트 이상 권한이 필요합니다.")
    # cancelled: 요청자 본인 또는 agent 이상
    elif new_status == "cancelled":
        if role == "user" and cr.requester_username != username:
            raise HTTPException(status_code=403, detail="접근 권한이 없습니다.")

    # 코멘트 필수 전이 검증
    _comment_required = {"approved", "rejected", "implemented", "failed"}
    if new_status in _comment_required and not (body.comment or "").strip():
        raise HTTPException(status_code=422, detail=f"'{new_status}' 전이에는 코멘트/결과가 필요합니다.")

    now = datetime.now(timezone.utc)
    old_status = cr.status
    cr.status = new_status
    cr.updated_at = now

    if new_status == "approved":
        cr.approver_username = username
        cr.approver_name = current_user.get("name", "")
        cr.approved_at = now
        cr.approval_comment = body.comment
    elif new_status == "rejected":
        cr.approver_username = username
        cr.approver_name = current_user.get("name", "")
        cr.approval_comment = body.comment
    elif new_status == "implementing":
        cr.actual_start_at = now
        if not cr.implementer_username:
            cr.implementer_username = username
    elif new_status in ("implemented", "failed"):
        cr.actual_end_at = now
        cr.result_note = body.comment

    # 알림 생성 — commit 전(flush 단계)에 호출해야 같은 트랜잭션에 참여
    if cr.requester_username and cr.requester_username != username:
        status_labels = {
            "submitted": "제출됨",
            "reviewing": "심의 중",
            "approved": "승인됨",
            "rejected": "반려됨",
            "implementing": "구현 중",
            "implemented": "구현 완료",
            "failed": "구현 실패",
            "cancelled": "취소됨",
        }
        label = status_labels.get(new_status, new_status)
        try:
            create_db_notification(
                db=db,
                recipient_id=cr.requester_username,
                title=f"변경 요청 상태 변경: {label}",
                body=f"'{cr.title}' 변경 요청이 '{label}' 상태로 변경되었습니다.",
                link=f"/changes/{cr.id}",
                dedup_key=f"change:{cr.id}:{new_status}",
                dedup_ttl=60,
            )
        except Exception:
            logger.warning("변경 요청 알림 전송 실패: change_id=%d", cr.id)

    db.commit()
    db.refresh(cr)

    logger.info("변경 요청 전이: id=%d %s→%s by %s", cr.id, old_status, new_status, username)
    return _cr_to_dict(cr)


@router.delete("/{change_id}", status_code=204)
def delete_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """변경 요청 삭제 (관리자 전용, draft 상태만 삭제 가능)."""
    cr = db.query(ChangeRequest).filter(ChangeRequest.id == change_id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="변경 요청을 찾을 수 없습니다.")
    if cr.status != "draft":
        raise HTTPException(status_code=400, detail="draft 상태의 변경 요청만 삭제할 수 있습니다.")
    db.delete(cr)
    db.commit()
