"""Celery 태스크 정의.

각 태스크는 notifications 모듈의 동기 함수를 감싸고
autoretry_for + max_retries 를 통해 내결함성을 보장한다.
"""
import logging

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 멱등성 헬퍼 — Redis로 task_id 중복 실행 방지 (재시도 시 중복 알림 방지)
# ---------------------------------------------------------------------------

def _is_duplicate(task_id: str | None, ttl: int = 300) -> bool:
    """Redis에 task_id가 이미 있으면 True(중복) 반환. 없으면 등록 후 False 반환."""
    if not task_id:
        return False
    try:
        from .config import get_settings
        import redis as _redis
        r = _redis.Redis.from_url(get_settings().REDIS_URL, socket_connect_timeout=2)
        key = f"celery:done:{task_id}"
        # SET NX: 없을 때만 설정 (원자적 CAS)
        return not r.set(key, "1", ex=ttl, nx=True)
    except Exception:
        return False  # Redis 장애 시 실행 허용 (가용성 우선)


# ---------------------------------------------------------------------------
# 실패 알림 추적 헬퍼
# ---------------------------------------------------------------------------

_SENSITIVE_KEYS = frozenset({"password", "token", "secret", "key", "access_token", "refresh_token"})


def _sanitize_payload(payload: object) -> object:
    """payload에서 민감 키를 제거한 복사본을 반환한다."""
    if isinstance(payload, dict):
        return {
            k: "***" if k.lower() in _SENSITIVE_KEYS else _sanitize_payload(v)
            for k, v in payload.items()
        }
    if isinstance(payload, (list, tuple)):
        return [_sanitize_payload(item) for item in payload]
    return payload


def _record_failed_notification(
    task_name: str,
    task_id: str | None,
    payload: object,
    exc: BaseException,
    retry_count: int = 0,
) -> None:
    """MaxRetriesExceededError 발생 시 FailedNotification 테이블에 기록한다."""
    from .database import SessionLocal
    from .models import FailedNotification

    safe_payload = _sanitize_payload(payload)
    error_msg = repr(exc)[:2000]

    try:
        with SessionLocal() as db:
            record = FailedNotification(
                task_name=task_name,
                task_id=task_id,
                payload=safe_payload,
                error_message=error_msg,
                retry_count=retry_count,
            )
            db.add(record)
            db.commit()
            logger.warning(
                "FailedNotification recorded | task=%s id=%s",
                task_name,
                task_id,
            )
    except Exception as db_exc:
        logger.error("Failed to record FailedNotification: %s", db_exc)


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
    time_limit=120,         # 하드 한도 2분
    soft_time_limit=100,    # 소프트 한도 100s (정상 종료 유도)
)
def send_ticket_notification(self, ticket: dict) -> None:
    """신규 티켓 생성 알림 (이메일 + Telegram + 아웃바운드 웹훅)."""
    if _is_duplicate(self.request.id):
        logger.info("send_ticket_notification: duplicate task_id=%s — skipped", self.request.id)
        return
    from .notifications import notify_ticket_created
    try:
        notify_ticket_created(ticket)
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_ticket_notification", self.request.id, {"ticket": ticket}, exc,
            retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_ticket_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


@shared_task(
    name="itsm.send_status_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
    time_limit=120,
    soft_time_limit=100,
)
def send_status_notification(self, ticket: dict, old_status: str, new_status: str, actor_name: str) -> None:
    """티켓 상태 변경 알림 (이메일 + Telegram + 아웃바운드 웹훅 + Web Push)."""
    if _is_duplicate(self.request.id):
        logger.info("send_status_notification: duplicate task_id=%s — skipped", self.request.id)
        return
    from .notifications import notify_status_changed
    try:
        notify_status_changed(ticket, old_status, new_status, actor_name)
        # Web Push — 담당자에게 상태 변경 알림
        assignee_username = ticket.get("assignee_username") or ticket.get("assignee", {}).get("username")
        if assignee_username:
            iid = ticket.get("iid", "?")
            title_text = ticket.get("title", "")[:60]
            push_title = f"티켓 상태 변경 — #{iid}"
            push_body = f"{title_text} → {new_status}"
            send_web_push.delay(
                username=assignee_username,
                title=push_title,
                body=push_body,
                url=f"/tickets/{iid}",
            )
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_status_notification", self.request.id,
            {"ticket": ticket, "old_status": old_status, "new_status": new_status, "actor_name": actor_name},
            exc, retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_status_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


