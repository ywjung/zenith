"""Tests for app/email_ingest.py"""
import email
import email.message
from unittest.mock import MagicMock, patch


# ── _sanitize_email_body ────────────────────────────────────────────────────

def test_sanitize_email_body_strips_html():
    from app.email_ingest import _sanitize_email_body
    result = _sanitize_email_body("<b>Hello</b> &amp; World")
    assert "<b>" not in result
    assert "Hello" in result
    assert "& World" in result


def test_sanitize_email_body_empty():
    from app.email_ingest import _sanitize_email_body
    assert _sanitize_email_body("") == ""
    assert _sanitize_email_body(None) == ""  # type: ignore[arg-type]


def test_sanitize_email_body_truncates():
    from app.email_ingest import _sanitize_email_body
    long_text = "x" * 60000
    result = _sanitize_email_body(long_text)
    assert len(result) == 50000


# ── _decode_str ─────────────────────────────────────────────────────────────

def test_decode_str_bytes_with_charset():
    from app.email_ingest import _decode_str
    result = _decode_str(b"hello", "utf-8")
    assert result == "hello"


def test_decode_str_bytes_no_charset():
    from app.email_ingest import _decode_str
    result = _decode_str(b"world")
    assert result == "world"


def test_decode_str_string_passthrough():
    from app.email_ingest import _decode_str
    result = _decode_str("already a string")
    assert result == "already a string"


# ── _parse_subject ──────────────────────────────────────────────────────────

def test_parse_subject_plain():
    from app.email_ingest import _parse_subject
    result = _parse_subject("Hello World")
    assert result == "Hello World"


def test_parse_subject_encoded():
    from app.email_ingest import _parse_subject
    # RFC2047 encoded string
    encoded = "=?utf-8?b?7YWM66y07KCA?="  # "테스트" in base64
    result = _parse_subject(encoded)
    assert isinstance(result, str)
    assert len(result) > 0


# ── _parse_body ─────────────────────────────────────────────────────────────

def test_parse_body_simple():
    from app.email_ingest import _parse_body
    msg = email.message_from_string("Subject: Test\n\nHello from email")
    result = _parse_body(msg)
    assert "Hello" in result


def test_parse_body_multipart():
    from app.email_ingest import _parse_body
    raw = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=boundary\n\n"
        "--boundary\n"
        "Content-Type: text/plain; charset=utf-8\n\n"
        "Plain text body\n"
        "--boundary\n"
        "Content-Type: text/html\n\n"
        "<b>HTML body</b>\n"
        "--boundary--\n"
    )
    msg = email.message_from_string(raw)
    result = _parse_body(msg)
    assert "Plain text body" in result


def test_parse_body_multipart_no_plain():
    from app.email_ingest import _parse_body
    raw = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=boundary\n\n"
        "--boundary\n"
        "Content-Type: text/html\n\n"
        "<b>Only HTML</b>\n"
        "--boundary--\n"
    )
    msg = email.message_from_string(raw)
    result = _parse_body(msg)
    assert isinstance(result, str)


def test_parse_body_no_payload():
    from app.email_ingest import _parse_body
    msg = email.message.Message()
    msg["Content-Type"] = "text/plain"
    # No payload set → payload decode returns None
    result = _parse_body(msg)
    assert result == ""


def test_parse_body_multipart_attachment_skipped():
    from app.email_ingest import _parse_body
    raw = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=boundary\n\n"
        "--boundary\n"
        "Content-Type: text/plain; charset=utf-8\n"
        "Content-Disposition: attachment; filename=test.txt\n\n"
        "Attached text\n"
        "--boundary--\n"
    )
    msg = email.message_from_string(raw)
    result = _parse_body(msg)
    # Attachment is skipped, body should be empty
    assert "Attached text" not in result


# ── _extract_email_address ──────────────────────────────────────────────────

def test_extract_email_address_angle_brackets():
    from app.email_ingest import _extract_email_address
    result = _extract_email_address("John Doe <john@example.com>")
    assert result == "john@example.com"


