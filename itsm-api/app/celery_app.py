"""Celery application singleton.

브로커와 백엔드 모두 Redis를 사용한다.
CELERY_BROKER_URL 환경변수가 없으면 REDIS_URL을 그대로 사용한다.
"""
import logging

from celery import Celery, signals
from celery.schedules import crontab
from prometheus_client import Counter as _PrometheusCounter

from .config import get_settings

# ── Celery 태스크 실패 Prometheus 카운터 ────────────────────────────────────
celery_task_failures_total = _PrometheusCounter(
    "celery_task_failures_total",
    "Total number of Celery task failures",
    ["task_name"],
)

logger = logging.getLogger(__name__)


def _make_celery() -> Celery:
    settings = get_settings()

    # CELERY_BROKER_URL 미설정 시 REDIS_URL 사용
    broker = getattr(settings, "CELERY_BROKER_URL", None) or settings.REDIS_URL
    backend = broker  # 결과 백엔드도 Redis로 통일

    app = Celery(
        "itsm",
        broker=broker,
        backend=backend,
    )
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="Asia/Seoul",
        enable_utc=True,
        task_acks_late=True,                   # worker 처리 완료 후 ACK
        task_reject_on_worker_lost=True,       # worker 비정상 종료 시 재큐
        task_soft_time_limit=60,               # 60 s soft limit
        task_time_limit=120,                   # 120 s hard limit
        worker_prefetch_multiplier=1,          # 공정한 분산 처리
        result_expires=86400,                  # 결과 24 시간 보관 (비동기 작업 상태 조회 가능)
        # ── Celery Beat 주기 태스크 ─────────────────────────────────────
        # crontab 기반 — 정각 기준 실행 보장 (단순 interval 대비 드리프트 방지)
        beat_schedule={
            "sla-check-every-5min": {
                "task": "itsm.periodic_sla_check",
                "schedule": crontab(minute="*/5"),  # 매 5분 정각
            },
            "daily-snapshot-midnight": {
                "task": "itsm.periodic_daily_snapshot",
                "schedule": crontab(hour=0, minute=0),  # 매일 자정 00:00 KST
            },
            "user-sync-hourly": {
                "task": "itsm.periodic_user_sync",
                "schedule": crontab(minute=0),          # 매시 정각
            },
            "email-ingest-every-2min": {
                "task": "itsm.periodic_email_ingest",
                "schedule": crontab(minute="*/2"),      # 2분마다 (IMAP_ENABLED=false면 즉시 반환)
            },
            "search-index-sync-every-30min": {
                "task": "itsm.periodic_search_index_sync",
                "schedule": crontab(minute="*/30"),     # 30분마다 GitLab → ticket_search_index 동기화
            },
            "tsi-drift-check-every-10min": {
                "task": "itsm.periodic_tsi_drift_check",
                "schedule": crontab(minute="*/10"),     # 10분마다 GitLab↔TSI 행수 비교 (읽기 전용)
            },
            "sla-drift-check-hourly": {
                "task": "itsm.periodic_sla_drift_check",
                "schedule": crontab(minute=15),         # 매시 15분 (SLA check 10분 직후 엇갈리게)
            },
            "watcher-cleanup-daily": {
                "task": "itsm.periodic_watcher_cleanup",
                "schedule": crontab(hour=4, minute=0),  # 매일 04:00
            },
            "notif-recount-hourly": {
                "task": "itsm.periodic_notif_recount",
                "schedule": crontab(minute=45),
            },
            "archive-old-tickets-monthly": {
                "task": "itsm.periodic_archive_old_tickets",
                "schedule": crontab(day_of_month=1, hour=5, minute=0),
                "kwargs": {"dry_run": True},  # 보고만, 실제 아카이브는 별도 마이그레이션 후 활성
            },
            "orphan-attachments-weekly": {
                "task": "itsm.periodic_orphan_attachments_check",
                "schedule": crontab(hour=4, minute=30, day_of_week="sunday"),  # 매주 일요일 04:30 KST
                "kwargs": {"dry_run": True},            # 1단계: 보고만. 수동 검증 후 destructive 모드 전환
            },
            "db-cleanup-daily-3am": {
                "task": "itsm.periodic_db_cleanup",
                "schedule": crontab(hour=3, minute=0),  # 매일 03:00 KST: 만료 토큰·오래된 로그 정리
            },
            "db-backup-daily-2am": {
                "task": "itsm.periodic_db_backup",
                "schedule": crontab(hour=2, minute=0),  # 매일 02:00 KST: DB 백업 + AES-256 암호화
            },
            "recurring-tickets-hourly": {
                "task": "itsm.periodic_create_recurring_tickets",
                "schedule": crontab(minute=0),  # 매 정각
            },
        },
        beat_scheduler="celery.beat:PersistentScheduler",
        beat_schedule_filename="/var/celery/celerybeat-schedule",
    )
    # autodiscover: app 패키지의 tasks.py 자동 등록
    app.autodiscover_tasks(["app"])
    return app


