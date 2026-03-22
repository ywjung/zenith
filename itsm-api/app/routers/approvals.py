"""승인 워크플로우 라우터."""
import logging
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import ApprovalRequest
from ..notifications import create_db_notification
from ..rbac import require_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/approvals", tags=["approvals"])


def _approval_to_dict(req: ApprovalRequest) -> dict:
    return {
        "id": req.id,
        "ticket_iid": req.ticket_iid,
        "project_id": req.project_id,
        "requester_username": req.requester_username,
        "requester_name": req.requester_name,
        "approver_username": req.approver_username,
        "approver_name": req.approver_name,
        "status": req.status,
        "reason": req.reason,
        "approved_at": req.approved_at.isoformat() if req.approved_at else None,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


class ApprovalCreate(BaseModel):
    ticket_iid: int
    project_id: str
    approver_username: Optional[str] = None

    @field_validator("project_id")
    @classmethod
    def validate_project_id(cls, v: str) -> str:
        from ..config import get_settings
        s = get_settings()
        allowed = {str(s.GITLAB_PROJECT_ID)}
        if v not in allowed:
            raise ValueError("유효하지 않은 project_id입니다.")
        return v


class ApprovalAction(BaseModel):
    reason: Optional[str] = None


@router.get("")
def list_approvals(
    ticket_iid: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    q = db.query(ApprovalRequest)
    if ticket_iid:
        q = q.filter(ApprovalRequest.ticket_iid == ticket_iid)
    if status:
        q = q.filter(ApprovalRequest.status == status)
    return [_approval_to_dict(r) for r in q.order_by(ApprovalRequest.created_at.desc()).all()]


@router.post("", status_code=201)
def create_approval_request(
    body: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    # 티켓 존재 여부 검증 (GitLab)
    from .. import gitlab_client as _gl
    try:
        _gl.get_issue(body.ticket_iid, body.project_id)
    except Exception:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    # 이미 대기 중인 요청이 있으면 중복 생성 방지 — FOR UPDATE로 동시 요청 직렬화
    existing = (
        db.query(ApprovalRequest)
        .filter(
            ApprovalRequest.ticket_iid == body.ticket_iid,
            ApprovalRequest.project_id == body.project_id,
            ApprovalRequest.status == "pending",
        )
        .with_for_update()
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="이미 대기 중인 승인 요청이 있습니다.")

    req = ApprovalRequest(
        ticket_iid=body.ticket_iid,
        project_id=body.project_id,
        requester_username=current_user.get("username", ""),
        requester_name=current_user.get("name", ""),
        approver_username=body.approver_username,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    # 담당 승인자에게 인앱 알림
    if body.approver_username:
        from ..models import UserRole
        approver = (
            db.query(UserRole)
            .filter(UserRole.username == body.approver_username)
            .first()
        )
        if approver:
            create_db_notification(
                db,
                recipient_id=str(approver.gitlab_user_id),
                title=f"티켓 #{body.ticket_iid} 승인 요청",
                body=f"{req.requester_name or req.requester_username}님이 승인을 요청했습니다.",
                link=f"/tickets/{body.ticket_iid}",
            )
            # 이메일 알림 (NOTIFICATION_ENABLED 시)
            if getattr(approver, 'email', None):
                from ..notifications import notify_approval_requested
                try:
                    notify_approval_requested(
                        approver_email=getattr(approver, 'email', None),
                        approver_name=approver.name or approver.username,
                        ticket_iid=body.ticket_iid,
                        requester_name=req.requester_name or req.requester_username,
                    )
                except Exception:
                    pass
    return _approval_to_dict(req)


@router.post("/{approval_id}/approve")
def approve_request(
    approval_id: int,
    body: ApprovalAction = ApprovalAction(),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    req = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.id == approval_id)
        .with_for_update()
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="승인 요청을 찾을 수 없습니다.")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"이미 처리된 요청입니다. ({req.status})")

    # 지정된 승인자가 있는 경우 권한 검증
    if req.approver_username and req.approver_username != current_user.get("username"):
        if current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="이 승인 요청의 지정 승인자가 아닙니다.")

    req.status = "approved"
    req.approver_username = current_user.get("username", "")
    req.approver_name = current_user.get("name", "")
    req.reason = body.reason
    req.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(req)

    # 요청자에게 알림
    from ..models import UserRole
    requester = db.query(UserRole).filter(UserRole.username == req.requester_username).first()
    if requester:
        create_db_notification(
            db,
            recipient_id=str(requester.gitlab_user_id),
            title=f"티켓 #{req.ticket_iid} 승인됨",
            body=f"{req.approver_name}님이 승인했습니다." + (f" ({body.reason})" if body.reason else ""),
            link=f"/tickets/{req.ticket_iid}",
        )
        if getattr(requester, 'email', None):
            from ..notifications import notify_approval_decided
            try:
                notify_approval_decided(
                    requester_email=getattr(requester, 'email', None),
                    requester_name=requester.name or requester.username,
                    ticket_iid=req.ticket_iid,
                    decision="approved",
                    decider_name=req.approver_name or req.approver_username,
                    reason=body.reason,
                )
            except Exception:
                pass
    return _approval_to_dict(req)


@router.post("/{approval_id}/reject")
def reject_request(
    approval_id: int,
    body: ApprovalAction = ApprovalAction(),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    req = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.id == approval_id)
        .with_for_update()
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="승인 요청을 찾을 수 없습니다.")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"이미 처리된 요청입니다. ({req.status})")

    # 거절은 요청자 본인(취소)도 가능, 단 지정 승인자가 있으면 해당 승인자 또는 admin만 가능
    is_requester = req.requester_username == current_user.get("username")
    if not is_requester:
        if req.approver_username and req.approver_username != current_user.get("username"):
            if current_user.get("role") != "admin":
                raise HTTPException(status_code=403, detail="이 승인 요청의 지정 승인자가 아닙니다.")

    req.status = "rejected"
    req.approver_username = current_user.get("username", "")
    req.approver_name = current_user.get("name", "")
    req.reason = body.reason
    db.commit()
    db.refresh(req)

    # 요청자에게 알림
    from ..models import UserRole
    requester = db.query(UserRole).filter(UserRole.username == req.requester_username).first()
    if requester:
        create_db_notification(
            db,
            recipient_id=str(requester.gitlab_user_id),
            title=f"티켓 #{req.ticket_iid} 승인 거절됨",
            body=f"{req.approver_name}님이 거절했습니다." + (f" 사유: {body.reason}" if body.reason else ""),
            link=f"/tickets/{req.ticket_iid}",
        )
        if getattr(requester, 'email', None):
            from ..notifications import notify_approval_decided
            try:
                notify_approval_decided(
                    requester_email=getattr(requester, 'email', None),
                    requester_name=requester.name or requester.username,
                    ticket_iid=req.ticket_iid,
                    decision="rejected",
                    decider_name=req.approver_name or req.approver_username,
                    reason=body.reason,
                )
            except Exception:
                pass
    return _approval_to_dict(req)