def test_extract_email_address_plain():
    from app.email_ingest import _extract_email_address
    result = _extract_email_address("  jane@example.com  ")
    assert result == "jane@example.com"


# ── _is_duplicate ───────────────────────────────────────────────────────────

def test_is_duplicate_empty_msgid():
    from app.email_ingest import _is_duplicate
    assert _is_duplicate("") is False


def test_is_duplicate_redis_returns_none_is_new():
    from app.email_ingest import _is_duplicate
    mock_r = MagicMock()
    mock_r.set.return_value = True  # nx=True → key didn't exist → not duplicate
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _is_duplicate("<msg@example.com>")
    assert result is False


def test_is_duplicate_redis_none_key_exists():
    """set(..., nx=True) returns None when key already exists → duplicate."""
    from app.email_ingest import _is_duplicate
    mock_r = MagicMock()
    mock_r.set.return_value = None  # nx=True → key exists → duplicate
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _is_duplicate("<existing@example.com>")
    assert result is True


def test_is_duplicate_redis_client_none():
    from app.email_ingest import _is_duplicate
    with patch("app.redis_client.get_redis", return_value=None):
        result = _is_duplicate("<msg@example.com>")
    assert result is False


def test_is_duplicate_redis_exception():
    from app.email_ingest import _is_duplicate
    with patch("app.redis_client.get_redis", side_effect=Exception("redis down")):
        result = _is_duplicate("<msg@example.com>")
    assert result is False


# ── _store_ticket_msgid ─────────────────────────────────────────────────────

def test_store_ticket_msgid_empty_msgid():
    from app.email_ingest import _store_ticket_msgid
    # Should return early without error
    _store_ticket_msgid("", 42)


def test_store_ticket_msgid_redis_none():
    from app.email_ingest import _store_ticket_msgid
    with patch("app.redis_client.get_redis", return_value=None):
        _store_ticket_msgid("<msg@example.com>", 42)  # should not raise


def test_store_ticket_msgid_success():
    from app.email_ingest import _store_ticket_msgid
    mock_r = MagicMock()
    with patch("app.redis_client.get_redis", return_value=mock_r):
        _store_ticket_msgid("<msg@example.com>", 42)
    mock_r.set.assert_called_once()


def test_store_ticket_msgid_exception():
    from app.email_ingest import _store_ticket_msgid
    with patch("app.redis_client.get_redis", side_effect=Exception("boom")):
        _store_ticket_msgid("<msg@example.com>", 42)  # should not raise


# ── _find_parent_ticket ─────────────────────────────────────────────────────

def test_find_parent_ticket_in_reply_to_hit():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    mock_r.get.return_value = "99"  # ticket iid 99
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _find_parent_ticket("<parent@example.com>", "", "Re: test")
    assert result == 99


def test_find_parent_ticket_references_hit():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    # in_reply_to returns None, references returns ticket iid
    mock_r.get.side_effect = [None, "55"]
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _find_parent_ticket("", "<ref1@example.com> <ref2@example.com>", "Re: test")
    assert result == 55


def test_find_parent_ticket_subject_match():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    mock_r.get.return_value = None  # no redis match

    mock_issue = {"iid": 42}
    with (
        patch("app.redis_client.get_redis", return_value=mock_r),
        patch("app.gitlab_client.get_issue", return_value=mock_issue),
        patch("app.config.get_settings") as mock_settings,
    ):
        mock_settings.return_value.GITLAB_PROJECT_ID = "1"
        result = _find_parent_ticket("", "", "[티켓 #42] 문의합니다")
    assert result == 42


def test_find_parent_ticket_subject_gitlab_error():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    mock_r.get.return_value = None

    with (
        patch("app.redis_client.get_redis", return_value=mock_r),
        patch("app.gitlab_client.get_issue", side_effect=Exception("not found")),
        patch("app.config.get_settings") as mock_settings,
    ):
        mock_settings.return_value.GITLAB_PROJECT_ID = "1"
        result = _find_parent_ticket("", "", "[티켓 #99] 문의합니다")
    assert result is None