celery_app = _make_celery()


# ── 태스크 실패 시그널 핸들러 ────────────────────────────────────────────────
@signals.task_failure.connect
def on_task_failure(sender=None, task_id=None, exception=None, traceback=None, **kwargs):
    """태스크 실패 시 ERROR 로그 + Prometheus 카운터 증가 + Slack 알림."""
    task_name = sender.name if sender else "unknown"
    logger.error(
        "Celery task FAILED | task=%s id=%s exception=%s",
        task_name,
        task_id,
        repr(exception),
        exc_info=False,
    )
    # Prometheus 카운터
    try:
        celery_task_failures_total.labels(task_name=task_name).inc()
    except Exception:
        pass
    # Slack 알림 (SLACK_ENABLED=true 이고 SLACK_WEBHOOK_URL 설정된 경우에만)
    try:
        from .notifications import send_slack as _send_slack  # noqa: PLC0415
        exc_str = repr(exception)[:300]
        _send_slack(
            f"🚨 *Celery 태스크 실패*\n"
            f"• 태스크: `{task_name}`\n"
            f"• ID: `{task_id}`\n"
            f"• 오류: `{exc_str}`"
        )
    except Exception as slack_err:
        logger.debug("Celery failure Slack notify skipped: %s", slack_err)


@signals.task_retry.connect
def on_task_retry(sender=None, task_id=None, reason=None, **kwargs):
    """태스크 재시도 시 WARNING 레벨 로그를 남긴다."""
    task_name = sender.name if sender else "unknown"
    logger.warning(
        "Celery task RETRY | task=%s id=%s reason=%s",
        task_name,
        task_id,
        reason,
    )


@signals.task_revoked.connect
def on_task_revoked(sender=None, request=None, terminated=False, signum=None, **kwargs):
    """태스크 강제 취소(revoke) 시 WARNING 로그."""
    task_name = getattr(request, "task", "unknown")
    logger.warning(
        "Celery task REVOKED | task=%s terminated=%s signum=%s",
        task_name,
        terminated,
        signum,
    )


@signals.worker_ready.connect
def on_worker_ready(sender=None, **kwargs):
    """Worker 시작 완료 시 INFO 로그 + Prometheus HTTP 서버 기동.

    celery-worker는 HTTP 서버가 아니므로 prometheus_client가 정의한 카운터를
    외부에서 스크레이프할 방법이 없었다. worker 프로세스에 8001 포트로
    metrics endpoint를 노출해 prometheus.yml의 celery-worker 타겟이 실제 값을
    수집하도록 한다. prefork 워커인 경우 각 프로세스가 별도 카운터를 가지므로
    solo 혹은 gevent pool 사용 시 의미가 크다.
    """
    logger.info("Celery worker is ready | hostname=%s", getattr(sender, "hostname", "?"))
    try:
        from prometheus_client import start_http_server
        import os
        port = int(os.environ.get("CELERY_METRICS_PORT", "8001"))
        start_http_server(port)
        logger.info("Prometheus metrics endpoint started on :%d/metrics", port)
    except OSError as e:
        # 포트 충돌 시 경고만 남기고 계속 (여러 워커 프로세스가 경쟁할 수 있음)
        logger.warning("Prometheus metrics endpoint bind failed: %s", e)
    except Exception as e:
        logger.warning("Prometheus metrics endpoint setup failed: %s", e)
