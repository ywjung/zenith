import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt

from .config import get_settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 2  # S-3: shortened from 8h to 2h

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# S-1: GitLab account state TTL cache
# ---------------------------------------------------------------------------
_USER_STATE_CACHE: dict[str, tuple[str, float]] = {}  # user_id → (state, expiry)


def _get_gitlab_user_state(user_id: str) -> str:
    """Fetch GitLab user state with a simple in-process TTL cache (5 minutes)."""
    settings = get_settings()
    interval = getattr(settings, "GITLAB_USER_CHECK_INTERVAL", 300)
    now = time.monotonic()

    cached = _USER_STATE_CACHE.get(user_id)
    if cached and now < cached[1]:
        return cached[0]

    try:
        import httpx
        token = settings.GITLAB_PROJECT_TOKEN
        if not token:
            return "active"  # 서비스 토큰 미설정 시 fail-open
        resp = httpx.get(
            f"{settings.GITLAB_API_URL}/api/v4/users/{user_id}",
            headers={"PRIVATE-TOKEN": token},
            timeout=5,
        )
        if resp.is_success:
            state = resp.json().get("state", "active")
        else:
            state = "active"  # fail open if API call fails
    except Exception as e:
        logger.warning("GitLab user state check failed for %s: %s", user_id, e)
        state = "active"

    _USER_STATE_CACHE[user_id] = (state, now + interval)
    return state


def create_token(user: dict, gitlab_token: str = "", role: str = "user") -> str:
    """Create ITSM session token.

    `gitlab_token`은 JWT에 포함된다. JWT는 httponly 쿠키로만 전송되므로
    JavaScript로는 접근 불가. HTTPS 환경에서 전송 중 탈취도 방지된다.
    토큰 소유자 자신의 권한 범위 내에서만 GitLab API를 호출하므로
    admin Sudo 방식보다 blast radius가 작다.
    jti(JWT ID)를 포함해 로그아웃 시 블랙리스트 무효화가 가능하다.
    """
    settings = get_settings()
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "email": user.get("email", ""),
        "avatar_url": user.get("avatar_url"),
        "organization": user.get("organization") or "",
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        "gitlab_token": gitlab_token,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def _is_token_blacklisted(jti: str) -> bool:
    """Redis JWT 블랙리스트에 해당 JTI가 있는지 확인한다."""
    try:
        import redis as redis_lib
        r = redis_lib.from_url(
            get_settings().REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
        )
        return r.exists(f"jwt:blacklist:{jti}") == 1
    except Exception as e:
        logger.warning("JWT blacklist check failed (fail-open): %s", e)
        return False


def blacklist_token(jti: str, ttl_seconds: int) -> None:
    """JTI를 Redis 블랙리스트에 ttl_seconds 동안 등록한다."""
    if not jti or ttl_seconds <= 0:
        return
    try:
        import redis as redis_lib
        r = redis_lib.from_url(
            get_settings().REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
        )
        r.setex(f"jwt:blacklist:{jti}", ttl_seconds, "1")
    except Exception as e:
        logger.warning("JWT blacklist write failed: %s", e)


def _verify_api_key(api_key: str) -> dict | None:
    """API 키를 검증하고 가상 사용자 dict를 반환한다.

    형식: itsm_live_xxxxxxxx... (prefix_hash 앞부분)
    반환 dict는 JWT payload와 동일한 형태.
    """
    import hashlib
    from datetime import datetime, timezone as _tz
    try:
        prefix = api_key[:16]  # "itsm_live_xxxxxx"
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()

        from .database import SessionLocal
        from .models import ApiKey
        with SessionLocal() as db:
            rec = db.query(ApiKey).filter(
                ApiKey.key_prefix == prefix,
                ApiKey.key_hash == key_hash,
                ApiKey.revoked == False,  # noqa: E712
            ).first()
            if not rec:
                return None
            # 만료 확인
            if rec.expires_at:
                exp = rec.expires_at.replace(tzinfo=_tz.utc) if rec.expires_at.tzinfo is None else rec.expires_at
                if datetime.now(_tz.utc) > exp:
                    return None
            # last_used_at 갱신
            rec.last_used_at = datetime.now(_tz.utc).replace(tzinfo=None)
            db.commit()
            return {
                "sub": f"apikey:{rec.id}",
                "username": f"api:{rec.name}",
                "name": rec.name,
                "role": "developer",  # API 키는 developer 권한
                "scopes": rec.scopes,
                "is_api_key": True,
            }
    except Exception as e:
        logger.warning("API key verification error (fail-open): %s", e)
        return None