def test_find_parent_ticket_no_match():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    mock_r.get.return_value = None
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _find_parent_ticket("", "", "일반 제목")
    assert result is None


def test_find_parent_ticket_redis_exception():
    from app.email_ingest import _find_parent_ticket
    with patch("app.redis_client.get_redis", side_effect=Exception("redis down")):
        # Falls through to subject check
        result = _find_parent_ticket("<msg@example.com>", "", "일반 제목")
    assert result is None


def test_find_parent_ticket_redis_none_client():
    from app.email_ingest import _find_parent_ticket
    mock_r = MagicMock()
    # If r is None but lookup function guards against None
    mock_r.get.return_value = None
    with patch("app.redis_client.get_redis", return_value=mock_r):
        result = _find_parent_ticket("", "", "No ticket here")
    assert result is None


# ── _send_confirmation ──────────────────────────────────────────────────────

def test_send_confirmation_success():
    from app.email_ingest import _send_confirmation
    with patch("app.notifications.send_email") as mock_send:
        _send_confirmation("user@example.com", "제목", 42)
    mock_send.assert_called_once()
    args = mock_send.call_args[0]
    assert "42" in args[1]  # subject contains ticket number


def test_send_confirmation_exception():
    from app.email_ingest import _send_confirmation
    with patch("app.notifications.send_email", side_effect=Exception("smtp error")):
        _send_confirmation("user@example.com", "제목", 42)  # should not raise


# ── process_inbox ───────────────────────────────────────────────────────────

def _make_imap_msg(
    subject="테스트 문의",
    from_addr="user@example.com",
    body="문의 내용",
    message_id="<unique@test.com>",
    in_reply_to="",
    references="",
):
    """Build a raw email bytes object."""
    msg = email.message.Message()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    msg.set_payload(body.encode("utf-8"))
    msg["Content-Type"] = "text/plain; charset=utf-8"
    return msg.as_bytes()


def _mock_imap(msg_bytes_list):
    """Return a mock IMAP4_SSL instance that yields the given messages."""
    mock_imap = MagicMock()
    # search returns message numbers
    nums = [str(i + 1).encode() for i in range(len(msg_bytes_list))]
    mock_imap.search.return_value = (None, [b" ".join(nums)])
    # fetch returns (None, [(num, raw_bytes)])
    fetch_results = [(None, [(None, b)]) for b in msg_bytes_list]
    mock_imap.fetch.side_effect = fetch_results
    mock_imap.select.return_value = (None, [])
    mock_imap.login.return_value = (None, [])
    mock_imap.logout.return_value = (None, [])
    mock_imap.store.return_value = (None, [])
    return mock_imap


def test_process_inbox_imap_not_configured():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = ""
    mock_settings.IMAP_USER = "user@example.com"
    with patch("app.config.get_settings", return_value=mock_settings):
        result = process_inbox()
    assert result == 0


def test_process_inbox_imap_connection_error():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", side_effect=Exception("Connection refused")),
    ):
        result = process_inbox()
    assert result == 0


def test_process_inbox_no_messages():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"

    mock_imap = MagicMock()
    mock_imap.search.return_value = (None, [b""])
    mock_imap.select.return_value = (None, [])

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
    ):
        result = process_inbox()
    assert result == 0


def test_process_inbox_creates_new_ticket():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg()
    mock_imap = _mock_imap([raw])

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.redis_client.get_redis", return_value=MagicMock(set=MagicMock(return_value=True))),
        patch("app.email_ingest._find_parent_ticket", return_value=None),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", return_value={"iid": 100}),
        patch("app.sla.create_sla_record"),
        patch("app.email_ingest._send_confirmation"),
        patch("app.email_ingest._store_ticket_msgid"),
    ):
        result = process_inbox()
    assert result == 1


