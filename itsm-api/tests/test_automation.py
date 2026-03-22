"""Tests for automation rules CRUD and condition matching."""
from unittest.mock import MagicMock

VALID_RULE = {
    "name": "우선순위 critical 자동 처리",
    "is_active": True,
    "trigger_event": "ticket.created",
    "conditions": [{"field": "priority", "operator": "eq", "value": "critical"}],
    "actions": [{"type": "set_status", "value": "in_progress"}],
}


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_list_rules_requires_auth(client):
    resp = client.get("/automation-rules")
    assert resp.status_code == 401


def test_list_rules_as_admin(client, admin_cookies):
    resp = client.get("/automation-rules", cookies=admin_cookies)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_rule_requires_agent(client, user_cookies):
    resp = client.post("/automation-rules", json=VALID_RULE, cookies=user_cookies)
    assert resp.status_code == 403


def test_create_and_get_rule(client, admin_cookies):
    create = client.post("/automation-rules", json=VALID_RULE, cookies=admin_cookies)
    assert create.status_code == 201
    rule_id = create.json()["id"]

    get = client.get(f"/automation-rules/{rule_id}", cookies=admin_cookies)
    assert get.status_code == 200
    assert get.json()["name"] == VALID_RULE["name"]


def test_get_nonexistent_rule(client, admin_cookies):
    resp = client.get("/automation-rules/99999", cookies=admin_cookies)
    assert resp.status_code == 404


def test_update_rule(client, admin_cookies):
    create = client.post("/automation-rules", json=VALID_RULE, cookies=admin_cookies)
    rule_id = create.json()["id"]

    updated = client.patch(
        f"/automation-rules/{rule_id}",
        json={"name": "수정된 규칙", "is_active": False},
        cookies=admin_cookies,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "수정된 규칙"
    assert updated.json()["is_active"] is False


def test_delete_rule(client, admin_cookies):
    create = client.post("/automation-rules", json=VALID_RULE, cookies=admin_cookies)
    rule_id = create.json()["id"]

    del_resp = client.delete(f"/automation-rules/{rule_id}", cookies=admin_cookies)
    assert del_resp.status_code == 204

    get = client.get(f"/automation-rules/{rule_id}", cookies=admin_cookies)
    assert get.status_code == 404


# ── condition matching (unit tests) ──────────────────────────────────────────

def test_match_conditions_eq():
    from app.routers.automation import _match_conditions
    conditions = [{"field": "priority", "operator": "eq", "value": "critical"}]
    assert _match_conditions(conditions, {"priority": "critical"}) is True
    assert _match_conditions(conditions, {"priority": "low"}) is False


def test_match_conditions_contains():
    from app.routers.automation import _match_conditions
    conditions = [{"field": "title", "operator": "contains", "value": "긴급"}]
    assert _match_conditions(conditions, {"title": "긴급 요청입니다"}) is True
    assert _match_conditions(conditions, {"title": "일반 요청입니다"}) is False


def test_match_conditions_neq():
    from app.routers.automation import _match_conditions
    conditions = [{"field": "status", "operator": "neq", "value": "closed"}]
    assert _match_conditions(conditions, {"status": "open"}) is True
    assert _match_conditions(conditions, {"status": "closed"}) is False


def test_match_conditions_multiple_and():
    from app.routers.automation import _match_conditions
    conditions = [
        {"field": "priority", "operator": "eq", "value": "high"},
        {"field": "category", "operator": "eq", "value": "network"},
    ]
    assert _match_conditions(conditions, {"priority": "high", "category": "network"}) is True
    assert _match_conditions(conditions, {"priority": "high", "category": "hardware"}) is False


def test_match_conditions_empty_returns_true():
    from app.routers.automation import _match_conditions
    assert _match_conditions([], {"anything": "value"}) is True


# ── rule_to_dict helper ───────────────────────────────────────────────────────

def test_rule_to_dict_shape(client, admin_cookies):
    create = client.post("/automation-rules", json=VALID_RULE, cookies=admin_cookies)
    assert create.status_code == 201
    data = create.json()
    assert "id" in data
    assert "name" in data
    assert "conditions" in data
    assert "actions" in data
    assert "is_active" in data


# ── validation errors ─────────────────────────────────────────────────────────

def test_create_rule_invalid_trigger_event(client, admin_cookies):
    rule = {**VALID_RULE, "trigger_event": "invalid.event"}
    resp = client.post("/automation-rules", json=rule, cookies=admin_cookies)
    assert resp.status_code == 422


def test_create_rule_invalid_condition_operator(client, admin_cookies):
    rule = {**VALID_RULE, "conditions": [{"field": "priority", "operator": "INVALID", "value": "high"}]}
    resp = client.post("/automation-rules", json=rule, cookies=admin_cookies)
    assert resp.status_code == 422


def test_create_rule_invalid_action_type(client, admin_cookies):
    rule = {**VALID_RULE, "actions": [{"type": "INVALID_ACTION", "value": "x"}]}
    resp = client.post("/automation-rules", json=rule, cookies=admin_cookies)
    assert resp.status_code == 422


def test_create_rule_condition_missing_keys(client, admin_cookies):
    rule = {**VALID_RULE, "conditions": [{"field": "priority"}]}
    resp = client.post("/automation-rules", json=rule, cookies=admin_cookies)
    assert resp.status_code == 422


def test_create_rule_condition_extra_keys(client, admin_cookies):
    rule = {**VALID_RULE, "conditions": [{"field": "priority", "operator": "eq", "value": "high", "extra": "x"}]}
    resp = client.post("/automation-rules", json=rule, cookies=admin_cookies)
    assert resp.status_code == 422


def test_update_rule_not_found(client, admin_cookies):
    resp = client.patch("/automation-rules/99999", json={"is_active": False}, cookies=admin_cookies)
    assert resp.status_code == 404


def test_delete_rule_not_found(client, admin_cookies):
    resp = client.delete("/automation-rules/99999", cookies=admin_cookies)
    assert resp.status_code == 404


# ── _match_conditions operators ───────────────────────────────────────────────

def test_match_conditions_startswith():
    from app.routers.automation import _match_conditions
    conds = [{"field": "title", "operator": "startswith", "value": "긴급"}]
    assert _match_conditions(conds, {"title": "긴급 요청"}) is True
    assert _match_conditions(conds, {"title": "일반 요청"}) is False


def test_match_conditions_in():
    from app.routers.automation import _match_conditions
    conds = [{"field": "priority", "operator": "in", "value": "high,critical"}]
    assert _match_conditions(conds, {"priority": "high"}) is True
    assert _match_conditions(conds, {"priority": "low"}) is False


def test_match_conditions_unknown_operator_defaults_to_eq():
    from app.routers.automation import _match_conditions
    conds = [{"field": "status", "operator": "unknown_op", "value": "open"}]
    # Unknown operator falls back to eq
    assert _match_conditions(conds, {"status": "open"}) is True


# ── evaluate_automation_rules unit tests ────────────────────────────────────

def test_evaluate_automation_rules_returns_actions():
    from app.routers.automation import evaluate_automation_rules
    from app.models import AutomationRule

    mock_rule = MagicMock(spec=AutomationRule)
    mock_rule.id = 1
    mock_rule.name = "테스트 규칙"
    mock_rule.trigger_event = "ticket.created"
    mock_rule.conditions = [{"field": "priority", "operator": "eq", "value": "critical"}]
    mock_rule.actions = [{"type": "set_status", "value": "in_progress"}]

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_rule]

    actions = evaluate_automation_rules(mock_db, "ticket.created", {"iid": 1, "priority": "critical"})
    assert len(actions) == 1
    assert actions[0]["type"] == "set_status"


