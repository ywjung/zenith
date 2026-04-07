"""Users router: 사용자 프로필 관련 엔드포인트 (아바타 업로드 등)."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import UserRole
from .tickets.helpers import _validate_magic_bytes, _strip_image_metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 사용자 아바타 이미지 업로드.

    - 허용 형식: JPEG, PNG, GIF, WebP
    - 최대 크기: 2MB
    - 파일은 MinIO(설정 시) 또는 GitLab에 업로드되며 avatar_url이 갱신된다.
    """
    from .. import storage as storage_mod

    content_type = file.content_type or ""
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=422,
            detail="이미지 파일만 허용됩니다. (허용 형식: jpeg, png, gif, webp)",
        )

    content = await file.read()
    if len(content) > _MAX_AVATAR_SIZE:
        raise HTTPException(status_code=422, detail="파일 크기는 최대 2MB까지 허용됩니다.")

    # M2: magic bytes로 실제 파일 형식 검증 (content-type 헤더 스푸핑 방지)
    _validate_magic_bytes(content, content_type)
    # 업로드 전 이미지 메타데이터(EXIF 등) 제거
    content = _strip_image_metadata(content, content_type)

    # 파일명에 사용자 식별자 포함
    user_id = user.get("sub") or user.get("id", "unknown")
    ext = content_type.split("/")[-1].replace("jpeg", "jpg")
    filename = f"avatar_{user_id}_{user['username']}.{ext}"

    # MinIO 업로드 시도
    result = storage_mod.upload_file(content, filename, content_type)
    if result:
        avatar_url = result["url"]
    else:
        # MinIO 미설정 시 data URL 저장은 XSS 벡터 및 DB 비대화 위험이 있어 거부
        raise HTTPException(
            status_code=501,
            detail="아바타 업로드를 위해 MinIO 스토리지 설정이 필요합니다. 관리자에게 문의하세요.",
        )

    # DB 업데이트
    user_id = user.get("sub") or user.get("id")
    record = db.query(UserRole).filter(UserRole.gitlab_user_id == user_id).first()
    if record:
        record.avatar_url = avatar_url
        db.commit()
    else:
        logger.warning("upload_avatar: UserRole record not found for user_id=%s", user_id)

    return {"avatar_url": avatar_url}


@router.delete("/me/avatar", status_code=204)
def delete_avatar(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 사용자 아바타를 초기화한다 (GitLab 기본 아바타로 복귀)."""
    user_id = user.get("id")
    record = db.query(UserRole).filter(UserRole.gitlab_user_id == user_id).first()
    if record:
        record.avatar_url = None
        db.commit()
    return None
