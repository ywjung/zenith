"""Customer self-service portal (no GitLab auth required)."""
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import GuestToken
from .. import gitlab_client
from ..notifications import send_email
from .. import sla as sla_module
from ..assignment import evaluate_rules
from ..rate_limit import limiter, LIMIT_PORTAL

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

VALID_CATEGORIES = {"hardware", "software", "network", "account", "other"}
VALID_PRIORITIES = {"low", "medium", "high", "critical"}


class PortalSubmitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr  # M-3: 이메일 형식 검증
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1, max_length=10000)
    category: Optional[str] = None
    priority: Optional[str] = "medium"


class PortalSubmitResponse(BaseModel):
    ticket_iid: int
    token: str
    track_url: str


class PortalTicketStatus(BaseModel):
    ticket_iid: int
    title: str
    status: str
    created_at: str
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper: build description in standard ITSM format
# ---------------------------------------------------------------------------

def _build_description(name: str, email: str, content: str) -> str:
    return (
        f"**신청자:** {name} ({email})\n\n"
        f"---\n\n"
        f"{content}"
    )


def _parse_status(labels: list[str]) -> str:
    for label in labels:
        if label.startswith("status::"):
            return label.removeprefix("status::")
    return "open"


# ---------------------------------------------------------------------------
# POST /portal/submit
# ---------------------------------------------------------------------------

@router.post("/submit", response_model=PortalSubmitResponse)
@(limiter.limit(LIMIT_PORTAL) if limiter else lambda f: f)  # C-2: IP당 분당 5회 제한
def portal_submit(request: Request, req: PortalSubmitRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    # H-3: 허용된 값 외 입력 차단
    category = req.category if req.category in VALID_CATEGORIES else settings.EMAIL_DEFAULT_CATEGORY
    priority = req.priority if req.priority in VALID_PRIORITIES else "medium"

    labels = [
        "status::open",
        f"cat::{category}",
        f"prio::{priority}",
    ]

    description = _build_description(req.name, req.email, req.content)

    # Auto-assign
    assignee_id: Optional[int] = evaluate_rules(db, category=category, priority=priority, title=req.title)

    try:
        issue = gitlab_client.create_issue(
            title=req.title,
            description=description,
            labels=labels,
            assignee_id=assignee_id,
        )
    except Exception as e:
        logger.error("portal_submit: GitLab create_issue failed: %s", e)
        raise HTTPException(status_code=502, detail="티켓 생성에 실패했습니다. 잠시 후 다시 시도하세요.")

    ticket_iid = issue.get("iid")
    project_id = str(settings.GITLAB_PROJECT_ID)

    # Create SLA record
    try:
        sla_module.create_sla_record(db, ticket_iid, project_id, priority)
    except Exception as e:
        logger.warning("portal_submit: SLA record creation failed: %s", e)

    # Issue guest token (7 days)
    raw_token = secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    guest_token = GuestToken(
        token=raw_token,  # TODO: store as SHA-256 hash for security
        email=str(req.email),
        ticket_iid=ticket_iid,
        project_id=project_id,
        expires_at=expires.replace(tzinfo=None),
    )
    db.add(guest_token)
    db.commit()

    track_url = f"{settings.FRONTEND_URL}/portal/track/{raw_token}"

    # Send confirmation email
    _send_confirmation(req.email, req.name, ticket_iid, track_url)

    return PortalSubmitResponse(
        ticket_iid=ticket_iid,
        token=raw_token,
        track_url=track_url,
    )


def _send_confirmation(email: str, name: str, ticket_iid: int, track_url: str) -> None:
    subject = f"[ITSM] 티켓 #{ticket_iid} 접수 완료"
    body = f"""
<p>안녕하세요, {name}님.</p>
<p>문의가 정상적으로 접수되었습니다. (티켓 번호: <strong>#{ticket_iid}</strong>)</p>
<p>아래 링크에서 진행 상황을 확인하실 수 있습니다:</p>
<p><a href="{track_url}">{track_url}</a></p>
<p>감사합니다.</p>
"""
    try:
        send_email(email, subject, body)
    except Exception as e:
        logger.warning("portal_submit: confirmation email failed: %s", e)


# ---------------------------------------------------------------------------
# GET /portal/track/{token}
# ---------------------------------------------------------------------------

@router.get("/track/{token}", response_model=PortalTicketStatus)
@(limiter.limit("10/minute") if limiter else lambda f: f)  # C-8: IP당 분당 10회 제한
def portal_track(request: Request, token: str, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    guest = db.query(GuestToken).filter(
        GuestToken.token == token,
        GuestToken.expires_at > now,
    ).first()

    if not guest:
        raise HTTPException(status_code=404, detail="유효하지 않거나 만료된 링크입니다.")

    try:
        issue = gitlab_client.get_issue(guest.ticket_iid, project_id=guest.project_id)
    except Exception as e:
        logger.error("portal_track: get_issue failed: %s", e)
        raise HTTPException(status_code=502, detail="티켓 정보를 불러오지 못했습니다.")

    labels = issue.get("labels", [])
    status = _parse_status(labels)

    return PortalTicketStatus(
        ticket_iid=guest.ticket_iid,
        title=issue.get("title", ""),
        status=status,
        created_at=issue.get("created_at", ""),
        updated_at=issue.get("updated_at"),
    )
