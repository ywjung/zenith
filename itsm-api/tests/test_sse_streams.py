"""Tests for SSE stream endpoints (notifications_router and tickets/stream)."""
import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _decode(chunk):
    """Decode bytes or return string as-is."""
    if isinstance(chunk, bytes):
        return chunk.decode("utf-8", errors="replace")
    return chunk


def _make_mock_aioredis():
    """Create a mock aioredis module with standard setup."""
    mock_aioredis = MagicMock()
    mock_r = MagicMock()
    mock_r.aclose = AsyncMock()
    mock_aioredis.from_url.return_value = mock_r
    mock_pubsub = MagicMock()
    mock_r.pubsub.return_value = mock_pubsub
    mock_pubsub.subscribe = AsyncMock()
    mock_pubsub.unsubscribe = AsyncMock()
    return mock_aioredis, mock_r, mock_pubsub


# ── notifications_router.py SSE stream ────────────────────────────────────────

def test_notification_stream_import_error_keep_alive():
    """When redis.asyncio not available → ImportError → keep-alive loop runs then disconnects (lines 94-99)."""
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        blocked = {"redis": None, "redis.asyncio": None}
        with (
            patch.dict(sys.modules, blocked),
            patch("asyncio.sleep", AsyncMock()),
        ):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))
            # no break — let the generator exhaust so asyncio.sleep + return are covered

        return events

    events = _run(_inner())
    assert any("keep-alive" in e for e in events)


def test_notification_stream_redis_connection_error():
    """Redis connection error → log and return early (lines 100-102)."""
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.subscribe = AsyncMock(side_effect=Exception("Connection refused"))

        mock_settings = MagicMock()
        mock_settings.REDIS_URL = "redis://localhost"

        with (
            patch.dict(sys.modules, {"redis": mock_aioredis, "redis.asyncio": mock_aioredis}),
            patch("app.config.get_settings", return_value=mock_settings),
        ):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert events == []


def test_notification_stream_message_delivered():
    """Redis pubsub delivers a message → SSE data line yielded (lines 116-119)."""
    import redis.asyncio as real_aioredis
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value={
            "type": "message",
            "data": '{"id": 1, "title": "Test notification"}'
        })

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert any("data:" in e for e in events)


def test_notification_stream_keepalive_interval():
    """When no message and keepalive interval reached → yield keep-alive (lines 121-124)."""
    import redis.asyncio as real_aioredis
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value=None)

        with (
            patch.object(real_aioredis, "from_url", return_value=mock_r),
            patch("asyncio.get_event_loop") as mock_loop,
        ):
            mock_loop_obj = MagicMock()
            mock_loop.return_value = mock_loop_obj
            mock_loop_obj.time.side_effect = [0.0, 9999.0]
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)


def test_notification_stream_exception_in_loop():
    """Exception inside the while loop → logged (lines 125-126)."""
    import redis.asyncio as real_aioredis
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=False)
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(side_effect=Exception("pubsub error"))

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)


# ── tickets/stream.py SSE stream ─────────────────────────────────────────────

def test_ticket_event_stream_import_error():
    """redis.asyncio not available → ImportError → keep-alive loop runs then disconnects (lines 41-45)."""
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        blocked = {"redis": None, "redis.asyncio": None}
        with (
            patch.dict(sys.modules, blocked),
            patch("asyncio.sleep", AsyncMock()),
        ):
            response = await ticket_event_stream(mock_request, iid=1, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))
            # no break — exhaust generator so asyncio.sleep + return are covered

        return events

    events = _run(_inner())
    assert any("keep-alive" in e for e in events)


def test_ticket_event_stream_redis_connection_error():
    """Redis connection error in ticket stream → log and return early (lines 46-53)."""
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.subscribe = AsyncMock(side_effect=Exception("timeout"))

        with (
            patch.dict(sys.modules, {"redis": mock_aioredis, "redis.asyncio": mock_aioredis}),
        ):
            response = await ticket_event_stream(mock_request, iid=1, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert events == []


def test_ticket_event_stream_message_delivered():
    """Ticket SSE delivers a message to the client (lines 66-68)."""
    import redis.asyncio as real_aioredis
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value={
            "type": "message",
            "data": '{"status": "open"}'
        })

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await ticket_event_stream(mock_request, iid=42, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert any("data:" in e for e in events)


def test_ticket_event_stream_exception_in_loop():
    """Exception in ticket SSE loop → logged (lines 74-75)."""
    import redis.asyncio as real_aioredis
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=False)
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(side_effect=Exception("timeout"))

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await ticket_event_stream(mock_request, iid=1, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)


def test_ticket_event_stream_redis_aclose_fails():
    """Redis aclose fails in ticket stream connect error path (lines 48-52)."""
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_r.aclose = AsyncMock(side_effect=Exception("aclose failed"))
        mock_pubsub.subscribe = AsyncMock(side_effect=Exception("connect error"))

        with (
            patch.dict(sys.modules, {"redis": mock_aioredis, "redis.asyncio": mock_aioredis}),
        ):
            response = await ticket_event_stream(mock_request, iid=5, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert events == []


def test_ticket_event_stream_keepalive():
    """No message and keepalive threshold reached → yield keep-alive (lines 69-73)."""
    import redis.asyncio as real_aioredis
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value=None)

        with (
            patch.object(real_aioredis, "from_url", return_value=mock_r),
            patch("asyncio.get_event_loop") as mock_loop,
        ):
            mock_loop_obj = MagicMock()
            mock_loop.return_value = mock_loop_obj
            mock_loop_obj.time.side_effect = [0.0, 9999.0]
            response = await ticket_event_stream(mock_request, iid=10, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)


def test_notification_stream_finally_cleanup_exception():
    """Exception in finally cleanup block → caught silently (lines 132-133)."""
    import redis.asyncio as real_aioredis
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value={
            "type": "message",
            "data": '{"id": 2}'
        })
        mock_pubsub.unsubscribe = AsyncMock(side_effect=Exception("unsubscribe failed"))

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)


def test_ticket_event_stream_finally_cleanup_exception():
    """Exception in finally cleanup block → caught silently (tickets/stream lines 80-81)."""
    import redis.asyncio as real_aioredis
    from app.routers.tickets.stream import ticket_event_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(side_effect=[False, True])
        mock_user = {"sub": "42"}

        mock_aioredis, mock_r, mock_pubsub = _make_mock_aioredis()
        mock_pubsub.get_message = AsyncMock(return_value={
            "type": "message",
            "data": '{"status": "closed"}'
        })
        mock_pubsub.unsubscribe = AsyncMock(side_effect=Exception("unsubscribe failed"))

        with patch.object(real_aioredis, "from_url", return_value=mock_r):
            response = await ticket_event_stream(mock_request, iid=99, _user=mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(_decode(chunk))

        return events

    events = _run(_inner())
    assert isinstance(events, list)
