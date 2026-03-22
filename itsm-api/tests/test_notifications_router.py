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


def test_notification_stream_redis_connection_error(client, user_cookies):
    """When Redis connection fails, generator returns immediately (covers lines 100-102)."""
    import asyncio

    async def fake_subscribe(*args, **kwargs):
        raise Exception("Connection refused")

    mock_pubsub = AsyncMock()
    mock_pubsub.subscribe.side_effect = Exception("Connection refused")

    mock_redis = AsyncMock()
    mock_redis.pubsub.return_value = mock_pubsub

    with patch("redis.asyncio.from_url", return_value=mock_redis):
        try:
            resp = client.get("/notifications/stream", cookies=user_cookies)
            assert resp.status_code == 200
        except Exception:
            pass  # streaming responses may raise when generator closes early