def test_evaluate_automation_rules_no_match():
    from app.routers.automation import evaluate_automation_rules
    from app.models import AutomationRule

    mock_rule = MagicMock(spec=AutomationRule)
    mock_rule.id = 2
    mock_rule.name = "규칙"
    mock_rule.conditions = [{"field": "priority", "operator": "eq", "value": "critical"}]
    mock_rule.actions = [{"type": "notify", "value": "admin"}]

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_rule]

    actions = evaluate_automation_rules(mock_db, "ticket.created", {"iid": 1, "priority": "low"})
    assert actions == []


def test_evaluate_automation_rules_loop_prevention():
    """Rule already running should be skipped."""
    from app.routers.automation import evaluate_automation_rules, _get_running_rules
    from app.models import AutomationRule

    mock_rule = MagicMock(spec=AutomationRule)
    mock_rule.id = 99
    mock_rule.name = "루프 규칙"
    mock_rule.conditions = []
    mock_rule.actions = [{"type": "notify", "value": "x"}]

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [mock_rule]

    # Pre-add rule id as running
    _get_running_rules().add(99)
    try:
        actions = evaluate_automation_rules(mock_db, "ticket.created", {})
        assert actions == []
    finally:
        _get_running_rules().discard(99)


# ── RuleCreate validator edge cases ──────────────────────────────────────────

def test_rulecreate_condition_value_list_normalized():
    """List value in conditions gets all items converted to str."""
    from app.routers.automation import RuleCreate

    rule = RuleCreate(
        name="test",
        trigger_event="ticket.created",
        conditions=[{"field": "priority", "operator": "in", "value": [1, 2, 3]}],
        actions=[{"type": "set_status", "value": "in_progress"}],
    )
    assert rule.conditions[0]["value"] == ["1", "2", "3"]


def test_rulecreate_condition_value_nonstring_normalized():
    """Non-string, non-list value in conditions converted to str."""
    from app.routers.automation import RuleCreate

    rule = RuleCreate(
        name="test",
        trigger_event="ticket.created",
        conditions=[{"field": "priority", "operator": "eq", "value": 42}],
        actions=[{"type": "set_status", "value": "in_progress"}],
    )
    assert rule.conditions[0]["value"] == "42"


