"""Audit logging helper."""
import logging
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLog

logger = logging.getLogger(__name__)


def write_audit_log(
    db: Session,
    user: dict,
    action: str,
    resource_type: str,
    resource_id: str,
    old_value: Optional[Any] = None,
    new_value: Optional[Any] = None,
    request: Optional[Request] = None,
) -> None:
    """Write an audit log entry. Errors are swallowed to not break the main flow."""
    try:
        ip = None
        if request:
            forwarded_for = request.headers.get("X-Forwarded-For")
            ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.client.host if request.client else None

        log = AuditLog(
            actor_id=str(user.get("sub", "")),
            actor_username=user.get("username", ""),
            actor_name=user.get("name"),
            actor_role=user.get("role", "user"),
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id),
            old_value=old_value,
            new_value=new_value,
            ip_address=ip,
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.warning("Failed to write audit log: %s", e)
        db.rollback()