def test_process_inbox_duplicate_skipped():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"

    raw = _make_imap_msg()
    mock_imap = _mock_imap([raw])

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=True),
    ):
        result = process_inbox()
    assert result == 0
    mock_imap.store.assert_called_once()  # marked as Seen


def test_process_inbox_reply_to_existing_ticket():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg(in_reply_to="<parent@example.com>")
    mock_imap = _mock_imap([raw])

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=42),
        patch("app.gitlab_client.get_issue", return_value={"iid": 42}),
        patch("app.gitlab_client.add_note", return_value={}),
    ):
        result = process_inbox()
    assert result == 1


def test_process_inbox_reply_parent_not_found():
    """Reply to non-existent ticket → creates new ticket instead."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg(in_reply_to="<parent@example.com>")
    mock_imap = _mock_imap([raw])

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=999),
        # get_issue raises → parent_iid becomes None → creates new ticket
        patch("app.gitlab_client.get_issue", side_effect=Exception("not found")),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", return_value={"iid": 101}),
        patch("app.sla.create_sla_record"),
        patch("app.email_ingest._send_confirmation"),
        patch("app.email_ingest._store_ticket_msgid"),
    ):
        result = process_inbox()
    assert result == 1


def test_process_inbox_gitlab_create_fails():
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg()
    mock_imap = _mock_imap([raw])

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=None),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", side_effect=Exception("GitLab error")),
    ):
        result = process_inbox()
    assert result == 0


def test_process_inbox_add_note_fails():
    """Reply comment fails → error logged, continue."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg()
    mock_imap = _mock_imap([raw])

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=42),
        patch("app.gitlab_client.get_issue", return_value={"iid": 42}),
        patch("app.gitlab_client.add_note", side_effect=Exception("note error")),
    ):
        result = process_inbox()
    assert result == 0


def test_process_inbox_max_emails_limit():
    """More than 50 messages → processes only 50, logs warning."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"

    mock_imap = MagicMock()
    # 51 message numbers
    nums = b" ".join(str(i).encode() for i in range(1, 52))
    mock_imap.search.return_value = (None, [nums])
    mock_imap.select.return_value = (None, [])

    # All treated as duplicates so we just test the limit logic
    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=True),
    ):
        result = process_inbox()
    # 50 processed as duplicates + 1 skipped due to limit
    assert mock_imap.fetch.call_count == 50


def test_process_inbox_auto_assign_exception():
    """Auto-assign raises → warning logged, ticket still created."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg()
    mock_imap = _mock_imap([raw])

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=None),
        patch("app.assignment.evaluate_rules", side_effect=Exception("db error")),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", return_value={"iid": 102}),
        patch("app.sla.create_sla_record"),
        patch("app.email_ingest._send_confirmation"),
        patch("app.email_ingest._store_ticket_msgid"),
    ):
        result = process_inbox()
    assert result == 1


def test_process_inbox_sla_creation_exception():
    """SLA creation raises → warning logged, ticket still counted."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw = _make_imap_msg(message_id="<sla-test@example.com>")
    mock_imap = _mock_imap([raw])

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=None),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", return_value={"iid": 103}),
        patch("app.sla.create_sla_record", side_effect=Exception("sla error")),
        patch("app.email_ingest._send_confirmation"),
        patch("app.email_ingest._store_ticket_msgid"),
    ):
        result = process_inbox()
    assert result == 1


def test_process_inbox_logout_exception():
    """imap.logout() raises → no crash (lines 333-335)."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"

    mock_imap = MagicMock()
    mock_imap.search.return_value = (None, [b""])
    mock_imap.select.return_value = (None, [])
    mock_imap.logout.side_effect = Exception("logout error")

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
    ):
        result = process_inbox()
    assert result == 0  # No error raised


def test_process_inbox_per_message_exception():
    """Exception fetching a single message → logged, continue."""
    from app.email_ingest import process_inbox
    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"

    mock_imap = MagicMock()
    mock_imap.search.return_value = (None, [b"1"])
    mock_imap.select.return_value = (None, [])
    mock_imap.fetch.side_effect = Exception("fetch error")

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
    ):
        result = process_inbox()
    assert result == 0


