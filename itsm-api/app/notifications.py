"""Email and Telegram notifications and in-app notification helpers."""
import html
import logging
import smtplib
import ssl
import json
import urllib.request
import urllib.parse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy.orm import Session

from .config import get_settings
from .models import Notification, SystemSetting


# ---------------------------------------------------------------------------
# Email template rendering (DB-driven, Jinja2)
# ---------------------------------------------------------------------------

def _render_email_template(event_type: str, context: dict) -> tuple[str, str] | None:
    """DB에서 이메일 템플릿을 조회해 Jinja2로 렌더링한다.

    반환: (subject, html_body) 튜플, 없으면 None
    """
    try:
        from jinja2.sandbox import SandboxedEnvironment
        from .database import SessionLocal
        from .models import EmailTemplate

        with SessionLocal() as db:
            tmpl = (
                db.query(EmailTemplate)
                .filter(EmailTemplate.event_type == event_type, EmailTemplate.enabled == True)  # noqa: E712
                .first()
            )
            if not tmpl:
                return None

        env = SandboxedEnvironment(autoescape=True)
        subject = env.from_string(tmpl.subject).render(**context)
        body = env.from_string(tmpl.html_body).render(**context)
        return subject, body
    except Exception as e:
        logger.warning("Email template render failed for %s: %s", event_type, e)
        return None


# 내부 호환 alias (_send_email = send_email, escalation에서 사용)
_send_email = None  # send_email 정의 후 아래에서 할당

logger = logging.getLogger(__name__)

_SETTINGS_CACHE_TTL = 60  # Redis 캐시 TTL (초)


def _get_channel_enabled(setting_key: str, env_flag: bool) -> bool:
    """알림 채널 활성화 여부를 DB(+Redis 캐시)에서 조회한다.

    - env_flag가 False이면 즉시 False (환경변수가 인프라 수준 off-switch)
    - DB에 설정이 없으면 기본값 True (하위 호환)
    """
    if not env_flag:
        return False
    try:
        from .redis_client import get_redis
        cache_key = f"itsm:settings:{setting_key}"
        r = get_redis()
        if r:
            cached = r.get(cache_key)
            if cached is not None:
                return cached == "true"
        from .database import SessionLocal
        with SessionLocal() as db:
            row = db.query(SystemSetting).filter(SystemSetting.key == setting_key).first()
            val = row.value if row else "true"
        if r:
            try:
                r.setex(cache_key, _SETTINGS_CACHE_TTL, val)
            except Exception:
                pass
        return val == "true"
    except Exception as exc:
        logger.warning("Failed to read system setting %s: %s — falling back to env flag", setting_key, exc)
        return env_flag


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

def send_email(to: str | list[str], subject: str, body_html: str) -> None:
    """Send an email via SMTP. Silently logs errors if NOTIFICATION_ENABLED=false."""
    settings = get_settings()
    if not _get_channel_enabled("email_enabled", settings.NOTIFICATION_ENABLED):
        logger.debug("Email notifications disabled – skipping email to %s: %s", to, subject)
        return

    if not settings.SMTP_HOST:
        logger.warning("SMTP_HOST not configured, skipping email")
        return

    recipients = [to] if isinstance(to, str) else to

    # SEC: CRLF 인젝션 방지 — 이메일 헤더에 개행 문자 삽입 시 추가 헤더 주입 가능
    def _sanitize_header(value: str) -> str:
        return value.replace("\r", "").replace("\n", " ").strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = _sanitize_header(subject)
    msg["From"] = _sanitize_header(settings.SMTP_FROM)
    msg["To"] = _sanitize_header(", ".join(recipients))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            if settings.SMTP_TLS:
                ssl_context = ssl.create_default_context()
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                    server.ehlo()
                    server.starttls(context=ssl_context)
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM, recipients, msg.as_string())
            else:
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                    if settings.SMTP_USER and settings.SMTP_PASSWORD:
                        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM, recipients, msg.as_string())
            logger.info("Email sent to %s: %s", recipients, subject)
            return
        except Exception as e:
            last_exc = e
            if attempt < 2:
                import time
                time.sleep(attempt + 1)  # 1s, 2s
    logger.error("Failed to send email to %s after 3 attempts: %s", recipients, last_exc)


