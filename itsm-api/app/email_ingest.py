"""IMAP email ingest — poll inbox and convert emails to ITSM tickets."""
import email
import email.message
import imaplib
import logging
import re
from email.header import decode_header as _decode_header
from typing import Optional

logger = logging.getLogger(__name__)

_REDIS_MSGID_PREFIX = "email:msgid:"
_REDIS_MSGID_TTL = 60 * 60 * 24 * 30  # 30 days


def _decode_str(value: str | bytes, charset: Optional[str] = None) -> str:
    if isinstance(value, bytes):
        return value.decode(charset or "utf-8", errors="replace")
    return value


def _parse_subject(raw: str) -> str:
    parts = _decode_header(raw)
    decoded = []
    for part, charset in parts:
        decoded.append(_decode_str(part, charset))
    return "".join(decoded).strip()


def _parse_body(msg: email.message.Message) -> str:
    """Extract plain-text body from email message."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                body = payload.decode(charset, errors="replace") if payload else ""
                break
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        body = payload.decode(charset, errors="replace") if payload else ""
    return body.strip()


def _extract_email_address(raw: str) -> str:
    """Extract bare email address from 'Name <addr>' format."""
    match = re.search(r"<([^>]+)>", raw)
    if match:
        return match.group(1).strip()
    return raw.strip()


def _is_duplicate(message_id: str) -> bool:
    """Return True if this Message-ID was already processed."""
    if not message_id:
        return False
    try:
        from .redis_client import get_redis
        r = get_redis()
        if r is None:
            return False
        key = f"{_REDIS_MSGID_PREFIX}{message_id}"
        result = r.set(key, "1", ex=_REDIS_MSGID_TTL, nx=True)
        return result is None
    except Exception as e:
        logger.warning("Redis msgid check failed (allowing through): %s", e)
        return False


def _send_confirmation(to_email: str, subject: str, ticket_iid: int) -> None:
    from .notifications import send_email
    confirmation_subject = f"Re: {subject} [티켓 #{ticket_iid} 접수됨]"
    body = f"""
    <h2>티켓이 접수됐습니다</h2>
    <p>이메일을 통해 제출하신 문의가 티켓 <b>#{ticket_iid}</b>로 접수됐습니다.</p>
    <p>처리 현황은 ITSM 포털에서 확인하실 수 있습니다.</p>
    """
    try:
        send_email(to_email, confirmation_subject, body)
    except Exception as e:
        logger.warning("Failed to send confirmation email to %s: %s", to_email, e)


def process_inbox() -> int:
    """Connect to IMAP, fetch unseen messages, create tickets. Returns count of tickets created."""
    from .config import get_settings
    from . import gitlab_client
    from .database import SessionLocal
    from . import sla as sla_module
    from .assignment import evaluate_rules

    settings = get_settings()
    if not settings.IMAP_HOST or not settings.IMAP_USER:
        logger.warning("IMAP not configured — skipping email ingest")
        return 0

    created = 0
    imap = None
    try:
        imap = imaplib.IMAP4_SSL(settings.IMAP_HOST, settings.IMAP_PORT)
        imap.login(settings.IMAP_USER, settings.IMAP_PASSWORD)
        imap.select(settings.IMAP_FOLDER)

        _, data = imap.search(None, "UNSEEN")
        message_ids = data[0].split() if data[0] else []
        logger.info("Email ingest: found %d unseen messages", len(message_ids))

        for num in message_ids:
            try:
                _, msg_data = imap.fetch(num, "(RFC822)")
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                message_id = msg.get("Message-ID", "").strip()
                if _is_duplicate(message_id):
                    logger.debug("Skipping duplicate email Message-ID=%s", message_id)
                    imap.store(num, "+FLAGS", "\\Seen")
                    continue

                from_raw = msg.get("From", "")
                from_email = _extract_email_address(from_raw)
                subject_raw = msg.get("Subject", "(no subject)")
                subject = _parse_subject(subject_raw)
                body = _parse_body(msg)

                # Build ticket description
                description = (
                    f"**신청자:** {from_email}\n"
                    f"**이메일:** {from_email}\n\n"
                    f"---\n\n"
                    f"{body}"
                )

                labels = [
                    "status::open",
                    f"cat::{settings.EMAIL_DEFAULT_CATEGORY}",
                    f"prio::{settings.EMAIL_DEFAULT_PRIORITY}",
                ]

                # Auto-assign
                assignee_id: Optional[int] = None
                try:
                    with SessionLocal() as db:
                        assignee_id = evaluate_rules(
                            db,
                            category=settings.EMAIL_DEFAULT_CATEGORY,
                            priority=settings.EMAIL_DEFAULT_PRIORITY,
                            title=subject,
                        )
                except Exception as e:
                    logger.warning("Auto-assign failed for email ticket: %s", e)

                issue = gitlab_client.create_issue(
                    title=subject,
                    description=description,
                    labels=labels,
                    assignee_id=assignee_id,
                )
                ticket_iid = issue.get("iid")

                # Create SLA record
                try:
                    with SessionLocal() as db:
                        sla_module.create_sla_record(
                            db, ticket_iid,
                            str(settings.GITLAB_PROJECT_ID),
                            settings.EMAIL_DEFAULT_PRIORITY,
                        )
                except Exception as e:
                    logger.warning("Failed to create SLA for email ticket #%s: %s", ticket_iid, e)

                _send_confirmation(from_email, subject, ticket_iid)
                imap.store(num, "+FLAGS", "\\Seen")
                created += 1
                logger.info("Email ticket created: #%s from %s subject=%r", ticket_iid, from_email, subject)

            except Exception as e:
                logger.error("Failed to process email %s: %s", num, e)

    except Exception as e:
        logger.error("IMAP connection error: %s", e)
    finally:
        if imap is not None:
            try:
                imap.logout()
            except Exception:
                pass

    return created
