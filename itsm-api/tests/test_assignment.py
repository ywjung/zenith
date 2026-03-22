"""Unit tests for app/assignment.py evaluate_rules function."""
from unittest.mock import MagicMock, patch

from app.models import AssignmentRule


def _make_rule(**kwargs) -> AssignmentRule:
    defaults = {
        "id": 1,
        "name": "규칙",
        "enabled": True,
        "priority": 10,
        "match_category": None,
        "match_priority": None,
        "match_keyword": None,
        "assignee_gitlab_id": 42,
    }
    rule = MagicMock(spec=AssignmentRule)
    for k, v in {**defaults, **kwargs}.items():
        setattr(rule, k, v)
    return rule


def _make_db(rules: list) -> MagicMock:
    mock_db = MagicMock()
    (mock_db.query.return_value
     .filter.return_value
     .order_by.return_value
     .all.return_value) = rules
    return mock_db


def test_no_rules_returns_none():
    from app.assignment import evaluate_rules
    db = _make_db([])
    assert evaluate_rules(db, "network", "high", "네트워크 장애") is None


def test_category_match_returns_assignee():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_category="network", assignee_gitlab_id=10)
    db = _make_db([rule])
    result = evaluate_rules(db, "network", "high", "any title")
    assert result == 10


def test_category_mismatch_skips_rule():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_category="hardware", assignee_gitlab_id=10)
    db = _make_db([rule])
    result = evaluate_rules(db, "network", "high", "any title")
    assert result is None


def test_priority_match_returns_assignee():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_priority="critical", assignee_gitlab_id=20)
    db = _make_db([rule])
    result = evaluate_rules(db, "network", "critical", "any title")
    assert result == 20


def test_priority_mismatch_skips_rule():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_priority="critical", assignee_gitlab_id=20)
    db = _make_db([rule])
    result = evaluate_rules(db, "network", "low", "any title")
    assert result is None


def test_keyword_match_case_insensitive():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_keyword="프린터", assignee_gitlab_id=30)
    db = _make_db([rule])
    result = evaluate_rules(db, None, None, "프린터가 고장났어요")
    assert result == 30


def test_keyword_not_in_title_skips():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_keyword="VPN", assignee_gitlab_id=30)
    db = _make_db([rule])
    result = evaluate_rules(db, None, None, "프린터 문제")
    assert result is None


def test_all_conditions_match():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_category="network", match_priority="high", match_keyword="VPN", assignee_gitlab_id=99)
    db = _make_db([rule])
    result = evaluate_rules(db, "network", "high", "VPN 연결 불가")
    assert result == 99


def test_partial_match_skips_rule():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_category="network", match_priority="critical", assignee_gitlab_id=99)
    db = _make_db([rule])
    # category matches but priority doesn't
    result = evaluate_rules(db, "network", "low", "any")
    assert result is None


def test_wildcard_rule_matches_all():
    """Rule with no conditions matches everything."""
    from app.assignment import evaluate_rules
    rule = _make_rule(match_category=None, match_priority=None, match_keyword=None, assignee_gitlab_id=7)
    db = _make_db([rule])
    result = evaluate_rules(db, "hardware", "low", "마우스 고장")
    assert result == 7


def test_first_matching_rule_wins():
    from app.assignment import evaluate_rules
    rule1 = _make_rule(id=1, match_category="network", priority=10, assignee_gitlab_id=100)
    rule2 = _make_rule(id=2, match_category=None, priority=5, assignee_gitlab_id=200)
    db = _make_db([rule1, rule2])  # rule1 evaluated first (highest priority)
    result = evaluate_rules(db, "network", None, "any")
    assert result == 100


def test_empty_title_keyword_match():
    from app.assignment import evaluate_rules
    rule = _make_rule(match_keyword="VPN", assignee_gitlab_id=5)
    db = _make_db([rule])
    result = evaluate_rules(db, None, None, "")
    assert result is None
