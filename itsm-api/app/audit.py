"""Audit logging helper."""
import logging
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLog

logger = logging.getLogger(__name__)

# 감사 로그에서 마스킹할 민감 필드 키 목록 (소문자 부분 매칭)
_SENSITIVE_FIELD_PATTERNS = frozenset({
    "password", "passwd", "token", "secret", "key", "credential",
    "private_key", "api_key", "access_token", "refresh_token",
    "client_secret", "oauth_secret",
})

_REDACTED = "[REDACTED]"


def _mask_sensitive(value: Any) -> Any:
    """dict의 민감 키 값을 재귀적으로 [REDACTED]로 마스킹한다."""
    if isinstance(value, dict):
        return {
            k: _REDACTED if any(pat in k.lower() for pat in _SENSITIVE_FIELD_PATTERNS) else _mask_sensitive(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_mask_sensitive(item) for item in value]
    return value


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
            old_value=_mask_sensitive(old_value),
            new_value=_mask_sensitive(new_value),
            ip_address=ip,
        )
        db.add(log)
        db.commit()
    except Exception as e:
        logger.warning("Failed to write audit log: %s", e)
        db.rollback()
