"""Celery 태스크 정의.

각 태스크는 notifications 모듈의 동기 함수를 감싸고
autoretry_for + max_retries 를 통해 내결함성을 보장한다.
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 티켓 알림
# ---------------------------------------------------------------------------

@shared_task(
    name="itsm.send_ticket_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def send_ticket_notification(self, ticket: dict) -> None:
    """신규 티켓 생성 알림 (이메일 + Telegram + 아웃바운드 웹훅)."""
    from .notifications import notify_ticket_created
    try:
        notify_ticket_created(ticket)
    except Exception as exc:
        logger.error("send_ticket_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc)


@shared_task(
    name="itsm.send_status_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def send_status_notification(self, ticket: dict, old_status: str, new_status: str, actor_name: str) -> None:
    """티켓 상태 변경 알림 (이메일 + Telegram + 아웃바운드 웹훅)."""
    from .notifications import notify_status_changed
    try:
        notify_status_changed(ticket, old_status, new_status, actor_name)
    except Exception as exc:
        logger.error("send_status_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc)


@shared_task(
    name="itsm.send_comment_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def send_comment_notification(self, ticket: dict, comment_body: str, author_name: str, is_internal: bool) -> None:
    """댓글 추가 알림."""
    from .notifications import notify_comment_added
    try:
        notify_comment_added(ticket, comment_body, author_name, is_internal)
    except Exception as exc:
        logger.error("send_comment_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc)


@shared_task(
    name="itsm.send_assigned_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def send_assigned_notification(self, assignee_email: str, ticket: dict, actor_name: str) -> None:
    """담당자 배정 알림."""
    from .notifications import notify_assigned
    try:
        notify_assigned(assignee_email, ticket, actor_name)
    except Exception as exc:
        logger.error("send_assigned_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# SLA 알림
# ---------------------------------------------------------------------------

@shared_task(
    name="itsm.send_sla_warning",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def send_sla_warning(self, ticket_iid: int, project_id: str, minutes_left: int) -> None:
    """SLA 임박 경고 알림."""
    from .notifications import notify_sla_warning
    try:
        notify_sla_warning(ticket_iid, project_id, minutes_left)
    except Exception as exc:
        logger.error("send_sla_warning failed: %s", exc)
        raise self.retry(exc=exc)


@shared_task(
    name="itsm.send_sla_breach",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def send_sla_breach(self, ticket_iid: int, project_id: str, assignee_email: str | None) -> None:
    """SLA 초과 알림."""
    from .notifications import notify_sla_breach
    try:
        notify_sla_breach(ticket_iid, project_id, assignee_email)
    except Exception as exc:
        logger.error("send_sla_breach failed: %s", exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Celery Beat 주기 태스크 (APScheduler 스레드 대체)
# ---------------------------------------------------------------------------

@shared_task(
    name="itsm.periodic_sla_check",
    max_retries=1,
    default_retry_delay=60,
    time_limit=180,
    soft_time_limit=150,
)
def periodic_sla_check() -> dict:
    """5분마다: SLA 위반 감지·경고 알림·에스컬레이션 정책 실행."""
    from .database import SessionLocal
    from . import sla as sla_module
    results = {"breached": 0, "warned_60min": 0, "warned_30min": 0, "escalated": 0}
    try:
        with SessionLocal() as db:
            breached = sla_module.check_and_flag_breaches(db)
            results["breached"] = len(breached) if breached else 0
            warned = sla_module.check_and_send_warnings(db)
            results["warned_60min"] = len(warned) if warned else 0
            warned_30 = sla_module.check_and_send_warnings_30min(db)
            results["warned_30min"] = len(warned_30) if warned_30 else 0
            escalated = sla_module.check_and_escalate(db)
            results["escalated"] = len(escalated) if escalated else 0
    except Exception as exc:
        logger.error("periodic_sla_check failed: %s", exc)
        raise
    if any(results.values()):
        logger.info("periodic_sla_check: %s", results)
    return results


@shared_task(
    name="itsm.periodic_daily_snapshot",
    max_retries=1,
    default_retry_delay=300,
    time_limit=600,
    soft_time_limit=540,
)
def periodic_daily_snapshot() -> dict:
    """매일 자정: 모든 프로젝트 통계 스냅샷 생성."""
    import concurrent.futures
    from .database import SessionLocal
    from . import gitlab_client
    from .config import get_settings
    settings = get_settings()
    try:
        all_projects = gitlab_client.get_user_projects("0") or []
        project_ids = [str(p["id"]) for p in all_projects] if all_projects else []
    except Exception:
        project_ids = []
    if not project_ids:
        project_ids = [str(settings.GITLAB_PROJECT_ID)]

    from .routers.reports import take_snapshot
    results = {"success": [], "failed": []}

    def _snap(pid: str) -> None:
        try:
            with SessionLocal() as db:
                take_snapshot(pid, db)
            results["success"].append(pid)
        except Exception as e:
            logger.error("Snapshot failed for project %s: %s", pid, e)
            results["failed"].append(pid)

    if len(project_ids) <= 1:
        for pid in project_ids:
            _snap(pid)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(project_ids), 4)) as pool:
            pool.map(_snap, project_ids)

    logger.info("periodic_daily_snapshot: %s", results)
    return results


@shared_task(
    name="itsm.periodic_user_sync",
    max_retries=1,
    default_retry_delay=120,
    time_limit=300,
    soft_time_limit=240,
)
def periodic_user_sync() -> dict:
    """1시간마다: GitLab 그룹 멤버와 ITSM 사용자 역할 동기화."""
    try:
        from .main import _run_user_sync
        _run_user_sync()
        logger.info("periodic_user_sync completed")
        return {"status": "ok"}
    except Exception as exc:
        logger.error("periodic_user_sync failed: %s", exc)
        raise


@shared_task(
    name="itsm.periodic_search_index_sync",
    max_retries=1,
    default_retry_delay=120,
    time_limit=600,
    soft_time_limit=540,
)
def periodic_search_index_sync() -> dict:
    """30분마다: GitLab 이슈를 ticket_search_index에 전체 동기화 (초기 색인 및 누락 보완)."""
    import re as _re
    from .database import SessionLocal
    from . import gitlab_client
    from .config import get_settings
    from .models import TicketSearchIndex
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import func as sa_func

    settings = get_settings()
    results = {"upserted": 0, "failed": 0, "projects": []}

    try:
        all_projects = gitlab_client.get_user_projects("0") or []
        project_ids = [str(p["id"]) for p in all_projects] if all_projects else []
    except Exception:
        project_ids = []
    if not project_ids:
        project_ids = [str(settings.GITLAB_PROJECT_ID)]

    def _strip_markup(text: str) -> str:
        t = _re.sub(r"<[^>]+>", " ", text)
        t = _re.sub(r"[#*`_~\[\]!>|]", " ", t)
        return _re.sub(r"\s+", " ", t).strip()[:2000]

    for pid in project_ids:
        try:
            issues = gitlab_client.get_all_issues(state="all", project_id=pid)
            with SessionLocal() as db:
                for issue in issues:
                    try:
                        iid = issue.get("iid")
                        if not iid:
                            continue
                        title = issue.get("title") or ""
                        desc_text = _strip_markup(issue.get("description") or "")
                        state = issue.get("state") or "opened"
                        labels = issue.get("labels") or []
                        assignees = issue.get("assignees") or []
                        assignee_username = assignees[0].get("username") if assignees else None
                        created_at = issue.get("created_at")
                        updated_at = issue.get("updated_at")

                        stmt = pg_insert(TicketSearchIndex).values(
                            iid=iid,
                            project_id=pid,
                            title=title,
                            description_text=desc_text,
                            state=state,
                            labels_json=labels,
                            assignee_username=assignee_username,
                            created_at=created_at,
                            updated_at=updated_at,
                        ).on_conflict_do_update(
                            index_elements=["iid", "project_id"],
                            set_={
                                "title": title,
                                "description_text": desc_text,
                                "state": state,
                                "labels_json": labels,
                                "assignee_username": assignee_username,
                                "created_at": created_at,
                                "updated_at": updated_at,
                                "synced_at": sa_func.now(),
                            },
                        )
                        db.execute(stmt)
                        results["upserted"] += 1
                    except Exception as ie:
                        logger.warning("Search index sync failed for issue #%s: %s", issue.get("iid"), ie)
                        results["failed"] += 1
                db.commit()
            results["projects"].append(pid)
        except Exception as pe:
            logger.error("Search index sync failed for project %s: %s", pid, pe)
            results["failed"] += 1

    logger.info("periodic_search_index_sync: %s", results)
    return results


@shared_task(
    name="itsm.periodic_db_cleanup",
    time_limit=300,
    soft_time_limit=270,
)
def periodic_db_cleanup() -> dict:
    """매일 새벽 3시: 만료된 토큰, 오래된 알림·감사로그 정리."""
    from datetime import datetime, timezone, timedelta
    from .database import SessionLocal
    from .models import RefreshToken, GuestToken, Notification, AuditLog

    now = datetime.now(timezone.utc)
    results: dict = {}

    with SessionLocal() as db:
        try:
            # 1. 만료된 RefreshToken 삭제 (expires_at 기준)
            cut = now
            deleted = db.query(RefreshToken).filter(RefreshToken.expires_at < cut).delete(synchronize_session=False)
            results["refresh_tokens_deleted"] = deleted
        except Exception as e:
            logger.error("DB cleanup RefreshToken error: %s", e)

        try:
            # 2. 만료된 GuestToken 삭제
            deleted = db.query(GuestToken).filter(GuestToken.expires_at < now).delete(synchronize_session=False)
            results["guest_tokens_deleted"] = deleted
        except Exception as e:
            logger.error("DB cleanup GuestToken error: %s", e)

        try:
            # 3. 90일 이상 된 읽음 알림 삭제
            cut = now - timedelta(days=90)
            deleted = db.query(Notification).filter(
                Notification.is_read == True,  # noqa: E712
                Notification.created_at < cut,
            ).delete(synchronize_session=False)
            results["notifications_deleted"] = deleted
        except Exception as e:
            logger.error("DB cleanup Notification error: %s", e)

        try:
            # 4. 180일 이상 된 감사로그 삭제
            cut = now - timedelta(days=180)
            deleted = db.query(AuditLog).filter(AuditLog.created_at < cut).delete(synchronize_session=False)
            results["audit_logs_deleted"] = deleted
        except Exception as e:
            logger.error("DB cleanup AuditLog error: %s", e)

        try:
            db.commit()
        except Exception as e:
            logger.error("DB cleanup commit error: %s", e)
            db.rollback()

    logger.info("periodic_db_cleanup: %s", results)
    return results


@shared_task(
    name="itsm.periodic_email_ingest",
    max_retries=1,
    default_retry_delay=60,
    time_limit=120,
    soft_time_limit=90,
)
def periodic_email_ingest() -> dict:
    """2분마다: IMAP 수신함 폴링 후 미처리 이메일을 티켓으로 변환."""
    from .config import get_settings
    settings = get_settings()
    if not settings.IMAP_ENABLED:
        return {"status": "disabled"}
    try:
        from .email_ingest import process_inbox
        count = process_inbox()
        if count:
            logger.info("periodic_email_ingest created %d tickets", count)
        return {"status": "ok", "created": count or 0}
    except Exception as exc:
        logger.error("periodic_email_ingest failed: %s", exc)
        raise
