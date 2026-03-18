"""자동화 규칙 엔진 라우터."""
import logging
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db
from ..models import AutomationRule, AuditLog
from ..rbac import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/automation-rules", tags=["automation"])


# C-17: 허용된 트리거 이벤트 값 목록 (models.py AutomationRule 주석과 일치)
VALID_TRIGGER_EVENTS = {
    "ticket.created",
    "ticket.status_changed",
    "ticket.assigned",
    "ticket.priority_changed",
    "ticket.commented",
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
        for i, cond in enumerate(v):
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
        return v

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, v: list[dict]) -> list[dict]:
        required_keys = {"type", "value"}
        for i, action in enumerate(v):
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
        return v


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
        for i, cond in enumerate(v):
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
        return v

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, v: Optional[list[dict]]) -> Optional[list[dict]]:
        if v is None:
            return v
        for i, action in enumerate(v):
            if "type" not in action:
                raise ValueError(f"actions[{i}]: 'type' 키 필수")
            if action["type"] not in _VALID_ACTION_TYPES:
                raise ValueError(
                    f"actions[{i}].type: 허용된 값 — {', '.join(sorted(_VALID_ACTION_TYPES))}"
                )
        return v


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
    audit = AuditLog(
        actor_username=current_user.get("username", "unknown"),
        action="automation_rule_created",
        resource_type="automation_rule",
        resource_id=str(rule.id),
        details={"rule_name": rule.name, "trigger": rule.trigger_event},
    )
    db.add(audit)
    db.commit()
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
    audit = AuditLog(
        actor_username=current_user.get("username", "unknown"),
        action="automation_rule_updated",
        resource_type="automation_rule",
        resource_id=str(rule.id),
        details={"rule_name": rule.name, "trigger": rule.trigger_event},
    )
    db.add(audit)
    db.commit()
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
    audit = AuditLog(
        actor_username=current_user.get("username", "unknown"),
        action="automation_rule_deleted",
        resource_type="automation_rule",
        resource_id=str(rule_id),
        details={"rule_name": rule_name, "trigger": rule_trigger},
    )
    db.add(audit)
    db.commit()
    return None


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

    matched_actions: list[dict] = []
    for rule in rules:
        conditions = rule.conditions or []
        if _match_conditions(conditions, ticket_context):
            logger.info(
                "Automation rule #%d '%s' matched for ticket #%s event=%s",
                rule.id, rule.name, ticket_context.get("iid"), event,
            )
            matched_actions.extend(rule.actions or [])

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
