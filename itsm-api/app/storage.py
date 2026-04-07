"""MinIO / S3 호환 오브젝트 스토리지 클라이언트.

MINIO_ENDPOINT 환경변수가 설정된 경우 MinIO를 사용하고,
미설정 시 기존 GitLab 업로드 방식으로 폴백한다.
"""
import io
import logging
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

_minio_client = None
_minio_bucket: str = ""


def _get_client():
    """MinIO 클라이언트 싱글톤 반환. 설정 없으면 None."""
    global _minio_client, _minio_bucket
    if _minio_client is not None:
        return _minio_client

    from .config import get_settings
    settings = get_settings()
    if not settings.MINIO_ENDPOINT:
        return None

    try:
        from minio import Minio
        _minio_client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        _minio_bucket = settings.MINIO_BUCKET
        # 버킷 없으면 자동 생성
        if not _minio_client.bucket_exists(_minio_bucket):
            _minio_client.make_bucket(_minio_bucket)
            logger.info("MinIO bucket '%s' created", _minio_bucket)
        logger.info("MinIO storage initialized: endpoint=%s bucket=%s", settings.MINIO_ENDPOINT, _minio_bucket)
    except Exception as e:
        logger.warning("MinIO 초기화 실패 — GitLab 업로드 폴백 사용: %s", e)
        _minio_client = None

    return _minio_client


def upload_file(content: bytes, filename: str, content_type: str) -> Optional[dict]:
    """파일을 MinIO에 업로드하고 URL 정보를 반환한다.

    Returns:
        {"url": str, "alt": str, "name": str, "storage": "minio"} 또는 None (MinIO 미설정)
    """
    client = _get_client()
    if client is None:
        return None

    filename.rsplit(".", 1)[-1] if "." in filename else ""
    object_name = f"attachments/{uuid.uuid4().hex}/{filename}"

    try:
        client.put_object(
            _minio_bucket,
            object_name,
            io.BytesIO(content),
            length=len(content),
            content_type=content_type,
        )
        # 내부 접근용 URL (프록시를 통해 서빙)
        url = f"/api/storage/{_minio_bucket}/{object_name}"
        return {
            "url": url,
            "alt": filename,
            "name": filename,
            "storage": "minio",
            "object_name": object_name,
            "bucket": _minio_bucket,
        }
    except Exception as e:
        logger.error("MinIO upload failed for '%s': %s", filename, e)
        return None


def get_presigned_url(object_name: str, expires_seconds: int = 3600) -> Optional[str]:
    """MinIO presigned GET URL 생성."""
    from datetime import timedelta
    client = _get_client()
    if client is None:
        return None
    try:
        return client.presigned_get_object(_minio_bucket, object_name, expires=timedelta(seconds=expires_seconds))
    except Exception as e:
        logger.error("MinIO presigned URL failed for '%s': %s", object_name, e)
        return None


def stream_object(object_name: str):
    """MinIO 오브젝트를 스트리밍으로 읽어 반환. None이면 미설정 또는 오류."""
    client = _get_client()
    if client is None:
        return None, None
    try:
        response = client.get_object(_minio_bucket, object_name)
        content_type = response.headers.get("Content-Type", "application/octet-stream")
        data = response.read()
        response.close()
        response.release_conn()
        return data, content_type
    except Exception as e:
        logger.error("MinIO stream failed for '%s': %s", object_name, e)
        return None, None
