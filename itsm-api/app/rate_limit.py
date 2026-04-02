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
            import jwt as _jwt
            token = request.cookies.get("itsm_token", "")
            if token:
                settings = _get_settings()
                payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                return payload.get("username") or get_remote_address(request)
        except Exception:
            pass
        return get_remote_address(request)

    def _get_login_username(request: Request) -> str:
        """로그인 시도 시 username 기반 키 함수 (계정별 브루트포스 방지).

        Request body에서 username을 읽거나, 없으면 IP를 키로 사용.
        실패 횟수만 카운트하기 위해 엔드포인트에서 성공 시 직접 리셋해야 함.
        """
        try:
            # GitLab OAuth는 username이 없으므로 IP 기반으로 폴백
            # /auth/exchange, /portal/submit 등 username이 있는 경우에만 활성화
            body = None
            if hasattr(request, "_body"):
                body = request._body
            if body:
                import json as _json
                data = _json.loads(body)
                username = data.get("username") or data.get("email")
                if username:
                    return f"login_user:{username.lower()}"
        except Exception:
            pass
        return f"login_ip:{get_remote_address(request)}"

    def _redis_url() -> str:
        try:
            return _get_settings().REDIS_URL
        except Exception:
            return "memory://"

    _storage = _redis_url()
    limiter = Limiter(key_func=get_remote_address, storage_uri=_storage)
    # User-keyed limiter for authenticated endpoints
    user_limiter = Limiter(key_func=_get_user_or_ip, storage_uri=_storage)
    # Username-keyed limiter for login endpoints (계정별 브루트포스 방지)
    login_limiter = Limiter(key_func=_get_login_username, storage_uri=_storage)
    logger.debug("slowapi limiter created with storage: %s", _storage.split("@")[-1])
except Exception as _e:  # noqa: BLE001
    logger.warning("slowapi not available, rate limiting disabled: %s", _e)
    # LOW-02: 프로덕션 환경에서 레이트 리밋이 비활성화된 경우 경고
    try:
        from .config import get_settings as _gs
        if _gs().ENVIRONMENT == "production":
            logger.error(
                "CRITICAL: Rate limiting is DISABLED in production! "
                "Install slowapi and ensure Redis is reachable to enable protection."
            )
    except Exception:
        pass
    limiter = None  # type: ignore[assignment]
    user_limiter = None  # type: ignore[assignment]
    login_limiter = None  # type: ignore[assignment]

# Convenience limit strings
LIMIT_AUTH = "20/minute"
LIMIT_LOGIN = "10/minute"         # 로그인 시도 제한 (브루트포스 방지, IP 기반)
LIMIT_LOGIN_PER_USER = "5/minute"  # 계정별 로그인 시도 제한 (브루트포스 방지)
LIMIT_TICKET_CREATE = "10/minute"
LIMIT_UPLOAD = "5/minute"
LIMIT_TICKET_READ = "300/minute"
LIMIT_KB_CREATE = "30/minute"
LIMIT_COMMENT = "30/minute"       # 댓글 생성 제한 (스팸 방지)
LIMIT_SEARCH = "60/minute"        # 검색 요청 제한
LIMIT_PORTAL = "5/minute"         # 포털 비로그인 신청 제한
