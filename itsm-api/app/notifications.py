"""Email and Telegram notifications and in-app notification helpers."""
import html
import logging
import smtplib
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy.orm import Session

from .config import get_settings
from .models import Notification


# ---------------------------------------------------------------------------
# Email template rendering (DB-driven, Jinja2)
# ---------------------------------------------------------------------------

def _render_email_template(event_type: str, context: dict) -> tuple[str, str] | None:
    """DB에서 이메일 템플릿을 조회해 Jinja2로 렌더링한다.

    반환: (subject, html_body) 튜플, 없으면 None
    """
    try:
        from jinja2 import Environment, select_autoescape
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

        env = Environment(autoescape=select_autoescape(["html"]))
        subject = env.from_string(tmpl.subject).render(**context)
        body = env.from_string(tmpl.html_body).render(**context)
        return subject, body
    except Exception as e:
        logger.warning("Email template render failed for %s: %s", event_type, e)
        return None


# 내부 호환 alias (_send_email = send_email, escalation에서 사용)
_send_email = None  # send_email 정의 후 아래에서 할당

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

def send_email(to: str | list[str], subject: str, body_html: str) -> None:
    """Send an email via SMTP. Silently logs errors if NOTIFICATION_ENABLED=false."""
    settings = get_settings()
    if not settings.NOTIFICATION_ENABLED:
        logger.debug("Notifications disabled – skipping email to %s: %s", to, subject)
        return

    if not settings.SMTP_HOST:
        logger.warning("SMTP_HOST not configured, skipping email")
        return

    recipients = [to] if isinstance(to, str) else to

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        if settings.SMTP_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.ehlo()
                server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, recipients, msg.as_string())
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_FROM, recipients, msg.as_string())
        logger.info("Email sent to %s: %s", recipients, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", recipients, e)


# 내부 alias (escalation_policies에서 직접 호출)
_send_email = send_email


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

def send_telegram(message: str) -> None:
    """Send a message via Telegram Bot API. Uses stdlib only (no httpx/requests)."""
    settings = get_settings()
    if not settings.TELEGRAM_ENABLED:
        logger.debug("Telegram disabled – skipping message")
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

    # DB 템플릿 우선 사용, 없으면 하드코딩 폴백
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
        subject = f"[ITSM] 새 티켓 #{iid}: {ticket.get('title', '')}"
        body = f"""
        <h2>새 티켓이 등록됐습니다</h2>
        <table>
          <tr><td><b>티켓 번호</b></td><td>#{iid}</td></tr>
          <tr><td><b>제목</b></td><td>{title}</td></tr>
          <tr><td><b>신청자</b></td><td>{employee}</td></tr>
          <tr><td><b>우선순위</b></td><td>{priority}</td></tr>
          <tr><td><b>카테고리</b></td><td>{category}</td></tr>
        </table>
        """
    send_email(recipients, subject, body)
    send_telegram(
        f"🎫 <b>새 티켓 등록</b>\n"
        f"#️⃣ #{iid}: {title}\n"
        f"👤 신청자: {employee}\n"
        f"⚡ 우선순위: {priority} | 📂 카테고리: {category}"
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
        "open": "접수됨", "in_progress": "처리 중", "waiting": "추가정보 대기",
        "resolved": "처리 완료", "closed": "종료됨", "reopened": "재개됨",
    }

    recipients: list[str] = []
    employee_email = ticket.get("employee_email")
    if employee_email:
        recipients.append(employee_email)

    watcher_emails = _get_watcher_emails(int(iid), project_id, exclude_email=employee_email)
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
            subject = f"[ITSM] 티켓 #{iid} 상태 변경: {status_map.get(new_status, new_status)}"
            body = f"""
            <h2>티켓 상태가 변경됐습니다</h2>
            <p>티켓 #{iid}: <b>{title}</b></p>
            <p>상태: {status_map.get(old_status, old_status)} → <b>{status_map.get(new_status, new_status)}</b></p>
            <p>처리자: {actor_name_e}</p>
            """
        send_email(recipients, subject, body)
    send_telegram(
        f"🔄 <b>티켓 상태 변경</b>\n"
        f"#️⃣ #{iid}: {title}\n"
        f"📌 {status_map.get(old_status, old_status)} → <b>{status_map.get(new_status, new_status)}</b>\n"
        f"👷 처리자: {actor_name}"
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
    subject = f"[ITSM] 티켓 #{iid} 새 댓글"
    body = f"""
    <h2>티켓에 새 댓글이 달렸습니다</h2>
    <p>티켓 #{iid}: <b>{title}</b></p>
    <p>작성자: {author_name_e}</p>
    <p>{comment_preview}</p>
    """

    recipients: list[str] = []
    employee_email = ticket.get("employee_email")
    if employee_email:
        recipients.append(employee_email)

    # Also notify watchers
    watcher_emails = _get_watcher_emails(int(iid), project_id, exclude_email=employee_email)
    for email in watcher_emails:
        if email not in recipients:
            recipients.append(email)

    if recipients:
        send_email(recipients, subject, body)


def notify_assigned(assignee_email: str, ticket: dict, actor_name: str) -> None:
    iid = ticket.get("iid", "?")
    title = html.escape(str(ticket.get("title", "")))  # H-2
    actor_name_e = html.escape(str(actor_name))
    subject = f"[ITSM] 티켓 #{iid} 담당자로 배정됐습니다"
    body = f"""
    <h2>담당자로 배정됐습니다</h2>
    <p>티켓 #{iid}: <b>{title}</b></p>
    <p>배정자: {actor_name_e}</p>
    """
    send_email(assignee_email, subject, body)


def notify_sla_warning(ticket_iid: int, project_id: str, minutes_left: int) -> None:
    settings = get_settings()
    recipients: list[str] = []
    if settings.IT_TEAM_EMAIL:
        recipients.append(settings.IT_TEAM_EMAIL)
    if not recipients:
        return

    subject = f"[ITSM] ⏰ SLA 임박 경고 - 티켓 #{ticket_iid} ({minutes_left}분 남음)"
    body = f"""
    <h2>SLA 기한이 임박했습니다</h2>
    <p>티켓 #{ticket_iid} (프로젝트 {project_id})의 SLA 기한까지 <b>{minutes_left}분</b> 남았습니다.</p>
    <p>즉시 처리가 필요합니다.</p>
    """
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

    subject = f"[ITSM] ⚠️ SLA 초과 - 티켓 #{ticket_iid}"
    body = f"""
    <h2>SLA 기한이 초과됐습니다</h2>
    <p>티켓 #{ticket_iid} (프로젝트 {project_id})의 SLA 기한이 지났습니다.</p>
    <p>즉시 처리가 필요합니다.</p>
    """
    send_email(recipients, subject, body)
    send_telegram(
        f"⚠️ <b>SLA 초과 경고</b>\n"
        f"#️⃣ 티켓 #{ticket_iid} (프로젝트 {project_id})\n"
        f"🚨 SLA 기한이 초과됐습니다. 즉시 처리 필요!"
    )


# ---------------------------------------------------------------------------
# In-app notifications (DB + Redis pub/sub)
# ---------------------------------------------------------------------------

def create_db_notification(
    db: Session,
    recipient_id: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
) -> Notification:
    """Create a notification record in the DB and publish to Redis."""
    notif = Notification(
        recipient_id=recipient_id,
        title=title,
        body=body,
        link=link,
    )
    db.add(notif)
    db.commit()
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
        import redis as redis_lib
        settings = get_settings()
        r = redis_lib.from_url(settings.REDIS_URL, decode_responses=True)
        r.publish(f"notifications:{recipient_id}", json.dumps(payload))
    except Exception as e:
        logger.warning("Redis publish failed: %s", e)
