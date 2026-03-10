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

    def _get_user_or_ip(request: Request) -> str:
        """Key function: use username from JWT cookie if available, else IP."""
        try:
            from jose import jwt as _jwt
            from .config import get_settings
            token = request.cookies.get("itsm_token", "")
            if token:
                settings = get_settings()
                payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                return payload.get("username") or get_remote_address(request)
        except Exception:
            pass
        return get_remote_address(request)

    limiter = Limiter(key_func=get_remote_address)
    # User-keyed limiter for authenticated endpoints
    user_limiter = Limiter(key_func=_get_user_or_ip)
    logger.debug("slowapi limiter created")
except Exception as _e:  # noqa: BLE001
    logger.warning("slowapi not available, rate limiting disabled: %s", _e)
    limiter = None  # type: ignore[assignment]
    user_limiter = None  # type: ignore[assignment]

# Convenience limit strings
LIMIT_AUTH = "20/minute"
LIMIT_TICKET_CREATE = "10/minute"
LIMIT_UPLOAD = "5/minute"
LIMIT_TICKET_READ = "300/minute"
LIMIT_KB_CREATE = "30/minute"