# 내부 alias (escalation_policies에서 직접 호출)
_send_email = send_email


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

def send_telegram(message: str) -> None:
    """Send a message via Telegram Bot API. Uses stdlib only (no httpx/requests)."""
    settings = get_settings()
    if not _get_channel_enabled("telegram_enabled", settings.TELEGRAM_ENABLED):
        logger.debug("Telegram notifications disabled – skipping message")
        return
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        logger.warning("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured, skipping")
        return

    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = json.dumps({
        "chat_id": settings.TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                logger.info("Telegram message sent to chat_id=%s", settings.TELEGRAM_CHAT_ID)
            else:
                logger.warning("Telegram API returned %s", resp.status)
    except Exception as e:
        logger.error("Failed to send Telegram message: %s", e)


# ---------------------------------------------------------------------------
# Slack
# ---------------------------------------------------------------------------

def send_slack(message: str, channel: str | None = None) -> None:
    """Slack Incoming Webhook으로 메시지를 전송한다. stdlib only."""
    settings = get_settings()
    if not _get_channel_enabled("slack_enabled", settings.SLACK_ENABLED):
        logger.debug("Slack notifications disabled – skipping message")
        return
    if not settings.SLACK_WEBHOOK_URL:
        logger.warning("SLACK_WEBHOOK_URL not configured, skipping")
        return

    payload: dict = {"text": message}
    ch = channel or settings.SLACK_CHANNEL
    if ch:
        payload["channel"] = ch

    data = json.dumps(payload).encode("utf-8")
    try:
        req = urllib.request.Request(
            settings.SLACK_WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                logger.info("Slack message sent (channel=%s)", ch or "webhook-default")
            else:
                logger.warning("Slack webhook returned %s", resp.status)
    except Exception as e:
        logger.error("Failed to send Slack message: %s", e)


def notify_ticket_created(ticket: dict) -> None:
    settings = get_settings()
    iid = ticket.get("iid", "?")
    title = html.escape(str(ticket.get("title", "")))  # H-2: XSS 방지
    employee = html.escape(str(ticket.get("employee_name", "")))
    priority = html.escape(str(ticket.get("priority", "medium")))
    category = html.escape(str(ticket.get("category", "")))

    recipients: list[str] = []
    if settings.IT_TEAM_EMAIL:
        recipients.append(settings.IT_TEAM_EMAIL)
    assignee_email = ticket.get("assignee_email")
    if assignee_email and assignee_email not in recipients:
        recipients.append(assignee_email)

    if not recipients:
        return

    # DB 템플릿 우선 사용, 없으면 email_templates 폴백
    ctx = {
        "iid": iid, "title": title, "employee_name": employee,
        "priority": priority, "category": category,
        "description": html.escape(str(ticket.get("description", ""))),
        "portal_url": f"{settings.FRONTEND_URL}/tickets/{iid}",
    }
    rendered = _render_email_template("ticket_created", ctx)
    if rendered:
        subject, body = rendered
    else:
        from .email_templates import render_ticket_created
        ticket_ctx = dict(ctx)
        ticket_ctx["portal_url"] = f"{settings.FRONTEND_URL}/tickets/{iid}"
        subject, body = render_ticket_created(ticket_ctx)
    send_email(recipients, subject, body)
    tg_msg = (
        f"🎫 <b>새 티켓 등록</b>\n"
        f"#️⃣ #{iid}: {title}\n"
        f"👤 신청자: {employee}\n"
        f"⚡ 우선순위: {priority} | 📂 카테고리: {category}"
    )
    send_telegram(tg_msg)
    send_slack(
        f"🎫 *새 티켓 등록* — #{iid}: {ticket.get('title', '')}\n"
        f"신청자: {ticket.get('employee_name', '')} | 우선순위: {priority} | 카테고리: {category}\n"
        f"<{settings.FRONTEND_URL}/tickets/{iid}|티켓 보기>"
    )
    # 아웃바운드 웹훅
    try:
        from .outbound_webhook import fire_event
        fire_event("ticket_created", {
            "iid": iid, "title": ticket.get("title", ""),
            "priority": ticket.get("priority"), "category": ticket.get("category"),
            "employee_name": ticket.get("employee_name"),
        })
    except Exception:
        pass


def notify_status_changed(ticket: dict, old_status: str, new_status: str, actor_name: str) -> None:
    settings = get_settings()
    iid = ticket.get("iid", "?")
    project_id = str(ticket.get("project_id", ""))
    title = html.escape(str(ticket.get("title", "")))  # H-2
    actor_name_e = html.escape(str(actor_name))
    status_map = {
        "open": "접수됨", "approved": "승인완료", "in_progress": "처리 중",
        "waiting": "추가정보 대기", "resolved": "처리 완료",
        "testing": "테스트중",
        "ready_for_release": "운영배포전", "released": "운영반영완료",
        "closed": "종료됨", "reopened": "재개됨",
    }

    recipients: list[str] = []
    employee_email = ticket.get("employee_email")
    if employee_email:
        recipients.append(employee_email)

    watcher_emails = _get_watcher_emails(int(iid) if str(iid).isdigit() else 0, project_id, exclude_email=employee_email)
    for email in watcher_emails:
        if email not in recipients:
            recipients.append(email)

    if recipients:
        ctx = {
            "iid": iid, "title": title,
            "old_status": status_map.get(old_status, old_status),
            "new_status": status_map.get(new_status, new_status),
            "actor_name": actor_name_e,
            "portal_url": f"{settings.FRONTEND_URL}/tickets/{iid}",
        }
        rendered = _render_email_template("status_changed", ctx)
        if rendered:
            subject, body = rendered
        else:
            from .email_templates import render_ticket_status_changed
            ticket_ctx = {
                "iid": iid,
                "title": title,
                "portal_url": f"{settings.FRONTEND_URL}/tickets/{iid}",
            }
            subject, body = render_ticket_status_changed(ticket_ctx, old_status, new_status, actor_name_e)
        send_email(recipients, subject, body)
    old_ko = status_map.get(old_status, old_status)
    new_ko = status_map.get(new_status, new_status)
    send_telegram(
        f"🔄 <b>티켓 상태 변경</b>\n"
        f"#️⃣ #{iid}: {title}\n"
        f"📌 {old_ko} → <b>{new_ko}</b>\n"
        f"👷 처리자: {actor_name_e}"
    )
    send_slack(
        f"🔄 *티켓 상태 변경* — #{iid}: {ticket.get('title', '')}\n"
        f"{old_ko} → *{new_ko}* | 처리자: {actor_name}\n"
        f"<{settings.FRONTEND_URL}/tickets/{iid}|티켓 보기>"
    )
    try:
        from .outbound_webhook import fire_event
        fire_event("status_changed", {
            "iid": iid, "title": ticket.get("title", ""),
            "old_status": old_status, "new_status": new_status, "actor_name": actor_name,
        })
    except Exception:
        pass


def _get_watcher_emails(iid: int, project_id: str, exclude_email: Optional[str] = None) -> list[str]:
    """DB에서 티켓 구독자 이메일 목록을 반환한다."""
    try:
        from .database import SessionLocal
        from .models import TicketWatcher
        with SessionLocal() as db:
            watchers = (
                db.query(TicketWatcher)
                .filter(
                    TicketWatcher.ticket_iid == iid,
                    TicketWatcher.project_id == project_id,
                    TicketWatcher.user_email != None,  # noqa: E711
                    TicketWatcher.user_email != "",
                )
                .all()
            )
            return [
                w.user_email for w in watchers
                if w.user_email and w.user_email != exclude_email
            ]
    except Exception as e:
        logger.warning("Failed to fetch watcher emails: %s", e)
        return []


def notify_comment_added(ticket: dict, comment_body: str, author_name: str, is_internal: bool) -> None:
    if is_internal:
        return  # 내부 메모는 알림 없음

    iid = ticket.get("iid", "?")
    project_id = str(ticket.get("project_id", ""))
    title = html.escape(str(ticket.get("title", "")))  # H-2
    author_name_e = html.escape(str(author_name))
    comment_preview = html.escape(comment_body[:500])

    recipients: list[str] = []
    employee_email = ticket.get("employee_email")
    if employee_email:
        recipients.append(employee_email)

    # Also notify watchers
    watcher_emails = _get_watcher_emails(int(iid) if str(iid).isdigit() else 0, project_id, exclude_email=employee_email)
    for email in watcher_emails:
        if email not in recipients:
            recipients.append(email)

    if recipients:
        from .email_templates import render_comment_added
        settings = get_settings()
        ticket_ctx = {
            "iid": iid,
            "title": title,
            "portal_url": f"{settings.FRONTEND_URL}/tickets/{iid}",
        }
        subject, body = render_comment_added(ticket_ctx, author_name_e, comment_preview)
        send_email(recipients, subject, body)


def notify_assigned(assignee_email: str, ticket: dict, actor_name: str) -> None:
    settings = get_settings()
    iid = ticket.get("iid", "?")
    title = html.escape(str(ticket.get("title", "")))  # H-2
    actor_name_e = html.escape(str(actor_name))
    from .email_templates import render_assigned
    ticket_ctx = {
        "iid": iid,
        "title": title,
        "portal_url": f"{settings.FRONTEND_URL}/tickets/{iid}",
    }
    subject, body = render_assigned(ticket_ctx, assignee_name="", actor_name=actor_name_e)
    send_email(assignee_email, subject, body)


def notify_sla_warning(ticket_iid: int, project_id: str, minutes_left: int) -> None:
    settings = get_settings()
    recipients: list[str] = []
    if settings.IT_TEAM_EMAIL:
        recipients.append(settings.IT_TEAM_EMAIL)
    if not recipients:
        return

    from .email_templates import render_sla_warning
    ticket_ctx = {
        "iid": ticket_iid,
        "project_id": project_id,
        "portal_url": f"{settings.FRONTEND_URL}/tickets/{ticket_iid}",
    }
    subject, body = render_sla_warning(ticket_ctx, remaining_minutes=minutes_left)
    send_email(recipients, subject, body)
    send_telegram(
        f"⏰ <b>SLA 임박 경고</b>\n"
        f"#️⃣ 티켓 #{ticket_iid} (프로젝트 {project_id})\n"
        f"⚡ {minutes_left}분 내에 SLA 기한이 만료됩니다!"
    )


def notify_sla_breach(ticket_iid: int, project_id: str, assignee_email: Optional[str]) -> None:
    settings = get_settings()
    recipients: list[str] = []
    if assignee_email:
        recipients.append(assignee_email)
    if settings.IT_TEAM_EMAIL:
        recipients.append(settings.IT_TEAM_EMAIL)
    if not recipients:
        return

    from .email_templates import render_sla_breached
    ticket_ctx = {
        "iid": ticket_iid,
        "project_id": project_id,
        "portal_url": f"{settings.FRONTEND_URL}/tickets/{ticket_iid}",
    }
    subject, body = render_sla_breached(ticket_ctx)
    send_email(recipients, subject, body)
    send_telegram(
        f"⚠️ <b>SLA 초과 경고</b>\n"
        f"#️⃣ 티켓 #{ticket_iid} (프로젝트 {project_id})\n"
        f"🚨 SLA 기한이 초과됐습니다. 즉시 처리 필요!"
    )


# ---------------------------------------------------------------------------
# In-app notifications (DB + Redis pub/sub)
# ---------------------------------------------------------------------------

def _validate_notification_link(link: Optional[str]) -> Optional[str]:
    """LOW-06: 알림 link는 내부 상대 경로만 허용.

    외부 URL(://포함), CRLF 인젝션, 또는 상대 경로가 아닌 값을 거부한다.
    """
    if link is None:
        return None
    if (
        not link.startswith("/")
        or "://" in link
        or "\n" in link
        or "\r" in link
        or link.startswith("//")  # 프로토콜-상대 URL도 차단
    ):
        logger.warning("create_db_notification: invalid link rejected (%.100r)", link)
        return None
    return link


def create_db_notification(
    db: Session,
    recipient_id: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    dedup_key: Optional[str] = None,
    dedup_ttl: int = 60,
) -> Optional[Notification]:
    """Create a notification record in the DB and publish to Redis.

    Uses flush() instead of commit() so that the record participates in the
    caller's transaction. The caller is responsible for committing. If the
    outer transaction rolls back, the notification row is also rolled back.

    dedup_key: Redis 중복 방지 키. 같은 키가 dedup_ttl 초 이내에 이미 설정돼 있으면 알림을 생성하지 않는다.
    """
    if dedup_key:
        try:
            from .redis_client import get_redis
            r = get_redis()
            if r:
                redis_key = f"itsm:notif-dedup:{recipient_id}:{dedup_key}"
                if r.get(redis_key):
                    logger.debug("create_db_notification: dedup skip key=%s", redis_key)
                    return None
                r.setex(redis_key, dedup_ttl, "1")
        except Exception as _e:
            logger.warning("create_db_notification: dedup Redis error: %s", _e)

    notif = Notification(
        recipient_id=recipient_id,
        title=title,
        body=body,
        link=_validate_notification_link(link),  # LOW-06: 내부 경로만 허용
    )
    db.add(notif)
    db.flush()  # assign PK / created_at without committing the outer transaction
    db.refresh(notif)

    # Publish to Redis for SSE delivery
    push_to_redis(recipient_id, {
        "id": notif.id,
        "title": notif.title,
        "body": notif.body,
        "link": notif.link,
        "created_at": notif.created_at.isoformat() if notif.created_at else None,
    })
    return notif


def push_to_redis(recipient_id: str, payload: dict) -> None:
    """Publish a notification payload to Redis channel for SSE consumers."""
    try:
        from .redis_client import get_redis
        r = get_redis()
        if r:
            r.publish(f"notifications:{recipient_id}", json.dumps(payload))
    except Exception as e:
        logger.warning("Redis publish failed: %s", e)


# ---------------------------------------------------------------------------
# 승인 워크플로우 이메일 알림
# ---------------------------------------------------------------------------

def notify_approval_requested(
    approver_email: str,
    approver_name: str,
    ticket_iid: int,
    requester_name: str,
    project_id: Optional[str] = None,
) -> None:
    """승인 요청 생성 시 승인자에게 이메일 발송."""
    settings = get_settings()
    if not settings.NOTIFICATION_ENABLED or not settings.SMTP_HOST:
        return

    frontend = settings.FRONTEND_URL.rstrip("/")
    from .email_templates import render_approval_requested
    ticket_ctx = {
        "iid": ticket_iid,
        "title": "",
        "portal_url": f"{frontend}/tickets/{ticket_iid}",
    }
    subject, body = render_approval_requested(ticket_ctx, approver_name=approver_name, requester_name=requester_name)
    try:
        _send_email(approver_email, subject, body)
    except Exception as e:
        logger.warning("notify_approval_requested failed: %s", e)


def notify_approval_decided(
    requester_email: str,
    requester_name: str,
    ticket_iid: int,
    decision: str,
    decider_name: str,
    reason: Optional[str] = None,
) -> None:
    """승인 완료/반려 시 요청자에게 이메일 발송."""
    settings = get_settings()
    if not settings.NOTIFICATION_ENABLED or not settings.SMTP_HOST:
        return

    frontend = settings.FRONTEND_URL.rstrip("/")
    from .email_templates import render_approval_decided
    ticket_ctx = {
        "iid": ticket_iid,
        "title": "",
        "portal_url": f"{frontend}/tickets/{ticket_iid}",
    }
    subject, body = render_approval_decided(
        ticket_ctx,
        requester_name=requester_name,
        decision=decision,
        decider_name=decider_name,
        reason=reason,
    )
    try:
        _send_email(requester_email, subject, body)
    except Exception as e:
        logger.warning("notify_approval_decided failed: %s", e)
