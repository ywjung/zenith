"""Admin router: user role management, audit logs, assignment rules."""
import csv
import io
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..audit import write_audit_log
from ..config import get_settings
from ..database import get_db
from ..models import UserRole, AuditLog, AssignmentRule, SLAPolicy, ServiceType, EscalationPolicy, EscalationRecord, EmailTemplate, OutboundWebhook
from ..rbac import require_agent, require_admin
from ..schemas import (
    AssignmentRuleResponse,
    SLARecordResponse,
    SLAPolicyResponse,
    ServiceTypeResponse,
)


def _fetch_gitlab_users_bulk(user_ids: list[int]) -> dict[int, dict]:
    """GitLab API로 여러 사용자 정보를 일괄 조회한다."""
    if not user_ids:
        return {}
    settings = get_settings()
    try:
        params = [("ids[]", uid) for uid in user_ids]
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                f"{settings.GITLAB_API_URL}/api/v4/users",
                headers={"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN},
                params=params,
            )
            if resp.is_success:
                return {u["id"]: u for u in resp.json()}
    except Exception:
        pass
    return {}

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# User role management
# ---------------------------------------------------------------------------

class RolePatch(BaseModel):
    role: str  # admin|agent|user


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rows = db.query(UserRole).filter(UserRole.gitlab_user_id != 1).order_by(UserRole.username).all()
    gitlab_info = _fetch_gitlab_users_bulk([r.gitlab_user_id for r in rows])
    result = []
    for r in rows:
        gl = gitlab_info.get(r.gitlab_user_id, {})
        result.append({
            "id": r.id,
            "gitlab_user_id": r.gitlab_user_id,
            "username": r.username,
            "name": gl.get("name", r.username),
            "email": gl.get("email", ""),
            "organization": gl.get("organization", ""),
            "role": r.role,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        })
    return result


