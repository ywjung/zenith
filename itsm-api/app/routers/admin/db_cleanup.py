"""Admin DB Cleanup router — granular cleanup endpoints with dry-run preview."""
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AuditLog, Notification
from ...rbac import require_admin

logger = logging.getLogger(__name__)

db_cleanup_router = APIRouter(prefix="/db-cleanup", tags=["admin-db-cleanup"])

# Retention constants
AUDIT_LOG_RETENTION_DAYS = 90
NOTIFICATION_RETENTION_DAYS = 30
KB_REVISION_KEEP_COUNT = 5


# ---------------------------------------------------------------------------
# Preview (dry-run)
# ---------------------------------------------------------------------------

@db_cleanup_router.get("/preview")
def preview_cleanup(
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """각 정리 작업의 대상 건수를 반환합니다 (실제 삭제 없음)."""
    now = datetime.now(timezone.utc)
    cut_audit = now - timedelta(days=AUDIT_LOG_RETENTION_DAYS)
    cut_notif = now - timedelta(days=NOTIFICATION_RETENTION_DAYS)

    # 감사 로그 90일+
    old_audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.created_at < cut_audit)
        .count()
    )

    # 읽음 알림 30일+
    orphan_notifications = (
        db.query(Notification)
        .filter(
            Notification.is_read == True,  # noqa: E712
            Notification.created_at < cut_notif,
        )
        .count()
    )

    # KB 문서당 최신 5개 초과 버전
    old_kb_revisions = _count_old_kb_revisions(db)

    return {
        "old_audit_logs": old_audit_logs,
        "orphan_notifications": orphan_notifications,
        "old_kb_revisions": old_kb_revisions,
        "policy": {
            "audit_log_retention_days": AUDIT_LOG_RETENTION_DAYS,
            "notification_retention_days": NOTIFICATION_RETENTION_DAYS,
            "kb_revision_keep_count": KB_REVISION_KEEP_COUNT,
        },
    }


# ---------------------------------------------------------------------------
# Individual cleanup actions
# ---------------------------------------------------------------------------

@db_cleanup_router.post("/audit-logs")
def cleanup_audit_logs(
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """90일 이상된 감사 로그를 삭제합니다."""
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    cut = now - timedelta(days=AUDIT_LOG_RETENTION_DAYS)

    try:
        deleted = (
            db.query(AuditLog)
            .filter(AuditLog.created_at < cut)
            .delete(synchronize_session=False)
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("cleanup_audit_logs error: %s", exc)
        raise HTTPException(status_code=500, detail=f"삭제 중 오류 발생: {exc}")

    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info("cleanup_audit_logs: deleted=%d duration_ms=%d", deleted, duration_ms)
    return {"deleted": deleted, "duration_ms": duration_ms}


@db_cleanup_router.post("/notifications")
def cleanup_notifications(
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """읽음 처리된 알림 중 30일 이상된 항목을 삭제합니다."""
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    cut = now - timedelta(days=NOTIFICATION_RETENTION_DAYS)

    try:
        deleted = (
            db.query(Notification)
            .filter(
                Notification.is_read == True,  # noqa: E712
                Notification.created_at < cut,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("cleanup_notifications error: %s", exc)
        raise HTTPException(status_code=500, detail=f"삭제 중 오류 발생: {exc}")

    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info("cleanup_notifications: deleted=%d duration_ms=%d", deleted, duration_ms)
    return {"deleted": deleted, "duration_ms": duration_ms}


@db_cleanup_router.post("/kb-revisions")
def cleanup_kb_revisions(
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """KB 문서당 최신 5개 초과 버전을 삭제합니다."""
    started = time.monotonic()

    try:
        deleted = _delete_old_kb_revisions(db)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("cleanup_kb_revisions error: %s", exc)
        raise HTTPException(status_code=500, detail=f"삭제 중 오류 발생: {exc}")

    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info("cleanup_kb_revisions: deleted=%d duration_ms=%d", deleted, duration_ms)
    return {"deleted": deleted, "duration_ms": duration_ms}


@db_cleanup_router.post("/vacuum")
def run_vacuum(
    _user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """VACUUM ANALYZE를 실행합니다. 소요 시간(ms)을 반환합니다."""
    started = time.monotonic()
    try:
        # VACUUM은 트랜잭션 밖에서 실행해야 하므로 autocommit 레벨로 처리
        connection = db.connection()
        connection.execution_options(isolation_level="AUTOCOMMIT")
        connection.execute(text("VACUUM ANALYZE"))
    except Exception as exc:
        logger.error("vacuum error: %s", exc)
        raise HTTPException(status_code=500, detail=f"VACUUM 실행 실패: {exc}")

    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info("vacuum analyze completed in %dms", duration_ms)
    return {"duration_ms": duration_ms}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _count_old_kb_revisions(db: Session) -> int:
    """각 article_id별로 revision_number 상위 5개를 제외한 나머지 수를 합산."""
    result = db.execute(
        text(
            """
            SELECT COUNT(*) FROM kb_revisions kr
            WHERE kr.id NOT IN (
                SELECT id FROM kb_revisions
                WHERE article_id = kr.article_id
                ORDER BY revision_number DESC
                LIMIT :keep
            )
            """
        ),
        {"keep": KB_REVISION_KEEP_COUNT},
    ).scalar()
    return int(result or 0)


def _delete_old_kb_revisions(db: Session) -> int:
    """각 article_id별로 revision_number 상위 5개를 제외한 나머지를 삭제."""
    result = db.execute(
        text(
            """
            DELETE FROM kb_revisions
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY article_id
                               ORDER BY revision_number DESC
                           ) AS rn
                    FROM kb_revisions
                ) ranked
                WHERE rn <= :keep
            )
            """
        ),
        {"keep": KB_REVISION_KEEP_COUNT},
    )
    return result.rowcount
