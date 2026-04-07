"""공유 Redis ConnectionPool — 앱 전체에서 단일 풀을 재사용한다.

각 모듈이 `redis.from_url()`을 직접 호출하면 요청마다 새 소켓이 열려
파일 디스크립터가 고갈된다. 이 모듈을 통해 싱글톤 풀을 사용한다.

사용법:
    from .redis_client import get_redis, scan_delete

    r = get_redis()          # Redis | None
    if r:
        r.set("key", "val")
        scan_delete(r, "prefix:*")
"""
import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_pool: "object | None" = None
_pool_lock = threading.Lock()


def get_redis() -> "object | None":
    """싱글톤 ConnectionPool 기반 동기 Redis 클라이언트 반환. 실패 시 None."""
    global _pool
    try:
        import redis as _redis
        if _pool is None:
            with _pool_lock:
                if _pool is None:
                    from .config import get_settings
                    _pool = _redis.ConnectionPool.from_url(
                        get_settings().REDIS_URL,
                        socket_connect_timeout=1,
                        decode_responses=True,
                        max_connections=30,
                    )
        r = _redis.Redis(connection_pool=_pool)
        r.ping()
        return r
    except Exception as e:
        logger.debug("Redis unavailable: %s", e)
        return None


def scan_delete(r: "object", pattern: str) -> None:
    """KEYS 대신 SCAN 커서로 비블로킹 삭제."""
    cursor = 0
    while True:
        cursor, keys = r.scan(cursor, match=pattern, count=200)
        if keys:
            r.delete(*keys)
        if cursor == 0:
            break
