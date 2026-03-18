"""Admin router: user role management, audit logs, assignment rules."""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..audit import write_audit_log
from ..config import get_settings
from ..database import get_db
from ..models import UserRole, AuditLog, AssignmentRule, SLAPolicy, ServiceType, EscalationPolicy, EscalationRecord, EmailTemplate, OutboundWebhook, SystemSetting, Rating, SLARecord, BusinessHoursConfig, BusinessHoliday, CustomFieldDef, TicketCustomValue
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
):
    # 고위험 작업 — Sudo 재인증 검증 (VULN-07: 쿠키 기반으로 변경)
    from ..routers.auth import verify_sudo_token
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
        q = q.filter(AuditLog.resource_type == resource_type)
    if actor_id:
        q = q.filter(AuditLog.actor_id == actor_id)
    if actor_username:
        # LIKE 메타문자(%, _) 이스케이프 — 의도치 않은 와일드카드 매칭 방지
        escaped = actor_username.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.filter(AuditLog.actor_username.ilike(f"%{escaped}%", escape="\\"))
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
def download_audit_logs(
    resource_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    actor_username: Optional[str] = Query(None),
    action: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """감사 로그 CSV 다운로드 (최대 10,000건, 청크 스트리밍)."""
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
    from .. import gitlab_client as _gc
    from ..config import get_settings as _gs

    _CACHE_KEY = "itsm:admin:service_type_usage"
    _CACHE_TTL = 300  # 5분

    # Redis 캐시 확인
    try:
        from ..redis_client import get_redis as _get_redis
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
        logger.error("cleanup_duplicate_project_labels error: %s", e)
        raise HTTPException(status_code=502, detail="라벨 정리 중 오류가 발생했습니다.")


# ---------------------------------------------------------------------------
# Escalation policies
# ---------------------------------------------------------------------------

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
    policy = db.query(EscalationPolicy).filter(EscalationPolicy.id == policy_id).with_for_update().first()
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
    s = db.query(RefreshToken).filter(RefreshToken.id == session_id).with_for_update().first()
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
    expires_days: Optional[int] = Field(None, gt=0)  # None = 무기한, 양수만 허용

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        import re
        if not re.match(r'^[a-zA-Z0-9가-힣\-_\. ]{1,64}$', v):
            raise ValueError("API 키 이름은 1~64자의 영문, 숫자, 한글, -, _, . 만 허용됩니다")
        return v


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

    # 이름 중복 방지
    from ..models import ApiKey
    if db.query(ApiKey).filter(ApiKey.name == body.name, ApiKey.is_active == True).first():  # noqa: E712
        raise HTTPException(400, f"'{body.name}' 이름의 활성 API 키가 이미 존재합니다.")

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


@router.get("/filter-options")
def get_filter_options(db: Session = Depends(get_db)):
    """티켓 목록 필터에 필요한 옵션(상태·우선순위·카테고리)을 동적으로 반환한다.

    - 상태: 워크플로우에 정의된 STATUS_KO 기반 (인증 불필요 — 로그인 전 포털에서도 사용)
    - 우선순위: SLA 정책 테이블에서 조회 (없으면 기본값 사용)
    - 카테고리: service_types 테이블에서 조회
    """
    from ..models import SLAPolicy

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
def get_role_labels(db: Session = Depends(get_db)):
    """역할 표시명 반환 — 로그인 여부 무관(표시용 레이블이므로 보안 영향 없음)."""
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

_CHANNEL_KEYS = ("email_enabled", "telegram_enabled")
_SETTINGS_CACHE_TTL = 60


def _invalidate_settings_cache(*keys: str) -> None:
    from ..redis_client import get_redis
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


@router.get("/notification-channels")
def get_notification_channels(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """이메일·텔레그램 채널 활성화 상태와 인프라(env) 설정 여부를 반환한다."""
    settings = get_settings()
    rows = {r.key: r.value for r in db.query(SystemSetting).filter(SystemSetting.key.in_(list(_CHANNEL_KEYS))).all()}
    return {
        "email_enabled": rows.get("email_enabled", "true") == "true",
        "telegram_enabled": rows.get("telegram_enabled", "true") == "true",
        "email_configured": bool(settings.NOTIFICATION_ENABLED and settings.SMTP_HOST),
        "telegram_configured": bool(settings.TELEGRAM_ENABLED and settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID),
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
    from concurrent.futures import ThreadPoolExecutor
    from .. import gitlab_client as _gl

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


# ── 업무시간 설정 ─────────────────────────────────────────────────────────────

class BusinessHoursItem(BaseModel):
    day_of_week: int          # 0=월 … 6=일
    start_time: str           # "HH:MM"
    end_time: str             # "HH:MM"
    is_active: bool = True

    @field_validator("end_time")
    @classmethod
    def end_after_start(cls, v: str, info) -> str:
        start = (info.data or {}).get("start_time")
        if start is not None and v <= start:
            raise ValueError("end_time은 start_time 이후여야 합니다")
        return v


class BusinessHoursPayload(BaseModel):
    schedule: list[BusinessHoursItem]


class HolidayCreate(BaseModel):
    date: str   # "YYYY-MM-DD"
    name: str = ""


@router.get("/business-hours")
def get_business_hours(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """업무시간 설정과 공휴일 목록 반환."""
    from datetime import time as _time, date as _date
    schedule = [
        {
            "id": s.id,
            "day_of_week": s.day_of_week,
            "start_time": s.start_time.strftime("%H:%M"),
            "end_time": s.end_time.strftime("%H:%M"),
            "is_active": s.is_active,
        }
        for s in db.query(BusinessHoursConfig).order_by(BusinessHoursConfig.day_of_week).all()
    ]
    holidays = [
        {"id": h.id, "date": h.date.isoformat(), "name": h.name or ""}
        for h in db.query(BusinessHoliday).order_by(BusinessHoliday.date).all()
    ]
    from ..models import HolidayYear
    pinned_years = [
        row.year for row in db.query(HolidayYear).order_by(HolidayYear.year).all()
    ]
    return {"schedule": schedule, "holidays": holidays, "pinned_years": pinned_years}


@router.put("/business-hours")
def put_business_hours(
    request: Request,
    data: BusinessHoursPayload,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """업무시간 스케줄 전체 교체 (기존 설정 삭제 후 재등록)."""
    from datetime import time as _time
    db.query(BusinessHoursConfig).delete()
    for item in data.schedule:
        try:
            s_h, s_m = map(int, item.start_time.split(":"))
            e_h, e_m = map(int, item.end_time.split(":"))
            if not (0 <= s_h <= 23 and 0 <= s_m <= 59 and 0 <= e_h <= 23 and 0 <= e_m <= 59):
                raise ValueError("out of range")
            start_t = _time(s_h, s_m)
            end_t = _time(e_h, e_m)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"시간 형식 오류: {item.start_time}")
        db.add(BusinessHoursConfig(
            day_of_week=item.day_of_week,
            start_time=start_t,
            end_time=end_t,
            is_active=item.is_active,
        ))
    db.commit()
    write_audit_log(db, user, "business_hours.update", "system", "business_hours", request=request)
    return {"ok": True}


@router.post("/holidays", status_code=201)
def add_holiday(
    request: Request,
    data: HolidayCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from datetime import date as _date
    try:
        d = _date.fromisoformat(data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식 오류 (YYYY-MM-DD)")
    existing = db.query(BusinessHoliday).filter(BusinessHoliday.date == d).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 등록된 날짜입니다.")
    h = BusinessHoliday(date=d, name=data.name or None)
    db.add(h); db.commit(); db.refresh(h)
    write_audit_log(db, user, "holiday.add", "system", str(h.id), request=request)
    return {"id": h.id, "date": h.date.isoformat(), "name": h.name or ""}


@router.delete("/holidays/{holiday_id}", status_code=204)
def delete_holiday(
    request: Request,
    holiday_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    h = db.query(BusinessHoliday).filter(BusinessHoliday.id == holiday_id).with_for_update().first()
    if not h:
        raise HTTPException(status_code=404, detail="공휴일을 찾을 수 없습니다.")
    db.delete(h); db.commit()
    write_audit_log(db, user, "holiday.delete", "system", str(holiday_id), request=request)


@router.post("/holiday-years/{year}", status_code=201)
def add_holiday_year(
    request: Request,
    year: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공휴일 관리 탭에 연도 고정."""
    from ..models import HolidayYear
    if not (2000 <= year <= 2100):
        raise HTTPException(status_code=422, detail="연도는 2000~2100 사이여야 합니다.")
    if db.query(HolidayYear).filter_by(year=year).first():
        return {"year": year}
    db.add(HolidayYear(year=year))
    db.commit()
    return {"year": year}


@router.delete("/holiday-years/{year}", status_code=204)
def delete_holiday_year(
    request: Request,
    year: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공휴일 관리 탭에서 연도 제거 (공휴일이 있으면 거부)."""
    from ..models import HolidayYear
    from datetime import date as _date
    has_holidays = db.query(BusinessHoliday).filter(
        BusinessHoliday.date >= _date(year, 1, 1),
        BusinessHoliday.date <= _date(year, 12, 31),
    ).first()
    if has_holidays:
        raise HTTPException(status_code=409, detail="해당 연도에 공휴일이 있어 삭제할 수 없습니다.")
    row = db.query(HolidayYear).filter_by(year=year).first()
    if row:
        db.delete(row)
        db.commit()


class HolidayBulkItem(BaseModel):
    date: str   # "YYYY-MM-DD"
    name: str = ""


class HolidayBulkCreate(BaseModel):
    holidays: list[HolidayBulkItem]


@router.post("/holidays/bulk", status_code=201)
def bulk_add_holidays(
    request: Request,
    data: HolidayBulkCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """여러 공휴일을 한 번에 등록합니다. 이미 등록된 날짜는 건너뜁니다."""
    from datetime import date as _date
    added = []
    skipped = []
    for item in data.holidays:
        try:
            d = _date.fromisoformat(item.date)
        except ValueError:
            continue
        existing = db.query(BusinessHoliday).filter(BusinessHoliday.date == d).first()
        if existing:
            skipped.append(item.date)
            continue
        h = BusinessHoliday(date=d, name=item.name or None)
        db.add(h)
        db.flush()
        added.append({"id": h.id, "date": h.date.isoformat(), "name": h.name or ""})
    db.commit()
    write_audit_log(db, user, "holiday.bulk_add", "system", f"added={len(added)}", request=request)
    return {"added": added, "skipped": skipped}


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
    _user: dict = Depends(require_agent),
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