def get_current_user(request: Request) -> dict:
    # API 키 인증 (Authorization: Bearer itsm_xxx)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer itsm_"):
        api_key = auth_header[7:]  # "Bearer " 제거
        user = _verify_api_key(api_key)
        if user:
            return user
        raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다.")

    token = request.cookies.get("itsm_token")
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    try:
        settings = get_settings()
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="인증이 만료됐습니다.")

    # JTI 블랙리스트 검사 (로그아웃된 토큰 거부)
    jti = payload.get("jti")
    if jti and _is_token_blacklisted(jti):
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    # S-1: Check GitLab account is still active
    user_id = payload.get("sub", "")
    if user_id:
        state = _get_gitlab_user_state(user_id)
        if state != "active":
            raise HTTPException(status_code=401, detail="GitLab 계정이 비활성화됨")

    # S-6: 그룹 멤버 동기화 결과 검사 (퇴사자 차단)
    role = payload.get("role", "user")
    if user_id:
        try:
            from .database import SessionLocal
            from .models import UserRole
            with SessionLocal() as db:
                role_rec = db.query(UserRole).filter(
                    UserRole.gitlab_user_id == int(user_id)
                ).first()
                if role_rec and not role_rec.is_active:
                    raise HTTPException(status_code=403, detail="그룹 멤버십이 해제됐습니다. 관리자에게 문의하세요.")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("UserRole is_active check failed (fail-open): %s", e)

    # S-10: IP 화이트리스트 검사 (역할별 적용)
    settings = get_settings()
    admin_cidrs = getattr(settings, "ADMIN_ALLOWED_CIDRS", "")
    if admin_cidrs and role in ("admin", "agent"):
        from .security import check_ip_whitelist
        client_ip = request.headers.get("X-Forwarded-For", "")
        if not client_ip and request.client:
            client_ip = request.client.host
        if not check_ip_whitelist(client_ip, admin_cidrs):
            logger.warning("IP whitelist blocked: role=%s ip=%s", role, client_ip)
            raise HTTPException(status_code=403, detail=f"허용되지 않은 IP 주소입니다: {client_ip}")

    # S-11: 2FA 강제 정책 검사
    require_2fa_roles = {r.strip() for r in getattr(settings, "REQUIRE_2FA_FOR_ROLES", "").split(",") if r.strip()}
    if role in require_2fa_roles:
        # JWT에 2fa_enabled 클레임이 없으면 GitLab에서 조회
        if not payload.get("two_factor_enabled"):
            try:
                import httpx as _httpx
                gitlab_token = payload.get("gitlab_token", "")
                if gitlab_token:
                    resp = _httpx.get(
                        f"{settings.GITLAB_API_URL}/api/v4/user",
                        headers={"Authorization": f"Bearer {gitlab_token}"},
                        timeout=3,
                    )
                    if resp.is_success and not resp.json().get("two_factor_enabled", True):
                        raise HTTPException(
                            status_code=403,
                            detail="보안 정책상 2FA(이중 인증) 활성화가 필요합니다. GitLab 프로필에서 설정하세요.",
                        )
            except HTTPException:
                raise
            except Exception:
                pass  # fail-open

    return payload
