"""Admin router: user role management, audit logs, assignment rules."""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ...auth import get_current_user
from ...audit import write_audit_log
from ...config import get_settings
from ...database import get_db
from ...models import UserRole, AuditLog, AssignmentRule, SLAPolicy, ServiceType, OutboundWebhook, SystemSetting, Rating, SLARecord, CustomFieldDef, TicketCustomValue
from ...rbac import require_agent, require_admin
from ...rate_limit import limiter
from ...schemas import (
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
    except Exception as e:
        logger.warning("_fetch_gitlab_users_bulk failed: %s", e)
    return {}

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# User role management
# ---------------------------------------------------------------------------

class RolePatch(BaseModel):
    role: str  # admin|agent|user


@router.get("/users")
def list_users(
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """H-6: 페이지네이션 추가 — 사용자 수 급증 시 응답 크기 제한."""
    q = db.query(UserRole).filter(UserRole.gitlab_user_id != 1).order_by(UserRole.username)
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()
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
    return {"total": total, "page": page, "per_page": per_page, "items": result}


@router.patch("/users/{gitlab_user_id}")
def update_user_role(
    request: Request,
    gitlab_user_id: int,
    data: RolePatch,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    # 고위험 작업 — Sudo 재인증 검증 (VULN-07: 쿠키 기반으로 변경)
    from ...routers.auth import verify_sudo_token
    verify_sudo_token(request, user, db)

    # 자기 자신 역할 변경 방지 (관리자 없는 상태 방지)
    if str(user.get("sub")) == str(gitlab_user_id):
        raise HTTPException(status_code=400, detail="자기 자신의 역할은 변경할 수 없습니다.")

    allowed = {"admin", "agent", "pl", "developer", "user"}
    if data.role not in allowed:
        raise HTTPException(status_code=400, detail=f"허용된 역할: {', '.join(allowed)}")

    record = db.query(UserRole).filter(UserRole.gitlab_user_id == gitlab_user_id).with_for_update().first()
    if not record:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 마지막 관리자 다운그레이드 방지 (SELECT FOR UPDATE로 경쟁 조건 방지)
    if record.role == "admin" and data.role != "admin":
        admin_count = db.query(UserRole).filter(
            UserRole.role == "admin",
            UserRole.is_active == True,  # noqa: E712
        ).with_for_update().count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="최소 1명의 관리자가 필요합니다. 다른 관리자를 먼저 지정해주세요.")

    old_role = record.role
    record.role = data.role
    record.updated_at = datetime.now(timezone.utc)
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

# MED-01: 감사 로그 필터 허용값 allowlist
_AUDIT_RESOURCE_TYPES = {
    "ticket", "comment", "user", "sla", "auth", "custom_field",
    "label", "assignment_rule", "service_type", "escalation_policy",
    "email_template", "outbound_webhook", "quick_reply", "template",
    "api_key", "announcement", "kb_article", "system",
}
_AUDIT_ACTION_PREFIX_ALLOWLIST = {
    "ticket.", "comment.", "user.", "sla.", "auth.", "custom_field.",
    "label.", "assignment_rule.", "service_type.", "escalation.",
    "email_template.", "webhook.", "quick_reply.", "template.",
    "api_key.", "announcement.", "kb.", "holiday.", "system.",
}


def _build_audit_query(db: Session, resource_type=None, actor_id=None, action=None, from_date=None, to_date=None, actor_username=None):
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
        # MED-01: allowlist 검증
        if resource_type not in _AUDIT_RESOURCE_TYPES:
            resource_type = None  # 허용되지 않은 값은 무시
        else:
            q = q.filter(AuditLog.resource_type == resource_type)
    if actor_id:
        q = q.filter(AuditLog.actor_id == actor_id)
    if actor_username:
        # LIKE 메타문자(%, _) 이스케이프 — 의도치 않은 와일드카드 매칭 방지
        escaped = actor_username.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.filter(AuditLog.actor_username.ilike(f"%{escaped}%", escape="\\"))
    if action:
        # MED-01: action은 prefix allowlist 검증
        if not any(action.startswith(p) for p in _AUDIT_ACTION_PREFIX_ALLOWLIST):
            action = None
        else:
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
    page: int = Query(default=1, ge=1, le=10000),
    per_page: int = Query(default=50, ge=1, le=200),
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_username: Optional[str] = None,
    action: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    q = _build_audit_query(db, resource_type, actor_id, action, from_date, to_date, actor_username)
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()  # list of (AuditLog, display_name)
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "logs": [_audit_row_to_dict(r) for r in rows],
    }


@router.get("/audit/download")
@limiter.limit("5/minute")
def download_audit_logs(
    request: Request,
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_username: Optional[str] = Query(None),
    action: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """감사 로그 CSV 다운로드 (최대 10,000건, 청크 스트리밍). 관리자 전용."""
    from ...routers.auth import verify_sudo_token
    verify_sudo_token(request, user, db)
    q = _build_audit_query(db, resource_type, actor_id, action, from_date, to_date, actor_username)

    def _generate():
        # BOM + 헤더
        header = io.StringIO()
        csv.writer(header).writerow(["ID", "시간", "행위자(username)", "이름", "역할", "액션", "대상 유형", "대상 ID", "IP"])
        yield header.getvalue().encode("utf-8-sig")

        # 500건씩 청크 스트리밍 — 전체를 메모리에 올리지 않음
        batch_size = 500
        offset = 0
        while offset < 10000:
            batch = q.offset(offset).limit(batch_size).all()
            if not batch:
                break
            chunk = io.StringIO()
            w = csv.writer(chunk)
            for log, display_name in batch:
                w.writerow([
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
            yield chunk.getvalue().encode("utf-8")
            offset += batch_size

    filename = f"audit_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        _generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},  # LOW-01
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
    from ...models import SLARecord
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
    response_hours: int = Field(..., ge=1, le=8760, description="최초 응답 목표 시간 (최소 1시간, 최대 1년)")
    resolve_hours: int = Field(..., ge=1, le=8760, description="해결 목표 시간 (최소 1시간, 최대 1년)")


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
        policy = SLAPolicy(
            priority=priority,
            response_hours=data.response_hours,
            resolve_hours=data.resolve_hours,
            updated_by=user.get("username", ""),
        )
        db.add(policy)
    else:
        policy.response_hours = data.response_hours
        policy.resolve_hours = data.resolve_hours
        policy.updated_by = user.get("username", "")
        policy.updated_at = datetime.now(timezone.utc)

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
    """서비스 유형별 사용 중인 티켓 수를 반환한다 (병렬 조회, 5분 캐시)."""
    import json as _json
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ... import gitlab_client as _gc

    _CACHE_KEY = "itsm:admin:service_type_usage"
    _CACHE_TTL = 300  # 5분

    # Redis 캐시 확인
    try:
        from ...redis_client import get_redis as _get_redis
        _r = _get_redis()
        if _r:
            cached = _r.get(_CACHE_KEY)
            if cached:
                return _json.loads(cached)
    except Exception:
        _r = None

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

    # 캐시 저장
    try:
        if _r:
            _r.setex(_CACHE_KEY, _CACHE_TTL, _json.dumps(result))
    except Exception:
        pass

    return result  # {service_type_id: ticket_count}


@router.get("/service-types")
def list_service_types(
    db: Session = Depends(get_db),
):
    """서비스 유형 목록 조회 — 포털 티켓 등록 폼(로그인 전)에서 사용하므로 공개 유지."""
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
        from ... import gitlab_client as _gc
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
        from ... import gitlab_client as _gc
        _gc.sync_label_to_gitlab(f"cat::{st.value}", st.color or "#95a5a6")
    except Exception as e:
        logger.warning("서비스 유형 수정 후 GitLab 라벨 동기화 실패: %s", e)
    return ServiceTypeResponse.model_validate(st).model_dump()


@router.delete("/service-types/{type_id}", status_code=204)
def delete_service_type(
    request: Request,
    type_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from ...routers.auth import verify_sudo_token  # HIGH-03
    verify_sudo_token(request, user, db)
    st = db.query(ServiceType).filter(ServiceType.id == type_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="서비스 유형을 찾을 수 없습니다.")

    # 해당 카테고리(cat::N)를 사용 중인 티켓 수 확인
    label_name = f"cat::{st.value}"
    try:
        from ... import gitlab_client as _gc
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
    from ... import gitlab_client
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
        logger.error("cleanup_duplicate_project_labels error: %s", e)
        raise HTTPException(status_code=502, detail="라벨 정리 중 오류가 발생했습니다.")


# ---------------------------------------------------------------------------
# Outbound Webhooks
# ---------------------------------------------------------------------------

from ...outbound_webhook import SUPPORTED_EVENTS as _WEBHOOK_EVENTS


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

    model_config = ConfigDict(from_attributes=True)


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
    from ...security import validate_external_url
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
    from ...security import validate_external_url
    hook = db.query(OutboundWebhook).filter(OutboundWebhook.id == hook_id).with_for_update().first()
    if not hook:
        raise HTTPException(404, "웹훅을 찾을 수 없습니다.")
    validate_external_url(body.url, "웹훅 URL")
    invalid = [e for e in body.events if e not in _WEBHOOK_EVENTS]
    if invalid:
        raise HTTPException(400, f"지원하지 않는 이벤트: {invalid}. 가능: {sorted(_WEBHOOK_EVENTS)}")
    for k, v in body.model_dump().items():
        setattr(hook, k, v)
    db.commit()
    db.refresh(hook)
    return hook


@router.delete("/outbound-webhooks/{hook_id}", status_code=204)
def delete_outbound_webhook(
    request: Request,
    hook_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from ...routers.auth import verify_sudo_token  # HIGH-03
    verify_sudo_token(request, user, db)
    hook = db.query(OutboundWebhook).filter(OutboundWebhook.id == hook_id).first()
    if not hook:
        raise HTTPException(404, "웹훅을 찾을 수 없습니다.")
    db.delete(hook)
    db.commit()


@router.post("/outbound-webhooks/{hook_id}/test")
@(limiter.limit("10/minute") if limiter else lambda f: f)
def test_outbound_webhook(
    request: Request,
    hook_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """테스트 페이로드를 발송해 연결 상태를 확인한다."""
    from ...outbound_webhook import _send_one
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
    from ...models import RefreshToken
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
    from ...models import RefreshToken
    s = db.query(RefreshToken).filter(RefreshToken.id == session_id).with_for_update().first()
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    s.revoked = True
    db.commit()


# ---------------------------------------------------------------------------
# GitLab 라벨 동기화 관리
# ---------------------------------------------------------------------------

@router.get("/label-status")
def get_label_status(_user: dict = Depends(require_admin)):
    """GitLab 프로젝트·그룹의 라벨 동기화 현황을 반환한다."""
    from ... import gitlab_client as _gc
    return _gc.get_label_sync_status()


@router.post("/sync-labels", status_code=200)
def sync_all_labels(_user: dict = Depends(require_admin)):
    """모든 필수 라벨(status/prio/cat)을 GitLab에 강제 동기화한다."""
    from ... import gitlab_client as _gc
    from ...gitlab_client import REQUIRED_LABELS, get_category_labels_from_db
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


@router.get("/filter-options")
def get_filter_options(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 목록 필터에 필요한 옵션(상태·우선순위·카테고리)을 동적으로 반환한다.

    - 상태: 워크플로우에 정의된 STATUS_KO 기반
    - 우선순위: SLA 정책 테이블에서 조회 (없으면 기본값 사용)
    - 카테고리: service_types 테이블에서 조회
    """
    from ...models import SLAPolicy

    # ── 상태 (워크플로우 정의, 관리자 Label Sync 기준) ──────────────────
    statuses = [
        {"key": "open",              "label": "접수됨",      "color": "yellow"},
        {"key": "approved",          "label": "승인완료",    "color": "teal"},
        {"key": "in_progress",       "label": "처리중",      "color": "blue"},
        {"key": "waiting",           "label": "대기중",      "color": "orange"},
        {"key": "resolved",          "label": "처리완료",    "color": "purple"},
        {"key": "testing",           "label": "테스트중",    "color": "violet"},
        {"key": "ready_for_release", "label": "운영배포전",  "color": "amber"},
        {"key": "released",          "label": "운영반영완료","color": "indigo"},
        {"key": "closed",            "label": "종료됨",      "color": "green"},
    ]

    # ── 우선순위 (SLA 정책 테이블에서 동적 생성) ────────────────────────
    _PRIORITY_DEFAULT = [
        {"key": "critical", "label": "긴급", "color": "red"},
        {"key": "high",     "label": "높음", "color": "orange"},
        {"key": "medium",   "label": "보통", "color": "yellow"},
        {"key": "low",      "label": "낮음", "color": "gray"},
    ]
    _PRIORITY_ORDER = ["critical", "high", "medium", "low"]
    try:
        policies = db.query(SLAPolicy).all()
        if policies:
            policy_map = {p.priority: p for p in policies}
            priorities = [
                {
                    "key": prio,
                    "label": {"critical": "긴급", "high": "높음", "medium": "보통", "low": "낮음"}.get(prio, prio),
                    "color": {"critical": "red", "high": "orange", "medium": "yellow", "low": "gray"}.get(prio, "gray"),
                    "response_hours": policy_map[prio].response_hours if prio in policy_map else None,
                    "resolve_hours": policy_map[prio].resolve_hours if prio in policy_map else None,
                }
                for prio in _PRIORITY_ORDER if prio in policy_map or True
            ]
        else:
            priorities = _PRIORITY_DEFAULT
    except Exception:
        priorities = _PRIORITY_DEFAULT

    # ── 카테고리 (service_types 테이블) ─────────────────────────────────
    service_types = db.query(ServiceType).filter(ServiceType.enabled == True).order_by(ServiceType.sort_order, ServiceType.id).all()  # noqa: E712
    categories = [
        {
            "key": st.description or st.value,
            "label": st.label,
            "emoji": st.emoji,
            "color": st.color,
        }
        for st in service_types
    ]

    return {
        "statuses":   statuses,
        "priorities": priorities,
        "categories": categories,
    }


# ---------------------------------------------------------------------------
# 역할 표시명 설정
# ---------------------------------------------------------------------------

_ROLE_LABEL_DEFAULTS: dict[str, str] = {
    "admin":     "시스템관리자",
    "agent":     "IT 담당자",
    "pl":        "PL",
    "developer": "개발자",
    "user":      "일반 사용자",
}


@router.get("/role-labels")
def get_role_labels(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """역할 표시명 반환."""
    rows = {
        r.key[len("role_label."):]: r.value
        for r in db.query(SystemSetting).filter(SystemSetting.key.like("role_label.%")).all()
    }
    return {role: rows.get(role, default) for role, default in _ROLE_LABEL_DEFAULTS.items()}


@router.put("/role-labels")
def put_role_labels(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """역할 표시명 저장 — 관리자 전용."""
    now = datetime.now(timezone.utc)
    actor_name = user.get("name") or user.get("username", "")
    saved: dict[str, str] = {}
    for role, label in data.items():
        if role not in _ROLE_LABEL_DEFAULTS:
            continue
        label = str(label).strip()[:50]
        if not label:
            continue
        key = f"role_label.{role}"
        row = db.query(SystemSetting).filter(SystemSetting.key == key).with_for_update().first()
        if row:
            row.value = label
            row.updated_by = actor_name
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=label, updated_by=actor_name, updated_at=now))
        saved[role] = label
    db.commit()
    write_audit_log(db, user=user, action="update", resource_type="role_labels",
                    resource_id="global", new_value=saved, request=request)
    return {role: saved.get(role, default) for role, default in _ROLE_LABEL_DEFAULTS.items()}


# 알림 채널 설정 (이메일 / 텔레그램 enable/disable)
# ---------------------------------------------------------------------------

_CHANNEL_KEYS = ("email_enabled", "telegram_enabled", "slack_enabled")
_SETTINGS_CACHE_TTL = 60


def _invalidate_settings_cache(*keys: str) -> None:
    from ...redis_client import get_redis
    r = get_redis()
    if r:
        for key in keys:
            try:
                r.delete(f"itsm:settings:{key}")
            except Exception:
                pass


class NotificationChannelPatch(BaseModel):
    email_enabled: Optional[bool] = None
    telegram_enabled: Optional[bool] = None
    slack_enabled: Optional[bool] = None


@router.get("/notification-channels")
def get_notification_channels(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """이메일·텔레그램·Slack 채널 활성화 상태와 인프라(env) 설정 여부를 반환한다."""
    settings = get_settings()
    rows = {r.key: r.value for r in db.query(SystemSetting).filter(SystemSetting.key.in_(list(_CHANNEL_KEYS))).all()}
    return {
        "email_enabled": rows.get("email_enabled", "true") == "true",
        "telegram_enabled": rows.get("telegram_enabled", "true") == "true",
        "slack_enabled": rows.get("slack_enabled", "true") == "true",
        "email_configured": bool(settings.NOTIFICATION_ENABLED and settings.SMTP_HOST),
        "telegram_configured": bool(settings.TELEGRAM_ENABLED and settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID),
        "slack_configured": bool(settings.SLACK_ENABLED and settings.SLACK_WEBHOOK_URL),
    }


@router.patch("/notification-channels")
def patch_notification_channels(
    data: NotificationChannelPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """이메일·텔레그램 채널 활성화 상태를 변경한다."""
    now = datetime.now(timezone.utc)
    actor_name = user.get("name") or user.get("username", "")
    changed = {}

    def _upsert(key: str, value: bool) -> None:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).with_for_update().first()
        val_str = "true" if value else "false"
        if row:
            row.value = val_str
            row.updated_by = actor_name
            row.updated_at = now
        else:
            db.add(SystemSetting(key=key, value=val_str, updated_by=actor_name, updated_at=now))
        changed[key] = value

    if data.email_enabled is not None:
        _upsert("email_enabled", data.email_enabled)
    if data.telegram_enabled is not None:
        _upsert("telegram_enabled", data.telegram_enabled)
    if data.slack_enabled is not None:
        _upsert("slack_enabled", data.slack_enabled)

    if not changed:
        raise HTTPException(status_code=400, detail="변경할 설정이 없습니다.")

    db.commit()
    _invalidate_settings_cache(*changed.keys())
    write_audit_log(
        db,
        user=user,
        action="update",
        resource_type="notification_channel",
        resource_id="global",
        new_value=changed,
        request=request,
    )
    return changed


# ---------------------------------------------------------------------------
# 사용자별 업무 할당 & 처리량 통계
# ---------------------------------------------------------------------------

@router.get("/workload")
def get_workload(
    from_date: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    to_date:   Optional[str] = Query(default=None, description="YYYY-MM-DD"),
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """사용자별 담당 티켓 수·처리 건수·평균 처리 시간·SLA 달성률·평점을 집계한다."""
    from datetime import date as _date, datetime as _datetime, time as _dt_time
    from ... import gitlab_client as _gl

    # 날짜 파싱
    def _parse(d: Optional[str], end: bool = False):
        if not d:
            return None
        dt = _datetime.combine(_date.fromisoformat(d), _dt_time.max if end else _dt_time.min)
        return dt

    from_dt = _parse(from_date)
    to_dt   = _parse(to_date, end=True)
    from_iso = from_dt.isoformat() if from_dt else None
    to_iso   = to_dt.isoformat()   if to_dt   else None

    # GitLab 이슈 전체 수집
    all_issues: list[dict] = []
    page = 1
    while True:
        issues, total = _gl.get_issues(
            state="all", per_page=100, page=page,
            project_id=project_id,
            created_after=from_iso, created_before=to_iso,
        )
        all_issues.extend(issues)
        if not issues or len(all_issues) >= total or page >= 50:
            break
        page += 1

    # 사용자 관리의 전체 사용자를 기반으로 초기화 (root 제외)
    db_users = db.query(UserRole).filter(UserRole.gitlab_user_id != 1).all()
    gitlab_info = _fetch_gitlab_users_bulk([u.gitlab_user_id for u in db_users])

    users: dict[str, dict] = {}
    for u in db_users:
        gl = gitlab_info.get(u.gitlab_user_id, {})
        users[u.username] = {
            "username":       u.username,
            "name":           gl.get("name") or u.username,
            "avatar_url":     gl.get("avatar_url"),
            "assigned":       0,
            "open":           0,
            "in_progress":    0,
            "resolved":       0,
            "closed":         0,
            "_resolve_hours": [],
        }

    # 사용자별 집계
    for issue in all_issues:
        assignees = issue.get("assignees") or []
        if not assignees:
            continue
        a = assignees[0]
        key = a.get("username", "unknown")
        if key not in users:
            # UserRole에 없는 GitLab 사용자(예: 외부 기여자)는 스킵
            continue

        u = users[key]
        u["assigned"] += 1

        state  = issue.get("state", "")
        labels = issue.get("labels", [])
        status_lbl = next((l[8:] for l in labels if l.startswith("status::")), None)

        if state == "closed":
            u["closed"] += 1
            # 처리 시간 계산
            created_at = issue.get("created_at")
            closed_at  = issue.get("closed_at") or issue.get("updated_at")
            if created_at and closed_at:
                try:
                    t0 = _datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    t1 = _datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
                    hrs = (t1 - t0).total_seconds() / 3600
                    if hrs >= 0:
                        u["_resolve_hours"].append(round(hrs, 2))
                except Exception:
                    pass
        elif status_lbl in ("in_progress", "waiting", "testing",
                            "ready_for_release", "released"):
            u["in_progress"] += 1
        elif status_lbl in ("approved", "resolved"):
            u["resolved"] += 1
        else:
            u["open"] += 1

    # SLA 달성률 (DB)
    sla_q = db.query(SLARecord)
    if project_id:
        sla_q = sla_q.filter(SLARecord.project_id == project_id)
    if from_dt:
        sla_q = sla_q.filter(SLARecord.created_at >= from_dt)
    if to_dt:
        sla_q = sla_q.filter(SLARecord.created_at <= to_dt)
    sla_records = {r.gitlab_issue_iid: r for r in sla_q.all()}

    iid_to_user: dict[int, str] = {
        issue["iid"]: (issue.get("assignees") or [{}])[0].get("username", "unknown")
        for issue in all_issues
        if issue.get("assignees")
    }

    sla_agg: dict[str, dict] = {}
    for iid, rec in sla_records.items():
        uname = iid_to_user.get(iid)
        if not uname or uname not in users:
            continue
        agg = sla_agg.setdefault(uname, {"met": 0, "total": 0})
        agg["total"] += 1
        if not rec.breached:
            agg["met"] += 1

    # 만족도 평점 (DB)
    rating_q = db.query(Rating)
    if from_dt:
        rating_q = rating_q.filter(Rating.created_at >= from_dt)
    if to_dt:
        rating_q = rating_q.filter(Rating.created_at <= to_dt)
    rating_scores: dict[str, list[int]] = {}
    for r in rating_q.all():
        uname = iid_to_user.get(r.gitlab_issue_iid)
        if uname and uname in users:
            rating_scores.setdefault(uname, []).append(r.score)

    # 결과 조립
    result = []
    for key, u in users.items():
        hrs = u.pop("_resolve_hours")
        sla = sla_agg.get(key, {"met": 0, "total": 0})
        scores = rating_scores.get(key, [])
        assigned = u["assigned"]
        closed   = u["closed"]
        result.append({
            "username":          u["username"],
            "name":              u["name"],
            "avatar_url":        u["avatar_url"],
            "assigned":          assigned,
            "open":              u["open"],
            "in_progress":       u["in_progress"],
            "resolved":          u["resolved"],
            "closed":            closed,
            "backlog":           u["open"] + u["in_progress"],
            "resolution_rate":   round(closed / assigned * 100, 1) if assigned else None,
            "avg_resolve_hours": round(sum(hrs) / len(hrs), 1) if hrs else None,
            "sla_met":           sla["met"],
            "sla_total":         sla["total"],
            "sla_met_rate":      round(sla["met"] / sla["total"] * 100, 1) if sla["total"] else None,
            "avg_rating":        round(sum(scores) / len(scores), 2) if scores else None,
            "rating_count":      len(scores),
        })

    result.sort(key=lambda x: x["assigned"], reverse=True)
    return result


# ---------------------------------------------------------------------------
# 커스텀 필드 관리
# ---------------------------------------------------------------------------

class CustomFieldCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., min_length=1, max_length=200)
    field_type: str = Field(default="text", pattern=r"^(text|number|select|checkbox)$")
    options: list[str] = Field(default_factory=list)
    required: bool = False
    sort_order: int = 0


class CustomFieldUpdate(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=200)
    field_type: Optional[str] = Field(default=None, pattern=r"^(text|number|select|checkbox)$")
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


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


@router.get("/custom-fields", response_model=list[dict])
def list_custom_fields(
    include_disabled: bool = False,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = db.query(CustomFieldDef)
    if not include_disabled:
        q = q.filter(CustomFieldDef.enabled == True)  # noqa: E712
    fields = q.order_by(CustomFieldDef.sort_order, CustomFieldDef.id).all()
    return [_field_to_dict(f) for f in fields]


@router.post("/custom-fields", response_model=dict, status_code=201)
def create_custom_field(
    request: Request,
    data: CustomFieldCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    if db.query(CustomFieldDef).filter(CustomFieldDef.name == data.name).first():
        raise HTTPException(status_code=409, detail="동일한 이름의 커스텀 필드가 이미 존재합니다.")
    if data.field_type == "select" and not data.options:
        raise HTTPException(status_code=400, detail="select 타입은 옵션 목록이 필요합니다.")
    f = CustomFieldDef(
        name=data.name,
        label=data.label,
        field_type=data.field_type,
        options=data.options,
        required=data.required,
        sort_order=data.sort_order,
        created_by=user.get("username", ""),
    )
    db.add(f); db.commit(); db.refresh(f)
    write_audit_log(db, user, "custom_field.create", "custom_field", str(f.id), request=request,
                    new_value={"name": f.name, "label": f.label})
    return _field_to_dict(f)


@router.patch("/custom-fields/{field_id}", response_model=dict)
def update_custom_field(
    request: Request,
    field_id: int,
    data: CustomFieldUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    f = db.query(CustomFieldDef).filter(CustomFieldDef.id == field_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="커스텀 필드를 찾을 수 없습니다.")
    if data.label is not None: f.label = data.label
    if data.field_type is not None: f.field_type = data.field_type
    if data.options is not None: f.options = data.options
    if data.required is not None: f.required = data.required
    if data.enabled is not None: f.enabled = data.enabled
    if data.sort_order is not None: f.sort_order = data.sort_order
    db.commit(); db.refresh(f)
    write_audit_log(db, user, "custom_field.update", "custom_field", str(f.id), request=request)
    return _field_to_dict(f)


@router.delete("/custom-fields/{field_id}", status_code=204)
def delete_custom_field(
    request: Request,
    field_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    f = db.query(CustomFieldDef).filter(CustomFieldDef.id == field_id).with_for_update().first()
    if not f:
        raise HTTPException(status_code=404, detail="커스텀 필드를 찾을 수 없습니다.")
    # 관련 값 먼저 삭제 (같은 트랜잭션 내에서 직렬화)
    db.query(TicketCustomValue).filter(TicketCustomValue.field_id == field_id).delete(synchronize_session=False)
    db.delete(f); db.commit()
    write_audit_log(db, user, "custom_field.delete", "custom_field", str(field_id), request=request)


# ---------------------------------------------------------------------------
# 이메일 인제스트 모니터링
# ---------------------------------------------------------------------------

@router.get("/email-ingest/status")
def get_email_ingest_status(_user: dict = Depends(require_admin)):
    """이메일 수신 모니터링: 최근 Celery 태스크 결과 및 설정 상태."""
    from ...config import get_settings as _gs
    settings = _gs()
    if not settings.IMAP_ENABLED:
        return {"enabled": False, "recent_results": []}

    recent: list[dict] = []
    try:
        from ...celery_app import celery_app
        # Celery flower 없이 backend에서 최근 태스크 결과 조회
        backend = celery_app.backend
        if hasattr(backend, "_get_task_meta_for"):
            pass  # Redis backend
        # Flower 없이는 개별 task_id를 알아야 조회 가능하므로 Redis에서 직접 스캔
        try:
            redis_client = celery_app.backend.client
            keys = redis_client.keys("celery-task-meta-*")
            import json as _json
            for key in sorted(keys, reverse=True)[:20]:
                raw = redis_client.get(key)
                if not raw:
                    continue
                meta = _json.loads(raw)
                if meta.get("task_id") and "itsm.periodic_email_ingest" in str(meta.get("task_id", "")):
                    recent.append(meta)
        except Exception:
            pass
    except Exception:
        pass

    # Redis에서 태스크 ID로 필터링이 어려우므로 대신 task명 기반 직접 조회
    # Celery beat 실행 결과를 별도로 추적하는 경량 방식 제공
    return {
        "enabled": True,
        "imap_host": settings.IMAP_HOST or "",
        "imap_user": settings.IMAP_USER or "",
        "schedule": "2분마다",
        "recent_results": recent,
    }


@router.post("/email-ingest/trigger", status_code=202)
def trigger_email_ingest(_user: dict = Depends(require_admin)):
    """이메일 수신을 즉시 수동으로 실행한다."""
    try:
        from ...tasks import periodic_email_ingest
        result = periodic_email_ingest.delay()
        return {"task_id": result.id, "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Celery 사용 불가: {e}")


@router.get("/search-index/status")
def get_search_index_status(_user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """ticket_search_index 현황 반환 (총 색인 수, 최근 동기화 시간, pg_trgm 인덱스 상태)."""
    from ...models import TicketSearchIndex
    from sqlalchemy import func, text
    total = db.query(func.count(TicketSearchIndex.id)).scalar() or 0
    last_synced = db.query(func.max(TicketSearchIndex.synced_at)).scalar()

    # pg_trgm GIN 인덱스 존재 여부 확인
    trgm_indexes: list[dict] = []
    try:
        rows = db.execute(text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename IN ('ticket_search_index', 'kb_articles') "
            "AND indexdef ILIKE '%gin%' "
            "ORDER BY indexname"
        )).fetchall()
        trgm_indexes = [{"name": r[0], "definition": r[1]} for r in rows]
    except Exception:
        pass

    # pg_trgm 확장 설치 여부
    trgm_enabled = False
    try:
        row = db.execute(text(
            "SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'"
        )).fetchone()
        trgm_enabled = row is not None
    except Exception:
        pass

    return {
        "total_indexed": total,
        "last_synced_at": last_synced.isoformat() if last_synced else None,
        "trgm_enabled": trgm_enabled,
        "gin_indexes": trgm_indexes,
    }


@router.post("/search-index/sync", status_code=202)
def trigger_search_index_sync(_user: dict = Depends(require_admin)):
    """전문검색 색인 전체 동기화를 즉시 실행한다."""
    try:
        from ...tasks import periodic_search_index_sync
        result = periodic_search_index_sync.delay()
        return {"task_id": result.id, "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Celery 사용 불가: {e}")


# ---------------------------------------------------------------------------
# DB 보존 정책 관리 — 감사로그 / 알림 / 만료 토큰
# ---------------------------------------------------------------------------

@router.get("/db-cleanup/stats")
def get_db_cleanup_stats(_user: dict = Depends(require_admin), db: Session = Depends(get_db)):
    """만료 데이터 현황 (각 테이블 대상 행 수) 조회."""
    from ...models import RefreshToken, GuestToken, Notification, AuditLog
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    cut_notif = now - timedelta(days=90)
    cut_audit = now - timedelta(days=180)

    return {
        "expired_refresh_tokens": db.query(RefreshToken).filter(RefreshToken.expires_at < now).count(),
        "expired_guest_tokens": db.query(GuestToken).filter(GuestToken.expires_at < now).count(),
        "old_read_notifications": db.query(Notification).filter(
            Notification.is_read == True,  # noqa: E712
            Notification.created_at < cut_notif,
        ).count(),
        "old_audit_logs": db.query(AuditLog).filter(AuditLog.created_at < cut_audit).count(),
        "policy": {
            "refresh_token_ttl_days": "expires_at 기준 즉시 삭제",
            "guest_token_ttl_days": "expires_at 기준 즉시 삭제",
            "notification_retention_days": 90,
            "audit_log_retention_days": 180,
            "schedule": "매일 03:00 KST 자동 실행",
        },
    }


@router.post("/db-cleanup/run", status_code=202)
def trigger_db_cleanup(_user: dict = Depends(require_admin)):
    """DB 만료 데이터 정리를 즉시 실행한다."""
    try:
        from ...tasks import periodic_db_cleanup
        result = periodic_db_cleanup.delay()
        return {"task_id": result.id, "status": "queued"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Celery 사용 불가: {e}")


# ---------------------------------------------------------------------------
# Celery 상태
# ---------------------------------------------------------------------------

@router.get("/celery/stats")
def get_celery_stats(_user: dict = Depends(require_admin)):
    """Celery 워커 · 큐 상태를 반환한다."""
    try:
        from ...celery_app import celery_app
        inspect = celery_app.control.inspect(timeout=3)
        active = inspect.active() or {}
        reserved = inspect.reserved() or {}
        workers = list(active.keys())
        active_count = sum(len(v) for v in active.values())
        reserved_count = sum(len(v) for v in reserved.values())

        # 큐별 메시지 수 (Redis 브로커)
        queues: dict[str, int] = {}
        try:
            from ...redis_client import get_redis
            r = get_redis()
            if r:
                for queue_name in ("celery", "itsm_notifications", "itsm_periodic"):
                    length = r.llen(queue_name)
                    if length is not None:
                        queues[queue_name] = length
        except Exception:
            pass

        return {
            "active_tasks": active_count,
            "reserved_tasks": reserved_count,
            "workers": workers,
            "queues": queues,
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Celery 연결 실패: {e}")


# ---------------------------------------------------------------------------
# Redis 캐시 통계
# ---------------------------------------------------------------------------

@router.get("/redis/stats")
def get_redis_stats(_user: dict = Depends(require_admin)):
    """Redis 캐시 통계 — 히트율, 메모리, 연결 수를 반환한다."""
    from ...redis_client import get_redis
    r = get_redis()
    if not r:
        raise HTTPException(status_code=503, detail="Redis 연결 불가")

    try:
        info = r.info()
        keyspace = r.info("keyspace")

        hits = info.get("keyspace_hits", 0)
        misses = info.get("keyspace_misses", 0)
        total = hits + misses
        hit_rate = round(hits / total * 100, 2) if total > 0 else 0.0

        used_memory = info.get("used_memory", 0)
        max_memory = info.get("maxmemory", 0)
        memory_usage_pct = round(used_memory / max_memory * 100, 1) if max_memory > 0 else None

        db_keys: dict[str, int] = {}
        for db_name, db_info in keyspace.items():
            db_keys[db_name] = db_info.get("keys", 0) if isinstance(db_info, dict) else 0
        total_keys = sum(db_keys.values())

        itsm_cache_count = 0
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match="itsm:*", count=500)
            itsm_cache_count += len(keys)
            if cursor == 0:
                break

        return {
            "hit_rate_pct": hit_rate,
            "hits": hits,
            "misses": misses,
            "total_commands": total,
            "used_memory_human": info.get("used_memory_human", "0"),
            "used_memory_bytes": used_memory,
            "max_memory_bytes": max_memory,
            "memory_usage_pct": memory_usage_pct,
            "total_keys": total_keys,
            "itsm_cache_keys": itsm_cache_count,
            "connected_clients": info.get("connected_clients", 0),
            "uptime_seconds": info.get("uptime_in_seconds", 0),
            "redis_version": info.get("redis_version", ""),
            "evicted_keys": info.get("evicted_keys", 0),
            "expired_keys": info.get("expired_keys", 0),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis 통계 수집 실패: {e}")


@router.delete("/redis/cache", status_code=200)
def flush_itsm_cache(_user: dict = Depends(require_admin)):
    """ITSM 전용 캐시 키(itsm:*) 삭제."""
    from ...redis_client import get_redis, scan_delete
    r = get_redis()
    if not r:
        raise HTTPException(status_code=503, detail="Redis 연결 불가")
    try:
        scan_delete(r, "itsm:*")
        return {"message": "ITSM 캐시가 초기화되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"캐시 초기화 실패: {e}")


# ---------------------------------------------------------------------------
# 커서 기반 페이지네이션 — 감사 로그 (대용량 최적화)
# ---------------------------------------------------------------------------

@router.get("/audit/cursor")
def list_audit_cursor(
    cursor_id: int = Query(default=0, description="마지막으로 받은 항목의 ID (0이면 처음)"),
    limit: int = Query(default=50, ge=1, le=200),
    actor_username: Optional[str] = Query(default=None),
    resource_type: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """감사 로그 커서 기반 페이지네이션 (대용량 환경 최적화).

    cursor_id=0 → 가장 최신부터, cursor_id=N → N보다 작은(오래된) 항목부터
    """
    q = db.query(AuditLog)
    if cursor_id > 0:
        q = q.filter(AuditLog.id < cursor_id)
    if actor_username:
        q = q.filter(AuditLog.actor_username == actor_username)
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    if action:
        q = q.filter(AuditLog.action == action)

    items = q.order_by(AuditLog.id.desc()).limit(limit + 1).all()
    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    def _to_dict(log: AuditLog) -> dict:
        return {
            "id": log.id,
            "actor_username": log.actor_username,
            "actor_name": log.actor_name,
            "actor_role": log.actor_role,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "ip_address": str(log.ip_address) if log.ip_address else None,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }

    return {
        "items": [_to_dict(i) for i in items],
        "next_cursor": items[-1].id if has_more and items else None,
        "has_more": has_more,
    }


# ---------------------------------------------------------------------------
# Sub-module routers
# ---------------------------------------------------------------------------
from .announcements import announcements_router
from .api_keys import api_keys_router
from .data_export import data_export_router
from .escalation import escalation_router
from .email_templates import email_templates_router
from .business_hours import business_hours_router
from .celery_monitor import celery_monitor_router
from .db_cleanup import db_cleanup_router
from .failed_notifications import failed_notifications_router

router.include_router(announcements_router)
router.include_router(api_keys_router)
router.include_router(data_export_router)
router.include_router(escalation_router)
router.include_router(email_templates_router)
router.include_router(db_cleanup_router)
router.include_router(business_hours_router)
router.include_router(celery_monitor_router)
router.include_router(failed_notifications_router)
