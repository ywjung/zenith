#!/usr/bin/env python3
"""GitLab 업로드 파일 → MinIO 마이그레이션 스크립트.

사용법:
    cd /path/to/itsm
    docker compose exec itsm-api python3 /app/../scripts/migrate_files_to_minio.py [--dry-run]

    또는 로컬에서:
    python3 scripts/migrate_files_to_minio.py --dry-run
"""
import argparse
import logging
import os
import sys
import urllib.request
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _get_storage_client():
    """MinIO 클라이언트 반환. 미설정 시 None."""
    endpoint = os.environ.get("MINIO_ENDPOINT", "")
    if not endpoint:
        logger.error("MINIO_ENDPOINT 환경변수가 설정되지 않았습니다.")
        return None, None

    try:
        from minio import Minio
    except ImportError:
        logger.error("minio 패키지가 설치되지 않았습니다: pip install minio")
        return None, None

    bucket = os.environ.get("MINIO_BUCKET", "itsm-attachments")
    client = Minio(
        endpoint,
        access_key=os.environ.get("MINIO_ACCESS_KEY", "minio_admin"),
        secret_key=os.environ.get("MINIO_SECRET_KEY", "minio_secret_change_me"),
        secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
    )
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        logger.info("버킷 생성: %s", bucket)

    return client, bucket


def migrate_uploads_dir(dry_run: bool = True) -> None:
    """로컬 /app/uploads 디렉토리의 파일을 MinIO로 복사한다."""
    upload_dir = Path(os.environ.get("UPLOAD_DIR", "/app/uploads"))
    if not upload_dir.exists():
        logger.info("업로드 디렉토리 없음: %s", upload_dir)
        return

    client, bucket = _get_storage_client()
    if client is None:
        return

    files = list(upload_dir.rglob("*"))
    total = sum(1 for f in files if f.is_file())
    logger.info("이전 대상 파일 수: %d", total)

    success = skipped = errors = 0
    for f in files:
        if not f.is_file():
            continue
        rel_path = f.relative_to(upload_dir)
        object_name = f"legacy-uploads/{rel_path}"

        if dry_run:
            logger.info("[DRY-RUN] %s → minio://%s/%s", f, bucket, object_name)
            skipped += 1
            continue

        try:
            with open(f, "rb") as fp:
                data = fp.read()
            import io
            client.put_object(bucket, object_name, io.BytesIO(data), len(data))
            logger.info("✅ %s → %s", f.name, object_name)
            success += 1
        except Exception as e:
            logger.error("❌ %s 실패: %s", f.name, e)
            errors += 1

    logger.info("완료 — 성공: %d, 건너뜀: %d, 오류: %d", success, skipped, errors)


def main():
    parser = argparse.ArgumentParser(description="GitLab uploads → MinIO 마이그레이션")
    parser.add_argument("--dry-run", action="store_true", default=True, help="실제 업로드 없이 목록만 출력")
    parser.add_argument("--execute", action="store_true", help="실제 업로드 실행 (--dry-run 해제)")
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        logger.info("=== DRY-RUN 모드 (--execute 플래그로 실제 실행) ===")
    else:
        logger.info("=== 실제 마이그레이션 실행 ===")

    migrate_uploads_dir(dry_run=dry_run)


if __name__ == "__main__":
    main()
