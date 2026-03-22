"""Admin email template endpoints."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import EmailTemplate
from ...rbac import require_admin

email_templates_router = APIRouter()


class EmailTemplateResponse(BaseModel):
    id: int
    event_type: str
    subject: str
    html_body: str
    enabled: bool
    updated_by: Optional[str]
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class EmailTemplateUpdate(BaseModel):
    subject: str
    html_body: str
    enabled: bool = True


_EVENT_TYPE_LABELS = {
    "ticket_created": "티켓 생성",
    "status_changed": "상태 변경",
    "comment_added": "댓글 추가",
    "sla_warning": "SLA 경고",
    "sla_breach": "SLA 위반",
}


@email_templates_router.get("/email-templates", response_model=list[EmailTemplateResponse])
def list_email_templates(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """이메일 템플릿 목록 조회."""
    return db.query(EmailTemplate).order_by(EmailTemplate.event_type).all()


@email_templates_router.get("/email-templates/{event_type}", response_model=EmailTemplateResponse)
def get_email_template(
    event_type: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """특정 이벤트 타입의 이메일 템플릿 조회."""
    tmpl = db.query(EmailTemplate).filter(EmailTemplate.event_type == event_type).first()
    if not tmpl:
        raise HTTPException(404, "템플릿을 찾을 수 없습니다.")
    return tmpl


@email_templates_router.put("/email-templates/{event_type}", response_model=EmailTemplateResponse)
def update_email_template(
    event_type: str,
    body: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """이메일 템플릿 수정. Jinja2 문법 검증 후 저장."""
    # Jinja2 문법 유효성 검사
    try:
        from jinja2.sandbox import SandboxedEnvironment
        env = SandboxedEnvironment(autoescape=True)
        env.parse(body.subject)
        env.parse(body.html_body)
    except Exception:
        raise HTTPException(400, "템플릿 문법 오류입니다. 문법을 확인해 주세요.")

    tmpl = db.query(EmailTemplate).filter(EmailTemplate.event_type == event_type).first()
    if not tmpl:
        raise HTTPException(404, "템플릿을 찾을 수 없습니다.")

    tmpl.subject = body.subject
    tmpl.html_body = body.html_body
    tmpl.enabled = body.enabled
    tmpl.updated_by = user["username"]
    db.commit()
    db.refresh(tmpl)
    return tmpl


@email_templates_router.post("/email-templates/{event_type}/preview")
def preview_email_template(
    event_type: str,
    body: EmailTemplateUpdate,
    _user: dict = Depends(require_admin),
):
    """템플릿 미리보기 — 샘플 데이터로 렌더링해 반환."""
    sample_ctx: dict = {
        "iid": 42,
        "title": "샘플 티켓 제목입니다",
        "employee_name": "홍길동",
        "priority": "high",
        "category": "소프트웨어",
        "description": "문제 설명 내용입니다.",
        "old_status": "접수됨",
        "new_status": "처리 중",
        "actor_name": "IT팀 담당자",
        "author_name": "IT팀 담당자",
        "comment_preview": "확인 후 처리하겠습니다.",
        "minutes_left": 45,
        "portal_url": "http://itsm.example.com/tickets/42",
    }
    try:
        from jinja2.sandbox import SandboxedEnvironment
        env = SandboxedEnvironment(autoescape=True)
        subject = env.from_string(body.subject).render(**sample_ctx)
        html_body = env.from_string(body.html_body).render(**sample_ctx)
        return {"subject": subject, "html_body": html_body}
    except Exception:
        raise HTTPException(400, "템플릿 렌더링 오류입니다. 문법을 확인해 주세요.")
