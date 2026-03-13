import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..auth import get_current_user
from ..database import get_db
from .. import gitlab_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[dict])
def list_projects(user: dict = Depends(get_current_user)):
    """로그인한 사용자가 접근 가능한 GitLab 프로젝트 목록 반환."""
    try:
        # Admin token + 멤버십 기반 프로젝트 목록 조회
        projects = gitlab_client.get_user_projects(user["sub"])
        return [
            {
                "id": str(p["id"]),
                "name": p["name"],
                "name_with_namespace": p.get("name_with_namespace", p["name"]),
                "path_with_namespace": p.get("path_with_namespace", ""),
            }
            for p in projects
        ]
    except Exception as e:
        logger.error("list_projects error: %s", e)
        raise HTTPException(status_code=502, detail="프로젝트 목록을 불러오지 못했습니다.")


@router.get("/{project_id}/members", response_model=list[dict])
def list_project_members(
    project_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """GitLab 프로젝트 멤버 중 ITSM developer 이상 역할 보유자만 반환.

    담당자 배정 드롭다운에 사용되므로 처리 권한이 있는 사람만 포함한다.
    (user 역할은 티켓을 처리할 수 없으므로 제외)
    """
    from ..models import UserRole

    # ITSM developer 이상 활성 사용자 ID 집합
    # (관리 > 사용자 관리와 동일하게 gitlab_user_id=1(root) 제외)
    _ASSIGNABLE_ROLES = {"developer", "pl", "agent", "admin"}
    assignable = db.query(UserRole).filter(
        UserRole.role.in_(_ASSIGNABLE_ROLES),
        UserRole.is_active == True,  # noqa: E712
        UserRole.gitlab_user_id != 1,  # GitLab root 제외 (사용자 관리에 표시 안됨)
    ).all()
    assignable_ids = {u.gitlab_user_id for u in assignable}

    try:
        members = gitlab_client.get_project_members(project_id)
        return [
            {
                "id": m["id"],
                "name": m["name"],
                "username": m["username"],
                "avatar_url": m.get("avatar_url"),
            }
            for m in members
            if m["id"] in assignable_ids
        ]
    except Exception as e:
        logger.error("list_project_members project=%s error: %s", project_id, e)
        raise HTTPException(status_code=502, detail="프로젝트 멤버 목록을 불러오지 못했습니다.")