@router.patch("/users/{gitlab_user_id}")
def update_user_role(
    request: Request,
    gitlab_user_id: int,
    data: RolePatch,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
    x_sudo_token: Optional[str] = Header(default=None, alias="X-Sudo-Token"),
):
    # 고위험 작업 — Sudo 재인증 검증
    from ..routers.auth import verify_sudo_token
    verify_sudo_token(x_sudo_token, user, db)

    allowed = {"admin", "agent", "developer", "user"}
    if data.role not in allowed:
        raise HTTPException(status_code=400, detail=f"허용된 역할: {', '.join(allowed)}")

    record = db.query(UserRole).filter(UserRole.gitlab_user_id == gitlab_user_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    old_role = record.role
    record.role = data.role
    record.updated_at = datetime.utcnow()
    db.commit()

    write_audit_log(
        db, user, "user.role_change", "user", str(gitlab_user_id),
        old_value={"role": old_role},
        new_value={"role": data.role},
        request=request,
    )
    return {"gitlab_user_id": gitlab_user_id, "role": record.role}


# ---------------------------------------------------------------------------
# Audit logs
# ---------------------------------------------------------------------------

def _build_audit_query(db: Session, resource_type=None, actor_id=None, action=None, from_date=None, to_date=None):
    from sqlalchemy import func, text as sa_text
    # actor_id가 순수 숫자인 경우에만 user_roles와 JOIN
    # 비숫자(예: "apikey:1", "test" 등)는 JOIN 대상에서 제외 → CAST 오류 방지
    join_cond = sa_text(
        "audit_logs.actor_id ~ '^[0-9]+$' "
        "AND CAST(audit_logs.actor_id AS INTEGER) = user_roles.gitlab_user_id"
    )
    q = (
        db.query(
            AuditLog,
            func.coalesce(AuditLog.actor_name, UserRole.name, AuditLog.actor_username).label("display_name"),
        )
        .outerjoin(UserRole, join_cond)
        .order_by(AuditLog.created_at.desc())
    )
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    if actor_id:
        q = q.filter(AuditLog.actor_id == actor_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if from_date:
        q = q.filter(AuditLog.created_at >= from_date)
    if to_date:
        q = q.filter(AuditLog.created_at <= to_date)
    return q


def _audit_row_to_dict(r) -> dict:
    log, display_name = r
    return {
        "id": log.id,
        "actor_id": log.actor_id,
        "actor_username": log.actor_username,
        "actor_name": display_name,
        "actor_role": log.actor_role,
        "action": log.action,
        "resource_type": log.resource_type,
        "resource_id": log.resource_id,
        "old_value": log.old_value,
        "new_value": log.new_value,
        "ip_address": str(log.ip_address) if log.ip_address else None,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


@router.get("/audit")
def list_audit_logs(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    q = _build_audit_query(db, resource_type, actor_id, action, from_date, to_date)
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()  # list of (AuditLog, display_name)
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "logs": [_audit_row_to_dict(r) for r in rows],
    }


@router.get("/audit/download")
def download_audit_logs(
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """감사 로그 CSV 다운로드 (최대 10,000건)."""
    q = _build_audit_query(db, resource_type, actor_id, action, from_date, to_date)
    rows = q.limit(10000).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "시간", "행위자(username)", "이름", "역할", "액션", "대상 유형", "대상 ID", "IP"])
    for r in rows:
        log, display_name = r
        writer.writerow([
            log.id,
            log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
            log.actor_username,
            display_name or "",
            log.actor_role,
            log.action,
            log.resource_type,
            log.resource_id,
            str(log.ip_address) if log.ip_address else "",
        ])

    output.seek(0)
    filename = f"audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Assignment rules
# ---------------------------------------------------------------------------

class AssignmentRuleCreate(BaseModel):
    name: str
    enabled: bool = True
    priority: int = 0
    match_category: Optional[str] = None
    match_priority: Optional[str] = None
    match_keyword: Optional[str] = None
    assignee_gitlab_id: int
    assignee_name: str


class AssignmentRulePatch(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    match_category: Optional[str] = None
    match_priority: Optional[str] = None
    match_keyword: Optional[str] = None
    assignee_gitlab_id: Optional[int] = None
    assignee_name: Optional[str] = None


@router.get("/assignment-rules")
def list_assignment_rules(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rules = db.query(AssignmentRule).order_by(AssignmentRule.priority.desc()).all()
    return [AssignmentRuleResponse.model_validate(r).model_dump() for r in rules]


@router.post("/assignment-rules", status_code=201)
def create_assignment_rule(
    data: AssignmentRuleCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    rule = AssignmentRule(
        name=data.name,
        enabled=data.enabled,
        priority=data.priority,
        match_category=data.match_category,
        match_priority=data.match_priority,
        match_keyword=data.match_keyword,
        assignee_gitlab_id=data.assignee_gitlab_id,
        assignee_name=data.assignee_name,
        created_by=str(user.get("sub", "")),
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return AssignmentRuleResponse.model_validate(rule).model_dump()


@router.patch("/assignment-rules/{rule_id}")
def update_assignment_rule(
    rule_id: int,
    data: AssignmentRulePatch,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rule = db.query(AssignmentRule).filter(AssignmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return AssignmentRuleResponse.model_validate(rule).model_dump()


@router.delete("/assignment-rules/{rule_id}", status_code=204)
def delete_assignment_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    rule = db.query(AssignmentRule).filter(AssignmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    db.delete(rule)
    db.commit()


# ---------------------------------------------------------------------------
# SLA breached list
# ---------------------------------------------------------------------------

@router.get("/sla/breached")
def list_breached_sla(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    from ..models import SLARecord
    records = (
        db.query(SLARecord)
        .filter(SLARecord.breached == True)  # noqa: E712
        .order_by(SLARecord.sla_deadline)
        .limit(100)
        .all()
    )
    return [SLARecordResponse.model_validate(r).model_dump() for r in records]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# F-1: SLA policy management
# ---------------------------------------------------------------------------

class SLAPolicyUpdate(BaseModel):
    response_hours: int
    resolve_hours: int


@router.get("/sla-policies")
def list_sla_policies(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """List all SLA policies (read access for agents/admins)."""
    policies = db.query(SLAPolicy).order_by(SLAPolicy.id).all()
    return [SLAPolicyResponse.model_validate(p).model_dump() for p in policies]


@router.put("/sla-policies/{priority}")
def update_sla_policy(
    priority: str,
    data: SLAPolicyUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """Update SLA response/resolve hours for a priority level (admin only)."""
    allowed_priorities = {"critical", "high", "medium", "low"}
    if priority not in allowed_priorities:
        raise HTTPException(status_code=400, detail=f"허용된 우선순위: {', '.join(allowed_priorities)}")

    policy = db.query(SLAPolicy).filter(SLAPolicy.priority == priority).first()
    if not policy:
        # Auto-create if missing
        policy = SLAPolicy(priority=priority, response_hours=data.response_hours, resolve_hours=data.resolve_hours)
        db.add(policy)
    else:
        policy.response_hours = data.response_hours
        policy.resolve_hours = data.resolve_hours
        policy.updated_by = user.get("username", "")
        policy.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(policy)
    return SLAPolicyResponse.model_validate(policy).model_dump()




# ---------------------------------------------------------------------------
# Service types (dynamic category management)
# ---------------------------------------------------------------------------

class ServiceTypeCreate(BaseModel):
    label: str
    description: Optional[str] = None
    emoji: str = "📋"
    color: str = "#6699cc"
    sort_order: int = 0
    enabled: bool = True
    context_label: Optional[str] = None
    context_options: list[str] = []


class ServiceTypePatch(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    emoji: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None
    context_label: Optional[str] = None
    context_options: Optional[list[str]] = None


@router.get("/service-types/usage")
def get_service_type_usage(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """서비스 유형별 사용 중인 티켓 수를 반환한다 (병렬 조회)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from .. import gitlab_client as _gc

    types = db.query(ServiceType).order_by(ServiceType.sort_order, ServiceType.id).all()

    def _count(st: ServiceType) -> tuple[int, int]:
        try:
            _, total = _gc.get_issues(
                labels=f"cat::{st.value}", state="all", per_page=1, page=1
            )
            return st.id, total
        except Exception:
            return st.id, 0

    result: dict[int, int] = {}
    with ThreadPoolExecutor(max_workers=min(len(types), 5)) as pool:
        futures = {pool.submit(_count, st): st.id for st in types}
        for future in as_completed(futures):
            st_id, count = future.result()
            result[st_id] = count

    return result  # {service_type_id: ticket_count}


@router.get("/service-types")
def list_service_types(
    db: Session = Depends(get_db),
):
    """서비스 유형 목록 조회 (인증 불필요 — 로그인 전 티켓 등록 폼에서도 사용)."""
    types = db.query(ServiceType).order_by(ServiceType.sort_order, ServiceType.id).all()
    return [ServiceTypeResponse.model_validate(t).model_dump() for t in types]


@router.post("/service-types", status_code=201)
def create_service_type(
    data: ServiceTypeCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    # Use a temporary placeholder; replace with sequential id after flush
    st = ServiceType(value="__pending__", **data.model_dump())
    db.add(st)
    db.flush()  # assigns st.id without committing
    st.value = str(st.id)
    db.commit()
    db.refresh(st)
    # GitLab 라벨 동기화 (cat::{value})
    try:
        from .. import gitlab_client as _gc
        _gc.sync_label_to_gitlab(f"cat::{st.value}", st.color or "#95a5a6")
    except Exception as e:
        logger.warning("서비스 유형 생성 후 GitLab 라벨 동기화 실패: %s", e)
    return ServiceTypeResponse.model_validate(st).model_dump()


@router.patch("/service-types/{type_id}")
def update_service_type(
    type_id: int,
    data: ServiceTypePatch,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    st = db.query(ServiceType).filter(ServiceType.id == type_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="서비스 유형을 찾을 수 없습니다.")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(st, field, value)
    db.commit()
    db.refresh(st)
    # 색상 변경 시 GitLab 라벨 색상도 업데이트
    try:
        from .. import gitlab_client as _gc
        _gc.sync_label_to_gitlab(f"cat::{st.value}", st.color or "#95a5a6")
    except Exception as e:
        logger.warning("서비스 유형 수정 후 GitLab 라벨 동기화 실패: %s", e)
    return ServiceTypeResponse.model_validate(st).model_dump()


@router.delete("/service-types/{type_id}", status_code=204)
def delete_service_type(
    type_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    st = db.query(ServiceType).filter(ServiceType.id == type_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="서비스 유형을 찾을 수 없습니다.")

    # 해당 카테고리(cat::N)를 사용 중인 티켓 수 확인
    label_name = f"cat::{st.value}"
    try:
        from .. import gitlab_client as _gc
        _, ticket_count = _gc.get_issues(
            labels=label_name, state="all", per_page=1, page=1
        )
        if ticket_count > 0:
            raise HTTPException(
                status_code=409,
                detail=f"'{st.emoji} {st.label}' 카테고리를 사용 중인 티켓이 {ticket_count}건 있어 삭제할 수 없습니다. "
                       f"해당 티켓의 카테고리를 먼저 변경하거나 '비활성화'를 사용하세요.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("서비스 유형 삭제 전 티켓 수 조회 실패 (삭제 진행): %s", e)

    db.delete(st)
    db.commit()




# ---------------------------------------------------------------------------
# Label cleanup
# ---------------------------------------------------------------------------

@router.post("/cleanup-labels")
def cleanup_labels(
    project_id: Optional[str] = None,
    _user: dict = Depends(require_admin),
):
    """그룹 라벨과 중복되는 프로젝트 레벨 라벨을 삭제한다 (admin 전용).

    project_id를 지정하지 않으면 ITSM 메인 프로젝트에 대해 실행한다.
    """
    from .. import gitlab_client
    s = get_settings()
    if not s.GITLAB_GROUP_ID or not s.GITLAB_GROUP_TOKEN:
        raise HTTPException(
            status_code=400,
            detail="그룹 라벨 설정(GITLAB_GROUP_ID, GITLAB_GROUP_TOKEN)이 필요합니다.",
        )
    try:
        result = gitlab_client.cleanup_duplicate_project_labels(project_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"라벨 정리 실패: {e}")


# ---------------------------------------------------------------------------
# Escalation policies
# ---------------------------------------------------------------------------

class EscalationPolicyCreate(BaseModel):
    name: str
    priority: Optional[str] = None   # None = 전체 우선순위 적용
    trigger: str                      # "warning" | "breach"
    delay_minutes: int = 0
    action: str                       # "notify" | "reassign" | "upgrade_priority"
    target_user_id: Optional[str] = None
    target_user_name: Optional[str] = None
    notify_email: Optional[str] = None
    enabled: bool = True


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

    class Config:
        from_attributes = True


@router.get("/escalation-policies", response_model=list[EscalationPolicyResponse])
def list_escalation_policies(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 목록 조회."""
    return db.query(EscalationPolicy).order_by(EscalationPolicy.id).all()


@router.post("/escalation-policies", response_model=EscalationPolicyResponse, status_code=201)
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

    policy = EscalationPolicy(**body.model_dump(), created_by=user["username"])
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@router.put("/escalation-policies/{policy_id}", response_model=EscalationPolicyResponse)
def update_escalation_policy(
    policy_id: int,
    body: EscalationPolicyCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 수정."""
    policy = db.query(EscalationPolicy).filter(EscalationPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(404, "정책을 찾을 수 없습니다.")
    for key, val in body.model_dump().items():
        setattr(policy, key, val)
    db.commit()
    db.refresh(policy)
    return policy


@router.delete("/escalation-policies/{policy_id}", status_code=204)
def delete_escalation_policy(
    policy_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """에스컬레이션 정책 삭제 (실행 기록도 함께 삭제)."""
    policy = db.query(EscalationPolicy).filter(EscalationPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(404, "정책을 찾을 수 없습니다.")
    db.query(EscalationRecord).filter(EscalationRecord.policy_id == policy_id).delete()
    db.delete(policy)
    db.commit()


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------

class EmailTemplateResponse(BaseModel):
    id: int
    event_type: str
    subject: str
    html_body: str
    enabled: bool
    updated_by: Optional[str]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


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


@router.get("/email-templates", response_model=list[EmailTemplateResponse])
def list_email_templates(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """이메일 템플릿 목록 조회."""
    return db.query(EmailTemplate).order_by(EmailTemplate.event_type).all()


@router.get("/email-templates/{event_type}", response_model=EmailTemplateResponse)
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


@router.put("/email-templates/{event_type}", response_model=EmailTemplateResponse)
def update_email_template(
    event_type: str,
    body: EmailTemplateUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """이메일 템플릿 수정. Jinja2 문법 검증 후 저장."""
    # Jinja2 문법 유효성 검사
    try:
        from jinja2 import Environment, select_autoescape, TemplateSyntaxError
        env = Environment(autoescape=select_autoescape(["html"]))
        env.parse(body.subject)
        env.parse(body.html_body)
    except Exception as e:
        raise HTTPException(400, f"템플릿 문법 오류: {e}")

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


@router.post("/email-templates/{event_type}/preview")
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
        from jinja2 import Environment, select_autoescape
        env = Environment(autoescape=select_autoescape(["html"]))
        subject = env.from_string(body.subject).render(**sample_ctx)
        html_body = env.from_string(body.html_body).render(**sample_ctx)
        return {"subject": subject, "html_body": html_body}
    except Exception as e:
        raise HTTPException(400, f"렌더링 오류: {e}")



# ---------------------------------------------------------------------------
# Outbound Webhooks
# ---------------------------------------------------------------------------

from ..outbound_webhook import SUPPORTED_EVENTS as _WEBHOOK_EVENTS


class OutboundWebhookCreate(BaseModel):
    name: str
    url: str
    secret: Optional[str] = None
    events: list[str]
    enabled: bool = True


class OutboundWebhookResponse(BaseModel):
    id: int
    name: str
    url: str
    events: list
    enabled: bool
    created_by: str
    created_at: Optional[datetime]
    last_triggered_at: Optional[datetime]
    last_status: Optional[int]

    class Config:
        from_attributes = True


@router.get("/outbound-webhooks", response_model=list[OutboundWebhookResponse])
def list_outbound_webhooks(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    return db.query(OutboundWebhook).order_by(OutboundWebhook.id).all()


@router.post("/outbound-webhooks", response_model=OutboundWebhookResponse, status_code=201)
def create_outbound_webhook(
    body: OutboundWebhookCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from ..security import validate_external_url
    validate_external_url(body.url, "웹훅 URL")
    invalid = [e for e in body.events if e not in _WEBHOOK_EVENTS]
    if invalid:
        raise HTTPException(400, f"지원하지 않는 이벤트: {invalid}. 가능: {sorted(_WEBHOOK_EVENTS)}")
    hook = OutboundWebhook(**body.model_dump(), created_by=user["username"])
    db.add(hook)
    db.commit()
    db.refresh(hook)
    return hook


@router.put("/outbound-webhooks/{hook_id}", response_model=OutboundWebhookResponse)
def update_outbound_webhook(
    hook_id: int,
    body: OutboundWebhookCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    from ..security import validate_external_url
    hook = db.query(OutboundWebhook).filter(OutboundWebhook.id == hook_id).first()
    if not hook:
        raise HTTPException(404, "웹훅을 찾을 수 없습니다.")
    validate_external_url(body.url, "웹훅 URL")
    for k, v in body.model_dump().items():
        setattr(hook, k, v)
    db.commit()
    db.refresh(hook)
    return hook


@router.delete("/outbound-webhooks/{hook_id}", status_code=204)
def delete_outbound_webhook(
    hook_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    hook = db.query(OutboundWebhook).filter(OutboundWebhook.id == hook_id).first()
    if not hook:
        raise HTTPException(404, "웹훅을 찾을 수 없습니다.")
    db.delete(hook)
    db.commit()


@router.post("/outbound-webhooks/{hook_id}/test")
def test_outbound_webhook(
    hook_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """테스트 페이로드를 발송해 연결 상태를 확인한다."""
    from ..outbound_webhook import _send_one
    hook = db.query(OutboundWebhook).filter(OutboundWebhook.id == hook_id).first()
    if not hook:
        raise HTTPException(404, "웹훅을 찾을 수 없습니다.")
    status = _send_one(hook.url, {"event": "test", "message": "ITSM 웹훅 테스트"}, hook.secret)
    return {"status": status, "success": 200 <= status < 300}


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

@router.get("/sessions/{gitlab_user_id}")
def list_user_sessions(gitlab_user_id: int, db: Session = Depends(get_db), _user: dict = Depends(require_admin)):
    """사용자의 활성 세션(리프레시 토큰) 목록."""
    from ..models import RefreshToken
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    sessions = db.query(RefreshToken).filter(
        RefreshToken.gitlab_user_id == str(gitlab_user_id),
        RefreshToken.revoked == False,
        RefreshToken.expires_at > now,
    ).order_by(RefreshToken.last_used_at.desc().nullslast()).all()
    return [{"id": s.id, "device_name": s.device_name, "ip_address": s.ip_address,
             "last_used_at": s.last_used_at.isoformat() if s.last_used_at else None,
             "expires_at": s.expires_at.isoformat()} for s in sessions]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: int, db: Session = Depends(get_db), _user: dict = Depends(require_admin)):
    """특정 세션 강제 폐기."""
    from ..models import RefreshToken
    s = db.query(RefreshToken).filter(RefreshToken.id == session_id).first()
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    s.revoked = True
    db.commit()


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------

from ..models import Announcement as AnnouncementModel
from datetime import datetime as _dt, timezone as _tz


class AnnouncementCreate(BaseModel):
    title: str
    content: str
    type: str = "info"
    enabled: bool = True
    expires_at: Optional[datetime] = None


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    content: str
    type: str
    enabled: bool
    expires_at: Optional[datetime]
    created_by: str
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# GitLab 라벨 동기화 관리
# ---------------------------------------------------------------------------

@router.get("/label-status")
def get_label_status(_user: dict = Depends(require_admin)):
    """GitLab 프로젝트·그룹의 라벨 동기화 현황을 반환한다."""
    from .. import gitlab_client as _gc
    return _gc.get_label_sync_status()


@router.post("/sync-labels", status_code=200)
def sync_all_labels(_user: dict = Depends(require_admin)):
    """모든 필수 라벨(status/prio/cat)을 GitLab에 강제 동기화한다."""
    from .. import gitlab_client as _gc
    from ..gitlab_client import REQUIRED_LABELS, get_category_labels_from_db
    all_labels = list(REQUIRED_LABELS) + get_category_labels_from_db()
    results = {"synced": [], "failed": []}
    for name, color in all_labels:
        ok = _gc.sync_label_to_gitlab(name, color)
        if ok:
            results["synced"].append(name)
        else:
            results["failed"].append(name)
    logger.info("Label sync: %d synced, %d failed", len(results["synced"]), len(results["failed"]))
    return results


@router.get("/announcements", response_model=list[AnnouncementResponse])
def list_announcements(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 전체 목록 조회 (관리자)."""
    return db.query(AnnouncementModel).order_by(AnnouncementModel.created_at.desc()).all()


@router.post("/announcements", response_model=AnnouncementResponse, status_code=201)
def create_announcement(
    body: AnnouncementCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공지사항 생성 (관리자)."""
    allowed_types = {"info", "warning", "critical"}
    if body.type not in allowed_types:
        raise HTTPException(400, f"type은 {allowed_types} 중 하나여야 합니다.")
    ann = AnnouncementModel(
        title=body.title,
        content=body.content,
        type=body.type,
        enabled=body.enabled,
        expires_at=body.expires_at,
        created_by=user.get("username", ""),
        created_at=_dt.now(_tz.utc),
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@router.put("/announcements/{ann_id}", response_model=AnnouncementResponse)
def update_announcement(
    ann_id: int,
    body: AnnouncementCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 수정 (관리자)."""
    ann = db.query(AnnouncementModel).filter(AnnouncementModel.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    ann.title = body.title
    ann.content = body.content
    ann.type = body.type
    ann.enabled = body.enabled
    ann.expires_at = body.expires_at
    db.commit()
    db.refresh(ann)
    return ann


@router.delete("/announcements/{ann_id}", status_code=204)
def delete_announcement(
    ann_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 삭제 (관리자)."""
    ann = db.query(AnnouncementModel).filter(AnnouncementModel.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    db.delete(ann)
    db.commit()


# ---------------------------------------------------------------------------
# API 키 관리
# ---------------------------------------------------------------------------

import hashlib as _hashlib
import secrets as _secrets


_API_KEY_SCOPES = ["tickets:read", "tickets:write", "kb:read", "kb:write", "webhooks:write"]


class ApiKeyCreate(BaseModel):
    name: str
    scopes: list[str]
    expires_days: Optional[int] = None  # None = 무기한


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list
    created_by: str
    created_at: Optional[datetime]
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    revoked: bool

    class Config:
        from_attributes = True


@router.get("/api-keys", response_model=list[ApiKeyResponse])
def list_api_keys(db: Session = Depends(get_db), _user: dict = Depends(require_admin)):
    from ..models import ApiKey
    return db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()


@router.post("/api-keys", status_code=201)
def create_api_key(
    body: ApiKeyCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """API 키 발급. raw 키는 응답에서 한 번만 반환 — 재조회 불가."""
    from ..models import ApiKey
    from datetime import timezone as _tz, timedelta

    invalid_scopes = [s for s in body.scopes if s not in _API_KEY_SCOPES]
    if invalid_scopes:
        raise HTTPException(400, f"유효하지 않은 스코프: {invalid_scopes}. 가능: {_API_KEY_SCOPES}")

    # itsm_live_ + 32자 랜덤
    raw_key = "itsm_live_" + _secrets.token_urlsafe(24)
    prefix = raw_key[:16]
    key_hash = _hashlib.sha256(raw_key.encode()).hexdigest()

    expires_at = None
    if body.expires_days:
        expires_at = (datetime.now(_tz.utc) + timedelta(days=body.expires_days)).replace(tzinfo=None)

    rec = ApiKey(
        name=body.name,
        key_prefix=prefix,
        key_hash=key_hash,
        scopes=body.scopes,
        created_by=user["username"],
        expires_at=expires_at,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return {
        "id": rec.id,
        "name": rec.name,
        "key": raw_key,  # 한 번만 반환
        "key_prefix": prefix,
        "scopes": rec.scopes,
        "expires_at": rec.expires_at.isoformat() if rec.expires_at else None,
        "warning": "이 키는 지금만 표시됩니다. 안전한 곳에 저장하세요.",
    }


@router.delete("/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    from ..models import ApiKey
    rec = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not rec:
        raise HTTPException(404, "API 키를 찾을 수 없습니다.")
    rec.revoked = True
    db.commit()
