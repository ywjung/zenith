"""Ticket real-time SSE stream endpoint."""
import asyncio
import logging
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from starlette.requests import Request

from ...auth import get_current_user
from ...config import get_settings

logger = logging.getLogger(__name__)

stream_router = APIRouter()


@stream_router.get("/{iid}/stream")
async def ticket_event_stream(
    request: Request,
    iid: int,
    project_id: Optional[str] = None,
    _user: dict = Depends(get_current_user),
):
    """티켓 실시간 이벤트 SSE 스트림.

    웹훅으로 티켓 상태가 바뀌면 Redis → SSE로 즉시 프론트엔드에 알린다.
    """
    settings = get_settings()
    pid = project_id or str(settings.GITLAB_PROJECT_ID)
    channel = f"ticket:events:{pid}:{iid}"

    async def event_generator() -> AsyncGenerator[str, None]:
        r = None
        pubsub = None
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            await pubsub.subscribe(channel)
        except ImportError:
            while not await request.is_disconnected():
                yield ": keep-alive\n\n"
                await asyncio.sleep(30)
            return
        except Exception as e:
            logger.error("Ticket SSE: Redis 연결 실패 (iid=%s): %s", iid, e)
            if r is not None:
                try:
                    await r.aclose()
                except Exception:
                    pass
            return

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
                    yield f"data: {message['data']}\n\n"
                    last_keepalive = asyncio.get_event_loop().time()
                else:
                    now = asyncio.get_event_loop().time()
                    if now - last_keepalive >= keepalive_interval:
                        yield ": keep-alive\n\n"
                        last_keepalive = now
        except Exception as e:
            logger.error("Ticket SSE stream error (iid=%s): %s", iid, e)
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await r.aclose()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
