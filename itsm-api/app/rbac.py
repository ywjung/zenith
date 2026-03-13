"""RBAC dependency factory for FastAPI routes."""
from fastapi import Depends, HTTPException

from .auth import get_current_user
from .database import SessionLocal
from .models import UserRole

ROLE_LEVELS = {"user": 0, "developer": 1, "pl": 2, "agent": 3, "admin": 4}


def get_user_role(user_id: int) -> str:
    """Look up the role for a GitLab user ID from the DB. Defaults to 'user'."""
    with SessionLocal() as db:
        record = db.query(UserRole).filter(UserRole.gitlab_user_id == user_id).first()
        return record.role if record else "user"


def require_role(min_role: str):
    """
    Dependency factory: returns a FastAPI dependency that enforces a minimum role.
    Usage: `Depends(require_role("agent"))` or use the pre-built constants below.
    """
    min_level = ROLE_LEVELS.get(min_role, 0)

    def dependency(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role", "user")
        if ROLE_LEVELS.get(role, 0) < min_level:
            raise HTTPException(status_code=403, detail="권한이 부족합니다.")
        return user

    return dependency


# Pre-built dependencies
require_developer = require_role("developer")
require_pl = require_role("pl")
require_agent = require_role("agent")
require_admin = require_role("admin")
