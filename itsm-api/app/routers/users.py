"""Users router: 사용자 프로필 관련 엔드포인트 (아바타 업로드 등)."""
import logging
import re

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from ..audit import write_audit_log
from ..auth import get_current_user
from ..database import get_db
from ..models import UserRole
from .tickets.helpers import _validate_magic_bytes, _strip_image_metadata

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB


@router.post("/me/avatar")
def upload_avatar(
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

    content = file.file.read()  # sync 핸들러 — 스레드풀에서 실행되어 이벤트 루프 비차단
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


ANONYMIZED_LABEL = "[삭제된 사용자]"


@router.post("/{gitlab_user_id}/anonymize", status_code=200)
def anonymize_user(
    gitlab_user_id: int,
    request: Request,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """GDPR 삭제 요청 처리 — 대상 사용자의 PII를 '[삭제된 사용자]'로 치환.

    - UserRole.name/avatar_url 비우기
    - Notification.title/body 중 해당 사용자명 마스킹
    - ResolutionNote/AuditLog 등 감사 trail은 유지 (규제 의무)

    권한: 관리자만. AuditLog에 실행 기록 남김.
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="관리자만 익명화할 수 있습니다.")
    from ..models import Notification
    target = db.query(UserRole).filter(UserRole.gitlab_user_id == gitlab_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="대상 사용자를 찾을 수 없습니다.")
    original_name = (target.name or target.username or "").strip()
    if not original_name:
        raise HTTPException(status_code=422, detail="익명화할 사용자명이 비어 있습니다.")
    target.name = ANONYMIZED_LABEL
    target.avatar_url = None
    target.is_active = False

    # GDPR: 삭제 요청 즉시 해당 사용자의 모든 인증 수단 폐기.
    # (is_active=False만으로는 API 키가 계속 유효. user_sync 실행 전에 키가 쓰일 수 있음.)
    revoked_keys = 0
    try:
        from ..models import ApiKey, RefreshToken
        revoked_keys = (
            db.query(ApiKey)
            .filter(ApiKey.created_by == target.username, ApiKey.revoked == False)  # noqa: E712
            .update({"revoked": True})
        )
        # Refresh token도 폐기 — 기존 세션 즉시 무효화
        db.query(RefreshToken).filter(
            RefreshToken.gitlab_user_id == str(gitlab_user_id),
            RefreshToken.revoked == False,  # noqa: E712
        ).update({"revoked": True})
    except Exception as e:
        logger.warning("Failed to revoke credentials during anonymize %s: %s", gitlab_user_id, e)

    masked_titles = 0
    masked_bodies = 0
    # 알림 본문/제목 실제 치환 — 대소문자 무관 매칭이 필요해
    # Python re.sub로 각 행을 개별 처리한다. DB func.replace는 case-sensitive여서
    # filter(ilike)에 걸린 행이 사실상 no-op UPDATE를 받을 수 있음(→ PII 잔류).
    # regexp_replace는 dialect별 차이가 있어 포터블성을 위해 Python 루프 사용.
    # 관리자 GDPR 작업은 드물므로 행 단위 처리 비용은 허용치.
    try:
        pattern = re.compile(re.escape(original_name), re.IGNORECASE)
        matched = db.query(Notification).filter(
            (Notification.body.is_not(None) & Notification.body.ilike(f"%{original_name}%")) |
            Notification.title.ilike(f"%{original_name}%")
        ).all()
        for n in matched:
            if n.body and pattern.search(n.body):
                new_body = pattern.sub(ANONYMIZED_LABEL, n.body)
                if new_body != n.body:
                    n.body = new_body
                    masked_bodies += 1
            if n.title and pattern.search(n.title):
                new_title = pattern.sub(ANONYMIZED_LABEL, n.title)
                if new_title != n.title:
                    n.title = new_title
                    masked_titles += 1
        db.commit()
    except Exception as e:
        logger.error("Notification anonymize failed for id=%s: %s", gitlab_user_id, e)
        db.rollback()
        raise HTTPException(status_code=500, detail="알림 마스킹에 실패했습니다.")

    # 감사 trail — PII 자체는 남기지 않고 id와 건수만 기록.
    write_audit_log(
        db, user, "user.anonymize", "user", str(gitlab_user_id),
        new_value={
            "masked_titles": masked_titles,
            "masked_bodies": masked_bodies,
            "revoked_api_keys": revoked_keys,
        },
        request=request,
    )
    logger.warning(
        "User anonymized: gitlab_user_id=%s by admin=%s titles=%d bodies=%d",
        gitlab_user_id, user.get("username"), masked_titles, masked_bodies,
    )
    return {
        "anonymized": True,
        "gitlab_user_id": gitlab_user_id,
        "masked_titles": masked_titles,
        "masked_bodies": masked_bodies,
        "revoked_api_keys": revoked_keys,
    }