@shared_task(
    name="itsm.send_comment_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
    time_limit=120,
    soft_time_limit=100,
)
def send_comment_notification(self, ticket: dict, comment_body: str, author_name: str, is_internal: bool) -> None:
    """댓글 추가 알림."""
    if _is_duplicate(self.request.id):
        logger.info("send_comment_notification: duplicate task_id=%s — skipped", self.request.id)
        return
    from .notifications import notify_comment_added
    try:
        notify_comment_added(ticket, comment_body, author_name, is_internal)
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_comment_notification", self.request.id,
            {"ticket": ticket, "author_name": author_name, "is_internal": is_internal},
            exc, retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_comment_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


@shared_task(
    name="itsm.send_assigned_notification",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
    time_limit=120,
    soft_time_limit=100,
)
def send_assigned_notification(self, assignee_email: str, ticket: dict, actor_name: str) -> None:
    """담당자 배정 알림."""
    from .notifications import notify_assigned
    try:
        notify_assigned(assignee_email, ticket, actor_name)
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_assigned_notification", self.request.id,
            {"assignee_email": assignee_email, "ticket": ticket, "actor_name": actor_name},
            exc, retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_assigned_notification failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


# ---------------------------------------------------------------------------
# Web Push 알림
# ---------------------------------------------------------------------------