def test_rulecreate_action_missing_required_key_raises():
    """Action missing 'value' key → ValidationError."""
    from app.routers.automation import RuleCreate
    import pytest

    with pytest.raises(Exception):
        RuleCreate(
            name="test",
            trigger_event="ticket.created",
            conditions=[],
            actions=[{"type": "set_status"}],  # missing 'value'
        )


def test_rulecreate_action_extra_key_raises():
    """Action with extra key → ValidationError."""
    from app.routers.automation import RuleCreate
    import pytest

    with pytest.raises(Exception):
        RuleCreate(
            name="test",
            trigger_event="ticket.created",
            conditions=[],
            actions=[{"type": "set_status", "value": "x", "extra": "bad"}],
        )


def test_rulecreate_action_value_list_normalized():
    """List value in actions gets all items converted to str."""
    from app.routers.automation import RuleCreate

    rule = RuleCreate(
        name="test",
        trigger_event="ticket.created",
        conditions=[],
        actions=[{"type": "assign", "value": [1, 2]}],
    )
    assert rule.actions[0]["value"] == ["1", "2"]


def test_rulecreate_action_value_nonstring_normalized():
    """Non-string, non-list value in actions converted to str."""
    from app.routers.automation import RuleCreate

    rule = RuleCreate(
        name="test",
        trigger_event="ticket.created",
        conditions=[],
        actions=[{"type": "set_status", "value": 99}],
    )
    assert rule.actions[0]["value"] == "99"


# ── RuleUpdate validator edge cases ──────────────────────────────────────────

def test_ruleupdate_invalid_trigger_event_raises():
    """Invalid trigger_event in RuleUpdate → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(trigger_event="invalid.event")


def test_ruleupdate_valid_trigger_event():
    """Valid trigger_event passes."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(trigger_event="ticket.created")
    assert ru.trigger_event == "ticket.created"


def test_ruleupdate_conditions_normalized():
    """RuleUpdate conditions validator normalizes non-string values."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(conditions=[
        {"field": "priority", "operator": "eq", "value": [1, 2]},
    ])
    assert ru.conditions[0]["value"] == ["1", "2"]


def test_ruleupdate_conditions_missing_key_raises():
    """RuleUpdate conditions missing required key → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(conditions=[{"field": "priority", "operator": "eq"}])


def test_ruleupdate_conditions_extra_key_raises():
    """RuleUpdate conditions extra key → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(conditions=[{"field": "p", "operator": "eq", "value": "x", "bad": "y"}])


def test_ruleupdate_conditions_invalid_operator_raises():
    """RuleUpdate conditions invalid operator → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(conditions=[{"field": "priority", "operator": "BADOP", "value": "x"}])


def test_ruleupdate_actions_normalized():
    """RuleUpdate actions validator normalizes non-string values."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(actions=[{"type": "set_status", "value": 99}])
    assert ru.actions[0]["value"] == "99"


def test_ruleupdate_actions_list_value_normalized():
    """RuleUpdate actions list values converted to str."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(actions=[{"type": "assign", "value": [1, 2, 3]}])
    assert ru.actions[0]["value"] == ["1", "2", "3"]


def test_ruleupdate_actions_missing_type_raises():
    """RuleUpdate actions missing 'type' → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(actions=[{"value": "x"}])


def test_ruleupdate_actions_invalid_type_raises():
    """RuleUpdate actions invalid type → ValidationError."""
    from app.routers.automation import RuleUpdate
    import pytest

    with pytest.raises(Exception):
        RuleUpdate(actions=[{"type": "INVALID_ACTION"}])


def test_ruleupdate_actions_none_passes():
    """RuleUpdate with None actions → no validation."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(actions=None)
    assert ru.actions is None


def test_ruleupdate_conditions_none_passes():
    """RuleUpdate with None conditions → no validation."""
    from app.routers.automation import RuleUpdate

    ru = RuleUpdate(conditions=None)
    assert ru.conditions is None


# ── update rule via API ────────────────────────────────────────────────────────

def test_update_rule_via_api(client, admin_cookies):
    """Update rule trigger_event and is_active via PATCH."""
    # Create rule first
    resp = client.post("/automation-rules", json=VALID_RULE, cookies=admin_cookies)
    assert resp.status_code == 201
    rule_id = resp.json()["id"]

    # Update
    resp = client.patch(
        f"/automation-rules/{rule_id}",
        json={"is_active": False, "trigger_event": "ticket.status_changed"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_active"] is False
    assert data["trigger_event"] == "ticket.status_changed"


# ── _match_conditions exception path ─────────────────────────────────────────

def test_match_conditions_exception_returns_false():
    """Exception during condition evaluation → returns False."""
    from app.routers.automation import _match_conditions

    # Cause exception by using a callable as ctx_value (op_fn crashes)
    class _BadValue:
        def __eq__(self, other):
            raise RuntimeError("deliberate crash")

    conds = [{"field": "priority", "operator": "eq", "value": "high"}]
    ctx = {"priority": _BadValue()}
    result = _match_conditions(conds, ctx)
    assert result is False