# ── _extract_attachments ────────────────────────────────────────────────────

def test_extract_attachments_no_multipart():
    from app.email_ingest import _extract_attachments
    msg = email.message_from_string("Subject: Test\n\nHello")
    result = _extract_attachments(msg)
    assert result == []


def test_extract_attachments_with_attachment():
    from app.email_ingest import _extract_attachments
    raw = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=boundary\n\n"
        "--boundary\n"
        "Content-Type: text/plain\n\n"
        "Body text\n"
        "--boundary\n"
        "Content-Type: application/octet-stream\n"
        "Content-Disposition: attachment; filename=report.pdf\n\n"
        "file data\n"
        "--boundary--\n"
    )
    msg = email.message_from_string(raw)
    result = _extract_attachments(msg)
    assert "report.pdf" in result


def test_extract_attachments_no_filename():
    """Attachment without filename is skipped."""
    from app.email_ingest import _extract_attachments
    raw = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=bound\n\n"
        "--bound\n"
        "Content-Type: application/octet-stream\n"
        "Content-Disposition: attachment\n\n"
        "data\n"
        "--bound--\n"
    )
    msg = email.message_from_string(raw)
    result = _extract_attachments(msg)
    assert result == []


# ── process_inbox with attachments ─────────────────────────────────────────

def test_process_inbox_with_attachments():
    """Emails with attachments include attachment section in ticket description."""
    from app.email_ingest import process_inbox

    mock_settings = MagicMock()
    mock_settings.IMAP_HOST = "mail.example.com"
    mock_settings.IMAP_USER = "user@example.com"
    mock_settings.IMAP_PASSWORD = "pass"
    mock_settings.IMAP_PORT = 993
    mock_settings.IMAP_FOLDER = "INBOX"
    mock_settings.EMAIL_DEFAULT_CATEGORY = "hardware"
    mock_settings.EMAIL_DEFAULT_PRIORITY = "medium"
    mock_settings.GITLAB_PROJECT_ID = "1"

    raw_msg = (
        "MIME-Version: 1.0\n"
        "Content-Type: multipart/mixed; boundary=bound\n"
        "Subject: Attachment Test\n"
        "From: sender@example.com\n"
        "Message-ID: <attach-test@example.com>\n\n"
        "--bound\n"
        "Content-Type: text/plain; charset=us-ascii\n\n"
        "Email body text\n"
        "--bound\n"
        "Content-Type: application/pdf\n"
        "Content-Disposition: attachment; filename=document.pdf\n\n"
        "pdf data\n"
        "--bound--\n"
    ).encode("ascii")

    mock_imap = MagicMock()
    mock_imap.search.return_value = (None, [b"1"])
    mock_imap.fetch.return_value = (None, [(None, raw_msg)])
    mock_imap.select.return_value = (None, [])
    mock_imap.store.return_value = (None, [])

    created_descriptions = []

    def capture_create_issue(**kwargs):
        created_descriptions.append(kwargs.get("description", ""))
        return {"iid": 200}

    mock_db = MagicMock()
    mock_sl = MagicMock()
    mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
    mock_sl.return_value.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.config.get_settings", return_value=mock_settings),
        patch("imaplib.IMAP4_SSL", return_value=mock_imap),
        patch("app.email_ingest._is_duplicate", return_value=False),
        patch("app.email_ingest._find_parent_ticket", return_value=None),
        patch("app.assignment.evaluate_rules", return_value=None),
        patch("app.database.SessionLocal", mock_sl),
        patch("app.gitlab_client.create_issue", side_effect=capture_create_issue),
        patch("app.sla.create_sla_record"),
        patch("app.email_ingest._send_confirmation"),
        patch("app.email_ingest._store_ticket_msgid"),
    ):
        result = process_inbox()

    assert result == 1
    assert created_descriptions
    assert "document.pdf" in created_descriptions[0]
    assert "첨부 파일" in created_descriptions[0]
