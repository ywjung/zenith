"""Auto-assignment rule evaluation."""
from typing import Optional

from sqlalchemy.orm import Session

from .models import AssignmentRule


def evaluate_rules(db: Session, category: Optional[str], priority: Optional[str], title: str) -> Optional[int]:
    """
    Evaluate assignment rules and return the assignee_gitlab_id of the first matching rule,
    or None if no rule matches.
    Rules are evaluated in descending priority order.
    """
    rules = (
        db.query(AssignmentRule)
        .filter(AssignmentRule.enabled == True)  # noqa: E712
        .order_by(AssignmentRule.priority.desc())
        .all()
    )

    for rule in rules:
        if rule.match_category and rule.match_category != category:
            continue
        if rule.match_priority and rule.match_priority != priority:
            continue
        if rule.match_keyword and rule.match_keyword.lower() not in (title or "").lower():
            continue
        return rule.assignee_gitlab_id

    return None
