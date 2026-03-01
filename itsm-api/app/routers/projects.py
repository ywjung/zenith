from fastapi import APIRouter, Depends, HTTPException
from ..auth import get_current_user
from .. import gitlab_client

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[dict])
def list_projects(user: dict = Depends(get_current_user)):
    """로그인한 사용자가 접근 가능한 GitLab 프로젝트 목록 반환."""
    try:
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
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")
