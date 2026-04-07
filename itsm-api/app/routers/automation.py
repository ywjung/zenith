"""자동화 규칙 엔진 라우터."""
import logging
import threading
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..models import AutomationRule, AutomationLog, AuditLog
from ..rbac import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/automation-rules", tags=["automation"])

# ---------------------------------------------------------------------------
# 무한 루프 방지 — 실행 중인 자동화 규칙 추적 (스레드 로컬)
# ---------------------------------------------------------------------------
_automation_running: threading.local = threading.local()


def _get_running_rules() -> set:
    """현재 스레드에서 실행 중인 규칙 ID 집합 반환."""
    if not hasattr(_automation_running, "rule_ids"):
        _automation_running.rule_ids = set()
    return _automation_running.rule_ids


# C-17: 허용된 트리거 이벤트 값 목록 (models.py AutomationRule 주석과 일치)
VALID_TRIGGER_EVENTS = {
    "ticket.created",
    "ticket.status_changed",
    "ticket.assigned",
    "ticket.priority_changed",
    "ticket.commented",
    "ticket.sla_warning",    # SLA 마감 임박 경고
    "ticket.sla_breached",   # SLA 위반 발생
    "ticket.closed",         # 티켓 종료
    "ticket.reopened",       # 티켓 재오픈
}

# 허용된 조건 연산자 (_CONDITION_OPS 키와 일치)
_VALID_OPERATORS = {"eq", "neq", "contains", "startswith", "in"}

# 허용된 액션 타입 (models.py AutomationRule 주석과 일치)
_VALID_ACTION_TYPES = {"set_status", "assign", "notify", "add_label", "send_slack"}


class RuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_event: str
    conditions: list[dict] = []
    actions: list[dict] = []
    is_active: bool = True
    order: int = 0

    @field_validator("trigger_event")
    @classmethod
    def validate_trigger_event(cls, v: str) -> str:
        if v not in VALID_TRIGGER_EVENTS:
            raise ValueError(f"허용된 트리거 이벤트: {', '.join(sorted(VALID_TRIGGER_EVENTS))}")
        return v

    @field_validator("conditions")
    @classmethod
    def validate_conditions(cls, v: list[dict]) -> list[dict]:
        required_keys = {"field", "operator", "value"}
        normalized = []
        for i, cond in enumerate(v):
            cond = dict(cond)  # 원본 변경 방지
            missing = required_keys - cond.keys()
            if missing:
                raise ValueError(f"conditions[{i}]: 필수 키 누락 — {', '.join(sorted(missing))}")
            extra = cond.keys() - required_keys
            if extra:
                raise ValueError(f"conditions[{i}]: 허용되지 않는 키 — {', '.join(sorted(extra))}")
            if cond["operator"] not in _VALID_OPERATORS:
                raise ValueError(
                    f"conditions[{i}].operator: 허용된 값 — {', '.join(sorted(_VALID_OPERATORS))}"
                )
            # value 타입 정규화: str 또는 list[str]만 허용 (숫자 등 자동 변환)
            raw_val = cond["value"]
            if isinstance(raw_val, list):
                cond["value"] = [str(item) for item in raw_val]
            elif not isinstance(raw_val, str):
                cond["value"] = str(raw_val)
            normalized.append(cond)
        return normalized

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, v: list[dict]) -> list[dict]:
        required_keys = {"type", "value"}
        normalized = []
        for i, action in enumerate(v):
            action = dict(action)  # 원본 변경 방지
            missing = required_keys - action.keys()
            if missing:
                raise ValueError(f"actions[{i}]: 필수 키 누락 — {', '.join(sorted(missing))}")
            extra = action.keys() - required_keys
            if extra:
                raise ValueError(f"actions[{i}]: 허용되지 않는 키 — {', '.join(sorted(extra))}")
            if action["type"] not in _VALID_ACTION_TYPES:
                raise ValueError(
                    f"actions[{i}].type: 허용된 값 — {', '.join(sorted(_VALID_ACTION_TYPES))}"
                )
            # value 타입 정규화
            raw_val = action["value"]
            if isinstance(raw_val, list):
                action["value"] = [str(item) for item in raw_val]
            elif not isinstance(raw_val, str):
                action["value"] = str(raw_val)
            normalized.append(action)
        return normalized


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_event: Optional[str] = None
    conditions: Optional[list[dict]] = None
    actions: Optional[list[dict]] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None

    @field_validator("trigger_event")
    @classmethod
    def validate_trigger_event(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_TRIGGER_EVENTS:
            raise ValueError(f"허용된 트리거 이벤트: {', '.join(sorted(VALID_TRIGGER_EVENTS))}")
        return v

    @field_validator("conditions")
    @classmethod
    def validate_conditions(cls, v: Optional[list[dict]]) -> Optional[list[dict]]:
        if v is None:
            return v
        required_keys = {"field", "operator", "value"}
        normalized = []
        for i, cond in enumerate(v):
            cond = dict(cond)
            missing = required_keys - cond.keys()
            if missing:
                raise ValueError(f"conditions[{i}]: 필수 키 누락 — {', '.join(sorted(missing))}")
            extra = cond.keys() - required_keys
            if extra:
                raise ValueError(f"conditions[{i}]: 허용되지 않는 키 — {', '.join(sorted(extra))}")
            if cond["operator"] not in _VALID_OPERATORS:
                raise ValueError(
                    f"conditions[{i}].operator: 허용된 값 — {', '.join(sorted(_VALID_OPERATORS))}"
                )
            # value 타입 정규화
            raw_val = cond["value"]
            if isinstance(raw_val, list):
                cond["value"] = [str(item) for item in raw_val]
            elif not isinstance(raw_val, str):
                cond["value"] = str(raw_val)
            normalized.append(cond)
        return normalized

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, v: Optional[list[dict]]) -> Optional[list[dict]]:
        if v is None:
            return v
        normalized = []
        for i, action in enumerate(v):
            action = dict(action)
            if "type" not in action:
                raise ValueError(f"actions[{i}]: 'type' 키 필수")
            if action["type"] not in _VALID_ACTION_TYPES:
                raise ValueError(
                    f"actions[{i}].type: 허용된 값 — {', '.join(sorted(_VALID_ACTION_TYPES))}"
                )
            # value 타입 정규화
            if "value" in action:
                raw_val = action["value"]
                if isinstance(raw_val, list):
                    action["value"] = [str(item) for item in raw_val]
                elif not isinstance(raw_val, str):
                    action["value"] = str(raw_val)
            normalized.append(action)
        return normalized


