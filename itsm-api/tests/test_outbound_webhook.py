"""Unit tests for app/outbound_webhook.py."""
from unittest.mock import patch, MagicMock


# ── _sign_payload ──────────────────────────────────────────────────────────────

def test_sign_payload_returns_sha256():
    from app.outbound_webhook import _sign_payload
    sig = _sign_payload("secret", b"body")
    assert sig.startswith("sha256=")
    assert len(sig) > 10


def test_sign_payload_different_secrets_differ():
    from app.outbound_webhook import _sign_payload
    sig1 = _sign_payload("secret1", b"body")
    sig2 = _sign_payload("secret2", b"body")
    assert sig1 != sig2


def test_sign_payload_different_bodies_differ():
    from app.outbound_webhook import _sign_payload
    sig1 = _sign_payload("secret", b"body1")
    sig2 = _sign_payload("secret", b"body2")
    assert sig1 != sig2


# ── fire_event ─────────────────────────────────────────────────────────────────

def test_fire_event_unsupported_type_noop():
    """Unsupported event types should be silently ignored."""
    from app.outbound_webhook import fire_event
    with patch("threading.Thread") as mock_thread:
        fire_event("unsupported_event_xyz", {"data": "value"})
    mock_thread.assert_not_called()


def test_fire_event_supported_starts_thread():
    from app.outbound_webhook import fire_event
    mock_thread = MagicMock()
    with patch("threading.Thread", return_value=mock_thread):
        fire_event("ticket_created", {"iid": 1})
    mock_thread.start.assert_called_once()


def test_fire_event_all_supported_events():
    from app.outbound_webhook import SUPPORTED_EVENTS, fire_event
    for event in SUPPORTED_EVENTS:
        mock_thread = MagicMock()
        with patch("threading.Thread", return_value=mock_thread):
            fire_event(event, {"test": "data"})
        mock_thread.start.assert_called_once()


# ── _fire_event_worker ─────────────────────────────────────────────────────────

def test_fire_event_worker_handles_db_error():
    from app.outbound_webhook import _fire_event_worker
    with patch("app.database.SessionLocal", side_effect=Exception("DB 오류")):
        # Should not raise
        _fire_event_worker("ticket_created", {"iid": 1})


def test_fire_event_worker_skips_ssrf_urls():
    from app.outbound_webhook import _fire_event_worker
    from app.models import OutboundWebhook
    mock_hook = MagicMock(spec=OutboundWebhook)
    mock_hook.url = "http://127.0.0.1/admin"  # internal URL
    mock_hook.secret = None
    mock_hook.enabled = True
    mock_hook.events = ["ticket_created"]
    mock_db = MagicMock()
    mock_db.__enter__.return_value = mock_db
    (mock_db.query.return_value.filter.return_value.all.return_value) = [mock_hook]

    with (
        patch("app.database.SessionLocal", return_value=mock_db),
        patch("app.outbound_webhook._send_one") as mock_send,
    ):
        _fire_event_worker("ticket_created", {"iid": 1})
    # SSRF URL should be blocked, _send_one should not be called
    mock_send.assert_not_called()


def test_fire_event_worker_sends_safe_url():
    from app.outbound_webhook import _fire_event_worker
    from app.models import OutboundWebhook
    mock_hook = MagicMock(spec=OutboundWebhook)
    mock_hook.url = "https://hooks.example.com/webhook"
    mock_hook.secret = None
    mock_hook.enabled = True
    mock_hook.events = ["ticket_created"]
    mock_hook.id = 1
    mock_db = MagicMock()
    mock_db.__enter__.return_value = mock_db
    (mock_db.query.return_value.filter.return_value.all.return_value) = [mock_hook]

    with (
        patch("app.database.SessionLocal", return_value=mock_db),
        patch("app.outbound_webhook._send_one", return_value=200) as mock_send,
        patch("app.security.is_safe_external_url", return_value=(True, "")),
    ):
        _fire_event_worker("ticket_created", {"iid": 1})
    mock_send.assert_called_once()


# ── _get_http_client ──────────────────────────────────────────────────────────

def test_get_http_client_returns_client():
    from app.outbound_webhook import _get_http_client
    import httpx
    client = _get_http_client()
    assert isinstance(client, httpx.Client)


# ── _send_one ─────────────────────────────────────────────────────────────────

def test_send_one_success_returns_status_code():
    from app.outbound_webhook import _send_one
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.status_code = 200

    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp

    with patch("app.outbound_webhook._get_http_client", return_value=mock_client):
        result = _send_one("https://example.com/hook", {"event": "test"}, None)
    assert result == 200


def test_send_one_with_secret_adds_signature():
    from app.outbound_webhook import _send_one
    mock_resp = MagicMock()
    mock_resp.is_success = True
    mock_resp.status_code = 200

    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp

    with patch("app.outbound_webhook._get_http_client", return_value=mock_client):
        _send_one("https://example.com/hook", {"event": "test"}, "my-secret")

    _, kwargs = mock_client.post.call_args
    headers = kwargs.get("headers", {})
    assert "X-ITSM-Signature" in headers
    assert headers["X-ITSM-Signature"].startswith("sha256=")


def test_send_one_failure_retries_and_returns_status():
    """Non-success response retries up to _MAX_RETRIES and returns last status."""
    from app.outbound_webhook import _send_one
    mock_resp = MagicMock()
    mock_resp.is_success = False
    mock_resp.status_code = 503

    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp

    with (
        patch("app.outbound_webhook._get_http_client", return_value=mock_client),
        patch("time.sleep"),  # skip actual sleep
    ):
        result = _send_one("https://example.com/hook", {"event": "test"}, None)
    assert result == 503
    assert mock_client.post.call_count == 3  # _MAX_RETRIES


def test_send_one_exception_retries_and_returns_zero():
    """Connection error retries _MAX_RETRIES times and returns 0."""
    from app.outbound_webhook import _send_one
    mock_client = MagicMock()
    mock_client.post.side_effect = Exception("Connection refused")

    with (
        patch("app.outbound_webhook._get_http_client", return_value=mock_client),
        patch("time.sleep"),
    ):
        result = _send_one("https://example.com/hook", {"event": "test"}, None)
    assert result == 0
    assert mock_client.post.call_count == 3
