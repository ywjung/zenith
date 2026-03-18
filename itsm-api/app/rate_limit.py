"""Shared rate-limiter instance with endpoint-specific limits (S-5).

Import this module in routers that need rate limiting, then decorate
specific endpoints with @limiter.limit("N/minute").

Per-endpoint limits:
  POST /auth/*          → 20/min/IP
  POST /tickets         → 10/min/user
  POST /tickets/*/attachments → 5/min/user
  GET  /tickets*        → 300/min/IP
  POST /kb/articles     → 30/min/user
"""
import logging
from fastapi import Request

logger = logging.getLogger(__name__)

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    from .config import get_settings as _get_settings

    def _get_user_or_ip(request: Request) -> str:
        """Key function: use username from JWT cookie if available, else IP."""
        try:
            from jose import jwt as _jwt
            token = request.cookies.get("itsm_token", "")
            if token:
                settings = _get_settings()
                payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                return payload.get("username") or get_remote_address(request)
        except Exception:
            pass
        return get_remote_address(request)

    def _redis_url() -> str:
        try:
            return _get_settings().REDIS_URL
        except Exception:
            return "memory://"

    _storage = _redis_url()
    limiter = Limiter(key_func=get_remote_address, storage_uri=_storage)
    # User-keyed limiter for authenticated endpoints
    user_limiter = Limiter(key_func=_get_user_or_ip, storage_uri=_storage)
    logger.debug("slowapi limiter created with storage: %s", _storage.split("@")[-1])
except Exception as _e:  # noqa: BLE001
    logger.warning("slowapi not available, rate limiting disabled: %s", _e)
    limiter = None  # type: ignore[assignment]
    user_limiter = None  # type: ignore[assignment]

# Convenience limit strings
LIMIT_AUTH = "20/minute"
LIMIT_LOGIN = "10/minute"         # 로그인 시도 제한 (브루트포스 방지)
LIMIT_TICKET_CREATE = "10/minute"
LIMIT_UPLOAD = "5/minute"
LIMIT_TICKET_READ = "300/minute"
LIMIT_KB_CREATE = "30/minute"
LIMIT_COMMENT = "30/minute"       # 댓글 생성 제한 (스팸 방지)
LIMIT_SEARCH = "60/minute"        # 검색 요청 제한
LIMIT_PORTAL = "5/minute"         # 포털 비로그인 신청 제한