def _rule_to_dict(rule: AutomationRule) -> dict:
    return {
        "id": rule.id,
        "name": rule.name,
        "description": rule.description,
        "trigger_event": rule.trigger_event,
        "conditions": rule.conditions,
        "actions": rule.actions,
        "is_active": rule.is_active,
        "order": rule.order,
        "created_by": rule.created_by,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


@router.get("")
def list_rules(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rules = db.query(AutomationRule).order_by(AutomationRule.order, AutomationRule.id).all()
    return [_rule_to_dict(r) for r in rules]


@router.post("", status_code=201)
def create_rule(
    body: RuleCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rule = AutomationRule(
        name=body.name,
        description=body.description,
        trigger_event=body.trigger_event,
        conditions=body.conditions,
        actions=body.actions,
        is_active=body.is_active,
        order=body.order,
        created_by=current_user.get("username", "unknown"),
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    try:
        audit = AuditLog(
            actor_id=str(current_user.get("id", "0")),
            actor_username=current_user.get("username", "unknown"),
            actor_role=current_user.get("role", "admin"),
            action="automation_rule_created",
            resource_type="automation_rule",
            resource_id=str(rule.id),
            new_value={"rule_name": rule.name, "trigger": rule.trigger_event},
        )
        db.add(audit)
        db.commit()
    except Exception:
        db.rollback()
    return _rule_to_dict(rule)


@router.get("/{rule_id}")
def get_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    return _rule_to_dict(rule)


@router.patch("/{rule_id}")
def update_rule(
    rule_id: int,
    body: RuleUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).with_for_update().first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    jsonb_fields = {"conditions", "actions"}
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
        if field in jsonb_fields:
            flag_modified(rule, field)
    db.commit()
    db.refresh(rule)
    try:
        audit = AuditLog(
            actor_id=str(current_user.get("id", "0")),
            actor_username=current_user.get("username", "unknown"),
            actor_role=current_user.get("role", "admin"),
            action="automation_rule_updated",
            resource_type="automation_rule",
            resource_id=str(rule.id),
            new_value={"rule_name": rule.name, "trigger": rule.trigger_event},
        )
        db.add(audit)
        db.commit()
    except Exception:
        db.rollback()
    return _rule_to_dict(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    rule_name = rule.name
    rule_trigger = rule.trigger_event
    db.delete(rule)
    db.commit()
    try:
        audit = AuditLog(
            actor_id=str(current_user.get("id", "0")),
            actor_username=current_user.get("username", "unknown"),
            actor_role=current_user.get("role", "admin"),
            action="automation_rule_deleted",
            resource_type="automation_rule",
            resource_id=str(rule_id),
            new_value={"rule_name": rule_name, "trigger": rule_trigger},
        )
        db.add(audit)
        db.commit()
    except Exception:
        db.rollback()
    return None


# ---------------------------------------------------------------------------
# 실행 이력 조회
# ---------------------------------------------------------------------------

@router.get("/{rule_id}/logs")
def list_rule_logs(
    rule_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """자동화 규칙 실행 이력 조회 (최신순)."""
    rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    logs = (
        db.query(AutomationLog)
        .filter(AutomationLog.rule_id == rule_id)
        .order_by(AutomationLog.triggered_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [
        {
            "id": log.id,
            "ticket_iid": log.ticket_iid,
            "project_id": log.project_id,
            "trigger_event": log.trigger_event,
            "matched": log.matched,
            "actions_taken": log.actions_taken,
            "error": log.error,
            "triggered_at": log.triggered_at.isoformat() if log.triggered_at else None,
        }
        for log in logs
    ]


@router.get("/logs/recent")
def list_recent_logs(
    limit: int = 100,
    matched_only: bool = False,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """전체 자동화 실행 이력 (최신순, 관리자 전용)."""
    q = db.query(AutomationLog)
    if matched_only:
        q = q.filter(AutomationLog.matched == True)  # noqa: E712
    logs = q.order_by(AutomationLog.triggered_at.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": log.id,
            "rule_id": log.rule_id,
            "rule_name": log.rule_name,
            "ticket_iid": log.ticket_iid,
            "trigger_event": log.trigger_event,
            "matched": log.matched,
            "actions_taken": log.actions_taken,
            "triggered_at": log.triggered_at.isoformat() if log.triggered_at else None,
        }
        for log in logs
    ]


# ---------------------------------------------------------------------------
# Rule evaluator — called by tickets router on ticket events
# ---------------------------------------------------------------------------

_CONDITION_OPS = {
    "eq": lambda a, b: str(a) == str(b),
    "neq": lambda a, b: str(a) != str(b),
    "contains": lambda a, b: str(b).lower() in str(a).lower(),
    "startswith": lambda a, b: str(a).lower().startswith(str(b).lower()),
    "in": lambda a, b: str(a) in [x.strip() for x in str(b).split(",")],
}


def evaluate_automation_rules(
    db: Session,
    event: str,
    ticket_context: dict[str, Any],
) -> list[dict]:
    """주어진 이벤트와 티켓 컨텍스트에 대해 활성 자동화 규칙을 평가하고 실행할 액션 목록 반환.

    매칭된 규칙마다 automation_logs 테이블에 실행 이력을 기록한다.

    ticket_context 예시:
        {
            "iid": 42,
            "project_id": "1",
            "status": "resolved",
            "priority": "high",
            "category": "infra",
            "assignee": "john",
            "title": "서버 다운",
        }
    """
    rules = (
        db.query(AutomationRule)
        .filter(AutomationRule.is_active == True, AutomationRule.trigger_event == event)  # noqa: E712
        .order_by(AutomationRule.order, AutomationRule.id)
        .all()
    )

    running = _get_running_rules()
    matched_actions: list[dict] = []
    ticket_iid = ticket_context.get("iid", 0)
    project_id = ticket_context.get("project_id")

    for rule in rules:
        # 무한 루프 방지: 현재 스레드에서 이미 실행 중인 규칙은 건너뜀
        if rule.id in running:
            logger.warning(
                "Automation rule #%d '%s' skipped — already running (loop prevention)",
                rule.id, rule.name,
            )
            continue
        conditions = rule.conditions or []
        matched = _match_conditions(conditions, ticket_context)
        if matched:
            logger.info(
                "Automation rule #%d '%s' matched for ticket #%s event=%s",
                rule.id, rule.name, ticket_iid, event,
            )
            running.add(rule.id)
            try:
                matched_actions.extend(rule.actions or [])
            finally:
                running.discard(rule.id)

        # 자동화 실행 이력 기록 (매칭 여부와 무관하게 규칙 평가 결과를 저장)
        try:
            log_entry = AutomationLog(
                rule_id=rule.id,
                rule_name=rule.name,
                ticket_iid=ticket_iid,
                project_id=str(project_id) if project_id else None,
                trigger_event=event,
                matched=matched,
                actions_taken=list(rule.actions or []) if matched else None,
            )
            db.add(log_entry)
            db.flush()
        except Exception as _le:
            logger.warning("Failed to write automation log for rule #%d: %s", rule.id, _le)

    return matched_actions


def _match_conditions(conditions: list[dict], ctx: dict[str, Any]) -> bool:
    """All conditions must match (AND logic)."""
    for cond in conditions:
        try:
            field = cond.get("field", "")
            operator = cond.get("operator", "eq")
            value = cond.get("value", "")
            ctx_value = ctx.get(field, "")
            op_fn = _CONDITION_OPS.get(operator, _CONDITION_OPS["eq"])
            if not op_fn(ctx_value, value):
                return False
        except Exception as e:
            logger.warning("Automation condition evaluation error (cond=%s): %s", cond, e)
            return False
    return True
