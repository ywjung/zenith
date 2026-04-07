"""Customer self-service portal (no GitLab auth required)."""
import hashlib
import html as _html_mod
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
    catalog_item_id: Optional[int] = None  # 서비스 카탈로그 항목 ID


class PortalSubmitResponse(BaseModel):
    ticket_iid: int
    token: str
    track_url: str


class PortalComment(BaseModel):
    id: int
    body: str
    author_name: str
    created_at: str


class PortalTicketStatus(BaseModel):
    ticket_iid: int
    title: str
    status: str
    priority: Optional[str] = None
    category: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    sla_deadline: Optional[str] = None
    sla_breached: bool = False
    comments: list[PortalComment] = []
    expires_at: Optional[str] = None  # 게스트 토큰 만료 시각


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

    # 서비스 카탈로그 항목이 선택된 경우 설명 앞에 카탈로그 레이블 추가
    content_with_catalog = req.content
    if req.catalog_item_id:
        try:
            from ..models import ServiceCatalogItem
            catalog_item = db.query(ServiceCatalogItem).filter_by(id=req.catalog_item_id, is_active=True).first()
            if catalog_item:
                catalog_header = f"**서비스 카탈로그:** {catalog_item.icon or ''} {catalog_item.name}\n\n"
                content_with_catalog = catalog_header + req.content
                labels.append(f"catalog::{catalog_item.id}")
        except Exception as e:
            logger.warning("portal_submit: catalog lookup failed: %s", e)

    description = _build_description(req.name, req.email, content_with_catalog)

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

    # Issue guest token (7 days) — DB에는 SHA-256 해시만 저장 (H-5)
    # M-8: 동일 email + ticket_iid 기존 토큰 무효화 (토큰 중복 방지)
    db.query(GuestToken).filter(
        GuestToken.email == str(req.email),
        GuestToken.ticket_iid == ticket_iid,
    ).delete(synchronize_session=False)

    raw_token = secrets.token_hex(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    guest_token = GuestToken(
        token=token_hash,  # SHA-256 해시로 저장 (평문 미저장)
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
    # MED-02: 사용자 입력값 HTML 이스케이프 처리 (이메일 XSS 방지)
    safe_name = _html_mod.escape(name)
    safe_url = _html_mod.escape(track_url)
    body = f"""
<p>안녕하세요, {safe_name}님.</p>
<p>문의가 정상적으로 접수되었습니다. (티켓 번호: <strong>#{ticket_iid}</strong>)</p>
<p>아래 링크에서 진행 상황을 확인하실 수 있습니다:</p>
<p><a href="{safe_url}">{safe_url}</a></p>
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
@(limiter.limit("5/minute") if limiter else lambda f: f)  # C-2: IP당 분당 5회로 강화
def portal_track(request: Request, token: str, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # H-5: DB에는 SHA-256 해시가 저장되므로 조회 시 해시로 비교
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    guest = db.query(GuestToken).filter(
        GuestToken.token == token_hash,
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

    # 우선순위·카테고리 파싱
    priority = next((lbl.split("::")[1] for lbl in labels if lbl.startswith("prio::")), None)
    category = next((lbl.split("::")[1] for lbl in labels if lbl.startswith("cat::")), None)

    # SLA 조회
    from ..models import SLARecord
    sla_rec = db.query(SLARecord).filter_by(
        gitlab_issue_iid=guest.ticket_iid,
        project_id=guest.project_id or "",
    ).first()
    sla_deadline = sla_rec.sla_deadline.isoformat() if sla_rec and sla_rec.sla_deadline else None
    sla_breached = bool(sla_rec and sla_rec.breached)

    # 공개 댓글 조회 (internal 댓글 제외)
    public_comments: list[PortalComment] = []
    try:
        notes = gitlab_client.get_notes(guest.ticket_iid, project_id=guest.project_id)
        for note in notes:
            if note.get("internal") or note.get("system"):
                continue
            body = note.get("body", "").strip()
            if not body:
                continue
            author = note.get("author") or {}
            public_comments.append(PortalComment(
                id=note["id"],
                body=body,
                author_name=author.get("name") or author.get("username") or "담당자",
                created_at=note.get("created_at", ""),
            ))
    except Exception as e:
        logger.warning("portal_track: get_notes failed: %s", e)

    return PortalTicketStatus(
        ticket_iid=guest.ticket_iid,
        title=issue.get("title", ""),
        status=status,
        priority=priority,
        category=category,
        created_at=issue.get("created_at", ""),
        updated_at=issue.get("updated_at"),
        sla_deadline=sla_deadline,
        sla_breached=sla_breached,
        comments=public_comments,
        expires_at=guest.expires_at.isoformat() if guest.expires_at else None,
    )


# ---------------------------------------------------------------------------
# POST /portal/extend/{token}  — 게스트 토큰 유효기간 연장 (최대 7일 추가)
# ---------------------------------------------------------------------------

@router.post("/extend/{token}")
@(limiter.limit("3/hour") if limiter else lambda f: f)
def portal_extend_token(request: Request, token: str, db: Session = Depends(get_db)):
    """게스트 추적 링크 유효기간을 7일 연장한다. 시간당 3회 제한."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    guest = db.query(GuestToken).filter(GuestToken.token == token_hash).first()
    if not guest:
        raise HTTPException(status_code=404, detail="유효하지 않은 링크입니다.")

    # 최대 연장 한도: 생성일로부터 90일 (무제한 연장 방지)
    max_expiry = (guest.created_at or now) + timedelta(days=90)
    if guest.expires_at and guest.expires_at >= max_expiry:
        raise HTTPException(status_code=400, detail="최대 연장 한도(90일)에 도달했습니다.")

    base = max(guest.expires_at, now)
    new_expiry = min(base + timedelta(days=7), max_expiry)
    guest.expires_at = new_expiry
    db.commit()

    return {
        "ticket_iid": guest.ticket_iid,
        "expires_at": new_expiry.isoformat(),
        "message": "링크 유효기간이 7일 연장되었습니다.",
    }
