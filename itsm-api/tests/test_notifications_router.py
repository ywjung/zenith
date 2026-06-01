"""Tests for /notifications endpoints (in-app notifications router)."""
from unittest.mock import patch, MagicMock, AsyncMock


def test_list_notifications_requires_auth(client):
    resp = client.get("/notifications/")
    assert resp.status_code == 401


def test_list_notifications_empty(client, user_cookies):
    resp = client.get("/notifications/", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["unread_count"] == 0
    assert data["notifications"] == []


def test_list_notifications_limit_param(client, user_cookies):
    resp = client.get("/notifications/?limit=5", cookies=user_cookies)
    assert resp.status_code == 200


def test_mark_read_nonexistent_ok(client, user_cookies):
    """Marking non-existent notification as read returns ok=True silently."""
    resp = client.patch("/notifications/9999/read", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_mark_all_read_empty(client, user_cookies):
    resp = client.patch("/notifications/read-all", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_mark_read_and_list(client, user_cookies, db_session):
    """Create a notification via DB directly, mark read, verify unread count drops."""
    from app.models import Notification
    from datetime import datetime, timezone

    notif = Notification(
        id=10001,
        recipient_id="42",
        title="테스트 알림",
        body="본문",
        is_read=False,
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notif)
    db_session.commit()

    # Verify it shows up
    resp = client.get("/notifications/", cookies=user_cookies)
    assert resp.json()["unread_count"] == 1

    # Mark as read
    resp = client.patch("/notifications/10001/read", cookies=user_cookies)
    assert resp.status_code == 200

    # Unread count drops to 0
    resp = client.get("/notifications/", cookies=user_cookies)
    assert resp.json()["unread_count"] == 0


def test_mark_all_read_with_notifications(client, user_cookies, db_session):
    from app.models import Notification
    from datetime import datetime, timezone

    for i in range(3):
        db_session.add(Notification(
            id=20001 + i,
            recipient_id="42",
            title=f"알림 {i}",
            body="본문",
            is_read=False,
            created_at=datetime.now(timezone.utc),
        ))
    db_session.commit()

    resp = client.patch("/notifications/read-all", cookies=user_cookies)
    assert resp.status_code == 200

    resp = client.get("/notifications/", cookies=user_cookies)
    assert resp.json()["unread_count"] == 0


# ── notification prefs ────────────────────────────────────────────────────────

def test_get_prefs_empty(client, user_cookies):
    resp = client.get("/notifications/prefs", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == {}


def test_update_and_get_prefs(client, user_cookies):
    prefs = {"ticket_created": {"email": True, "inapp": False}}
    resp = client.put("/notifications/prefs", json=prefs, cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == prefs

    resp = client.get("/notifications/prefs", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == prefs


def test_update_prefs_twice_overwrites(client, user_cookies):
    client.put("/notifications/prefs", json={"a": True}, cookies=user_cookies)
    resp = client.put("/notifications/prefs", json={"b": False}, cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == {"b": False}


def test_prefs_requires_auth(client):
    resp = client.get("/notifications/prefs")
    assert resp.status_code == 401


# ── announcements ─────────────────────────────────────────────────────────────

def test_get_announcements_empty(client, user_cookies):
    resp = client.get("/notifications/announcements", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_announcements_with_active(client, admin_cookies, user_cookies, db_session):
    from app.models import Announcement
    from datetime import datetime, timezone, timedelta

    ann = Announcement(
        title="점검 공지",
        content="서버 점검이 있습니다.",
        type="warning",
        enabled=True,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1),
        created_by="admin",
    )
    db_session.add(ann)
    db_session.commit()

    resp = client.get("/notifications/announcements", cookies=user_cookies)
    assert resp.status_code == 200
    titles = [a["title"] for a in resp.json()]
    assert "점검 공지" in titles


def test_get_announcements_expired_hidden(client, user_cookies, db_session):
    from app.models import Announcement
    from datetime import datetime, timezone, timedelta

    ann = Announcement(
        title="만료된 공지",
        content="이미 지난 공지입니다.",
        type="info",
        enabled=True,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1),
        created_by="admin",
    )
    db_session.add(ann)
    db_session.commit()

    resp = client.get("/notifications/announcements", cookies=user_cookies)
    assert resp.status_code == 200
    titles = [a["title"] for a in resp.json()]
    assert "만료된 공지" not in titles


def test_get_announcements_disabled_hidden(client, user_cookies, db_session):
    from app.models import Announcement

    ann = Announcement(
        title="비활성 공지",
        content="비활성화된 공지입니다.",
        type="info",
        enabled=False,
        created_by="admin",
    )
    db_session.add(ann)
    db_session.commit()

    resp = client.get("/notifications/announcements", cookies=user_cookies)
    assert resp.status_code == 200
    titles = [a["title"] for a in resp.json()]
    assert "비활성 공지" not in titles


# ── SSE stream endpoint ────────────────────────────────────────────────────────

def test_notification_stream_requires_auth(client):
    resp = client.get("/notifications/stream")
    assert resp.status_code == 401


def test_notification_stream_redis_connection_error():
    """Redis connection error → 브라우저 재시도 힌트(retry) 후 종료.

    SSE 스트림은 무한 keep-alive 루프를 돌기 때문에 TestClient.get()으로 본문을
    끝까지 읽으면 영구 hang이 발생한다(CI 6h 타임아웃의 원인). 따라서 제너레이터를
    직접 구동하되 is_disconnected=True로 즉시 종료시킨다(test_sse_streams.py와 동일 패턴).
    """
    import asyncio
    from app.routers.notifications_router import notification_stream

    async def _inner():
        mock_request = MagicMock()
        mock_request.is_disconnected = AsyncMock(return_value=True)
        mock_user = {"sub": "42"}

        mock_pubsub = AsyncMock()
        mock_pubsub.subscribe.side_effect = Exception("Connection refused")
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = mock_pubsub

        with patch("redis.asyncio.from_url", return_value=mock_redis):
            response = await notification_stream(mock_request, mock_user)
            events = []
            async for chunk in response.body_iterator:
                events.append(chunk)
        return events

    events = asyncio.new_event_loop().run_until_complete(_inner())
    # subscribe 실패 → except 경로에서 retry 힌트 1회 yield 후 종료 (is_disconnected=True)
    assert events == ["retry: 30000\n\n"]
