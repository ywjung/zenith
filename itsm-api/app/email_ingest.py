"""IMAP email ingest — poll inbox and convert emails to ITSM tickets."""
import email
import email.message
import html
import imaplib
import logging
import re
from email.header import decode_header as _decode_header
from typing import Optional

logger = logging.getLogger(__name__)

_REDIS_MSGID_PREFIX = "email:msgid:"
_REDIS_TICKET_PREFIX = "email:ticket:"   # message_id → ticket_iid
_REDIS_MSGID_TTL = 60 * 60 * 24 * 30  # 30 days

# 제목에서 티켓 번호 추출 정규식: [티켓 #42], Re: ... #42 ...
_TICKET_IID_RE = re.compile(r"\[티켓\s*#(\d+)\]|티켓\s*#(\d+)", re.IGNORECASE)


def _sanitize_email_body(text: str) -> str:
    """Strip HTML tags from email body, preserving link text and URLs."""
    if not text:
        return ""
    # 링크 보존: <a href="URL">텍스트</a> → 텍스트 (URL)
    text = re.sub(
        r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        lambda m: f"{m.group(2).strip()} ({m.group(1)})" if m.group(2).strip() else m.group(1),
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # 나머지 HTML 태그 제거
    text = re.sub(r'<[^>]+>', '', text)
    # HTML 엔티티 디코딩
    text = html.unescape(text)
    # Limit length
    return text[:50000]


def _extract_attachments(msg: email.message.Message) -> list[str]:
    """Return list of attachment filenames from a multipart email."""
    filenames: list[str] = []
    if not msg.is_multipart():
        return filenames
    for part in msg.walk():
        cd = str(part.get("Content-Disposition", ""))
        if "attachment" not in cd:
            continue
        raw_name = part.get_filename()
        if raw_name:
            # RFC 2047 디코딩
            decoded_parts = _decode_header(raw_name)
            name = "".join(
                (p.decode(ch or "utf-8", errors="replace") if isinstance(p, bytes) else p)
                for p, ch in decoded_parts
            ).strip()
            if name:
                filenames.append(name)
    return filenames


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
    """Return True if this Message-ID was already processed.

    nx=True: 키가 없을 때만 SET → 새 메시지면 False(처리 진행), 이미 있으면 None(중복).
    중복으로 판단된 키는 TTL을 갱신하여 30일 윈도우를 연장한다.
    """
    if not message_id:
        return False
    try:
        from .redis_client import get_redis
        r = get_redis()
        if r is None:
            return False
        key = f"{_REDIS_MSGID_PREFIX}{message_id}"
        result = r.set(key, "1", ex=_REDIS_MSGID_TTL, nx=True)
        if result is None:
            # 중복 — TTL 갱신 (이미 처리된 키지만 만료 기간을 늘려 재처리 방지)
            r.expire(key, _REDIS_MSGID_TTL)
            return True
        return False
    except Exception as e:
        logger.warning("Redis msgid check failed (allowing through): %s", e)
        return False


def _store_ticket_msgid(message_id: str, ticket_iid: int) -> None:
    """Store message_id → ticket_iid mapping so replies can find the parent ticket."""
    if not message_id:
        return
    try:
        from .redis_client import get_redis
        r = get_redis()
        if r is None:
            return
        r.set(f"{_REDIS_TICKET_PREFIX}{message_id}", str(ticket_iid), ex=_REDIS_MSGID_TTL)
    except Exception as e:
        logger.warning("Failed to store ticket msgid mapping: %s", e)


def _find_parent_ticket(in_reply_to: str, references: str, subject: str) -> Optional[int]:
    """Return ticket_iid if this email is a reply to an existing ticket, else None.

    Checks (in order):
    1. In-Reply-To header → Redis lookup
    2. References header (space-separated Message-IDs) → Redis lookup
    3. Subject line containing [티켓 #N]
    """
    try:
        from .redis_client import get_redis
        r = get_redis()

        def _lookup_msgid(mid: str) -> Optional[int]:
            if not mid or r is None:
                return None
            val = r.get(f"{_REDIS_TICKET_PREFIX}{mid.strip()}")
            if val:
                return int(val)
            return None

        # 1. In-Reply-To
        if in_reply_to:
            iid = _lookup_msgid(in_reply_to)
            if iid:
                return iid

        # 2. References (last entry is most recent parent)
        if references:
            for mid in reversed(references.split()):
                iid = _lookup_msgid(mid)
                if iid:
                    return iid

    except Exception as e:
        logger.warning("Redis reply lookup failed: %s", e)

    # 3. Subject pattern — works even without Redis
    # Security: parent_iid comes from untrusted email subject.
    # Validate against GitLab API before linking to prevent IID spoofing.
    m = _TICKET_IID_RE.search(subject)
    if m:
        try:
            candidate_iid = int(m.group(1) or m.group(2))
            # Verify the issue actually exists in the configured project
            from .config import get_settings
            from . import gitlab_client
            settings = get_settings()
            gitlab_client.get_issue(candidate_iid, settings.GITLAB_PROJECT_ID)
            return candidate_iid
        except (ValueError, TypeError) as e:
            logger.warning("Failed to parse ticket IID from subject: %s", e)
        except Exception as e:
            logger.warning(
                "Subject IID #%s validation failed — not linking: %s",
                m.group(1) or m.group(2),
                e,
            )

    return None


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

        MAX_EMAILS_PER_CYCLE = 50
        processed_count = 0

        for num in message_ids:
            if processed_count >= MAX_EMAILS_PER_CYCLE:
                logger.warning(
                    "이메일 처리 한도(%d)에 도달했습니다. 다음 주기에 처리합니다.",
                    MAX_EMAILS_PER_CYCLE,
                )
                break
            processed_count += 1

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
                body = _sanitize_email_body(_parse_body(msg))
                attachments = _extract_attachments(msg)

                in_reply_to = msg.get("In-Reply-To", "").strip()
                references = msg.get("References", "").strip()

                # Check if this is a reply to an existing ticket
                parent_iid = _find_parent_ticket(in_reply_to, references, subject)

                if parent_iid:
                    # Verify the ticket actually exists before adding a comment
                    try:
                        gitlab_client.get_issue(parent_iid, settings.GITLAB_PROJECT_ID)
                    except Exception:
                        logger.warning(
                            "Email reply references non-existent ticket #%s — creating new ticket instead",
                            parent_iid,
                        )
                        parent_iid = None

                if parent_iid:
                    # Add as a comment to the existing ticket
                    note_body = (
                        f"**이메일 답장** — {from_email}\n\n"
                        f"---\n\n"
                        f"{body}"
                    )
                    try:
                        gitlab_client.add_note(parent_iid, note_body)
                        imap.store(num, "+FLAGS", "\\Seen")
                        created += 1
                        logger.info("Email reply added as comment to ticket #%s from %s", parent_iid, from_email)
                    except Exception as e:
                        logger.error("Failed to add email reply as comment to #%s: %s", parent_iid, e)
                    continue

                # New ticket
                _attachment_section = ""
                if attachments:
                    _att_lines = "\n".join(f"- {name}" for name in attachments)
                    _attachment_section = f"\n\n**첨부 파일 ({len(attachments)}개)**\n{_att_lines}"

                description = (
                    f"**신청자:** {from_email}\n"
                    f"**이메일:** {from_email}\n\n"
                    f"---\n\n"
                    f"{body}"
                    f"{_attachment_section}"
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

                issue_title = subject[:240] if subject else "제목 없음"
                try:
                    issue = gitlab_client.create_issue(
                        title=issue_title,
                        description=description,
                        labels=labels,
                        assignee_id=assignee_id,
                    )
                except Exception as e:
                    logger.error("GitLab issue creation failed for email from %s: %s", from_email, e)
                    continue
                ticket_iid = issue.get("iid")

                # Store message_id → ticket_iid mapping for future reply threading
                _store_ticket_msgid(message_id, ticket_iid)

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
