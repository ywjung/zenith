"""In-app notifications router with SSE streaming."""
import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)


@router.get("/")
def list_notifications(
    limit: int = Query(default=30, ge=1, le=200),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    recipient_id = str(user.get("sub", ""))
    rows = (
        db.query(Notification)
        .filter(Notification.recipient_id == recipient_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )
    unread_count = (
        db.query(Notification)
        .filter(
            Notification.recipient_id == recipient_id,
            Notification.is_read == False,  # noqa: E712
        )
        .count()
    )
    return {
        "unread_count": unread_count,
        "notifications": [_notif_to_dict(n) for n in rows],
    }


@router.patch("/{notif_id}/read")
def mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    recipient_id = str(user.get("sub", ""))
    notif = db.query(Notification).filter(
        Notification.id == notif_id,
        Notification.recipient_id == recipient_id,
    ).first()
    if notif:
        notif.is_read = True
        db.commit()
    return {"ok": True}


@router.patch("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    recipient_id = str(user.get("sub", ""))
    db.query(Notification).filter(
        Notification.recipient_id == recipient_id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.get("/stream")
async def notification_stream(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """SSE endpoint that streams real-time notifications via Redis pub/sub."""
    recipient_id = str(user.get("sub", ""))

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            import redis.asyncio as aioredis
            from ..config import get_settings
            settings = get_settings()
            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            await pubsub.subscribe(f"notifications:{recipient_id}")
        except ImportError:
            # Redis not available – just keep the connection alive
            while not await request.is_disconnected():
                yield ": keep-alive\n\n"
                await asyncio.sleep(30)
            return
        except Exception as e:
            logger.error("SSE stream: Redis 연결 실패 %s", e)
            # 브라우저에 30초 후 재시도 요청 후 keep-alive 모드로 유지
            yield "retry: 30000\n\n"
            while not await request.is_disconnected():
                yield ": keep-alive\n\n"
                await asyncio.sleep(30)
            return

        # get_message(timeout=1.0)으로 1초 대기 → tight loop 방지
        keepalive_interval = 30.0
        last_keepalive = asyncio.get_event_loop().time()
        try:
            while True:
                if await request.is_disconnected():
                    break

                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )

                if message and message.get("type") == "message":
                    data = message.get("data", "{}")
                    yield f"data: {data}\n\n"
                    last_keepalive = asyncio.get_event_loop().time()
                else:
                    now = asyncio.get_event_loop().time()
                    if now - last_keepalive >= keepalive_interval:
                        yield ": keep-alive\n\n"
                        last_keepalive = now
        except Exception as e:
            logger.error("SSE stream error: %s", e)
            # 루프 중 오류 — 브라우저가 즉시 재연결하지 않도록 30초 대기 지시
            try:
                yield "retry: 30000\n\n"
            except Exception:
                pass
        finally:
            # 클라이언트 강제 종료(탭 닫기 등) 시에도 반드시 정리
            try:
                await pubsub.unsubscribe(f"notifications:{recipient_id}")
                await r.aclose()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _notif_to_dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/prefs")
def get_notification_prefs(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from ..models import NotificationPref
    uid = str(user.get("sub", ""))
    rec = db.query(NotificationPref).filter(NotificationPref.user_id == uid).first()
    return rec.prefs if rec else {}


@router.put("/prefs")
def update_notification_prefs(body: dict, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from ..models import NotificationPref
    from datetime import datetime, timezone
    uid = str(user.get("sub", ""))
    rec = db.query(NotificationPref).filter(NotificationPref.user_id == uid).first()
    if rec:
        rec.prefs = body
        rec.updated_at = datetime.now(timezone.utc)
    else:
        rec = NotificationPref(user_id=uid, prefs=body, updated_at=datetime.now(timezone.utc))
        db.add(rec)
    db.commit()
    return rec.prefs


@router.get("/announcements")
def get_active_announcements(db: Session = Depends(get_db), _user: dict = Depends(get_current_user)):
    from ..models import Announcement
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return db.query(Announcement).filter(
        Announcement.enabled == True,
        (Announcement.expires_at == None) | (Announcement.expires_at > now)
    ).order_by(Announcement.created_at.desc()).all()