@shared_task(
    name="itsm.send_web_push",
    bind=True,
    autoretry_for=(Exception,),
    max_retries=2,
    default_retry_delay=15,
    acks_late=True,
    time_limit=60,
    soft_time_limit=50,
)
def send_web_push(
    self,
    username: str,
    title: str,
    body: str,
    url: str = "/",
) -> None:
    """특정 사용자에게 Web Push 알림을 전송한다."""
    try:
        from .routers.push import send_push_to_user
        send_push_to_user(username, title, body, url)
    except Exception as exc:
        logger.warning("send_web_push failed (attempt %d): %s", self.request.retries + 1, exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


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
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_sla_warning", self.request.id,
            {"ticket_iid": ticket_iid, "project_id": project_id, "minutes_left": minutes_left},
            exc, retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_sla_warning failed: %s", exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


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
    except MaxRetriesExceededError as exc:
        _record_failed_notification(
            "itsm.send_sla_breach", self.request.id,
            {"ticket_iid": ticket_iid, "project_id": project_id, "assignee_email": assignee_email},
            exc, retry_count=self.request.retries,
        )
        raise
    except Exception as exc:
        logger.error("send_sla_breach failed: %s", exc)
        raise self.retry(exc=exc, countdown=min(300, 30 * (2 ** self.request.retries)))


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


@shared_task(
    name="itsm.periodic_db_backup",
    max_retries=1,
    default_retry_delay=300,
    time_limit=1200,
    soft_time_limit=1100,
)
def periodic_db_backup() -> dict:
    """매일 새벽 2시: PostgreSQL pg_dump → AES-256 암호화 → /tmp/itsm_backups/ 보관 (7일 초과분 삭제)."""
    import os
    import subprocess
    from datetime import datetime, timezone, timedelta
    from pathlib import Path
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import secrets as _secrets

    from .config import get_settings
    settings = get_settings()

    backup_dir = Path(settings.BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    enc_filename = f"itsm_backup_{timestamp}.sql.enc"
    enc_path = backup_dir / enc_filename

    # pg_dump 실행 — DATABASE_URL에서 접속 정보 파싱 (CRIT-2)
    pg_parts = settings.postgres_url_parts
    pg_user = pg_parts["user"]
    pg_db = pg_parts["db"]
    pg_host = pg_parts["host"]
    pg_port = pg_parts["port"]

    env = os.environ.copy()
    pg_password = pg_parts["password"]
    if pg_password:
        env["PGPASSWORD"] = pg_password

    try:
        result = subprocess.run(
            ["pg_dump", "-U", pg_user, "-h", pg_host, "-p", pg_port, pg_db],
            capture_output=True,
            env=env,
            timeout=900,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {result.stderr.decode(errors='replace')[:500]}")
        sql_data = result.stdout
    except FileNotFoundError:
        raise RuntimeError("pg_dump 실행 파일을 찾을 수 없습니다. PostgreSQL client가 설치되어 있는지 확인하세요.")

    # AES-256-GCM 암호화 (cryptography 패키지)
    # H-01: BACKUP_ENCRYPTION_KEY가 설정된 경우 우선 사용 (JWT SECRET_KEY와 독립적 관리).
    #       미설정 시 SECRET_KEY에서 HKDF 파생 (하위 호환).
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF as _HKDF
    from cryptography.hazmat.primitives import hashes as _hashes
    if settings.BACKUP_ENCRYPTION_KEY:
        # 전용 키를 HKDF로 정규화하여 정확히 32바이트 AES 키 생성
        key_bytes = _HKDF(
            algorithm=_hashes.SHA256(), length=32, salt=None, info=b"itsm-backup"
        ).derive(settings.BACKUP_ENCRYPTION_KEY.encode())
    else:
        logger.warning(
            "BACKUP_ENCRYPTION_KEY가 설정되지 않아 SECRET_KEY에서 백업 키를 파생합니다. "
            "보안 강화를 위해 별도의 BACKUP_ENCRYPTION_KEY 설정을 권장합니다."
        )
        key_bytes = _HKDF(
            algorithm=_hashes.SHA256(), length=32, salt=None, info=b"itsm-backup"
        ).derive(settings.SECRET_KEY.encode())
    aesgcm = AESGCM(key_bytes)
    nonce = _secrets.token_bytes(12)
    encrypted = aesgcm.encrypt(nonce, sql_data, None)

    # nonce(12B) + ciphertext 저장
    with open(enc_path, "wb") as f:
        f.write(nonce + encrypted)

    size_mb = enc_path.stat().st_size / (1024 * 1024)

    # 7일 초과 파일 삭제
    cutoff = now - timedelta(days=7)
    deleted_count = 0
    for old_file in backup_dir.glob("itsm_backup_*.sql.enc"):
        try:
            file_mtime = datetime.fromtimestamp(old_file.stat().st_mtime, tz=timezone.utc)
            if file_mtime < cutoff:
                old_file.unlink()
                deleted_count += 1
        except Exception as e:
            logger.warning("Failed to delete old backup %s: %s", old_file, e)

    logger.info(
        "periodic_db_backup: file=%s size_mb=%.2f deleted_old=%d",
        enc_path,
        size_mb,
        deleted_count,
    )

    result_dict = {
        "file": str(enc_path),
        "size_mb": round(size_mb, 2),
        "deleted_old": deleted_count,
    }

    # Slack 알림 (실패 시에만 — 성공은 로그로 충분)
    return result_dict


@shared_task(
    name="itsm.periodic_create_recurring_tickets",
    bind=True,
    max_retries=2,
    time_limit=300,
    soft_time_limit=270,
)
def periodic_create_recurring_tickets(self) -> dict:
    """만기된 반복 티켓을 GitLab 이슈로 생성하고 next_run_at 갱신."""
    from datetime import datetime, timezone
    from .database import SessionLocal
    from .models import RecurringTicket
    from . import gitlab_client

    now = datetime.now(timezone.utc)
    created = 0
    errors = 0

    with SessionLocal() as db:
        due = db.query(RecurringTicket).filter(
            RecurringTicket.is_active == True,  # noqa: E712
            RecurringTicket.next_run_at <= now,
        ).all()

        for rt in due:
            try:
                labels = [f"cat::{rt.category}", f"prio::{rt.priority}", "status::open", "recurring"]
                result = gitlab_client.create_issue(
                    title=rt.title,
                    description=(rt.description or "") + f"\n\n> 🔄 반복 티켓 (ID: {rt.id})",
                    labels=labels,
                    project_id=rt.project_id,
                    assignee_id=rt.assignee_id,
                )
                if result:
                    created += 1

                # next_run_at 계산
                try:
                    from croniter import croniter
                    it = croniter(rt.cron_expr, now)
                    rt.next_run_at = it.get_next(datetime).replace(tzinfo=timezone.utc)
                except Exception:
                    rt.next_run_at = None  # cron 파싱 실패 시 일시 정지

                rt.last_run_at = now
                db.commit()
            except Exception as e:
                errors += 1
                logger.error("recurring ticket %d failed: %s", rt.id, e)

    logger.info("Recurring tickets: created=%d errors=%d", created, errors)
    return {"created": created, "errors": errors}
