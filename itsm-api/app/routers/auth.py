import hashlib
import hmac
import logging
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from jose import jwt as jose_jwt, JWTError
from pydantic import BaseModel

from ..auth import TOKEN_EXPIRE_HOURS, ALGORITHM, create_token, get_current_user, blacklist_token
from ..crypto import encrypt_token, decrypt_token
from ..config import get_settings
from ..database import get_db
from ..models import UserRole, RefreshToken
from ..rate_limit import limiter
from sqlalchemy.orm import Session

router = APIRouter(prefix="/auth", tags=["auth"])


def _gitlab_access_to_itsm_role(access_level: int) -> str:
    """GitLab 접근 레벨 → ITSM 역할 매핑.

    50 Owner / 40 Maintainer → admin
    30 Developer              → agent
    20 Reporter / 10 Guest    → user
    """
    if access_level >= 40:
        return "admin"
    if access_level >= 30:
        return "agent"
    return "user"


def _fetch_max_access_level(gitlab_user_id: int) -> int:
    """admin token으로 사용자의 GitLab 최고 접근 레벨을 반환한다.

    GitLab 인스턴스 전체 관리자(is_admin=true)는 50으로 처리.
    프로젝트/그룹 멤버십 중 가장 높은 access_level을 반환.
    조회 실패 시 0 반환 → 'user' role로 폴백.
    """
    settings = get_settings()
    headers = {"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN}
    try:
        with httpx.Client(timeout=10) as client:
            # GitLab 인스턴스 관리자 여부 확인
            user_resp = client.get(
                f"{settings.GITLAB_API_URL}/api/v4/users/{gitlab_user_id}",
                headers=headers,
            )
            if user_resp.is_success and user_resp.json().get("is_admin"):
                return 50

            # 프로젝트·그룹 멤버십에서 최고 레벨 조회
            membership_resp = client.get(
                f"{settings.GITLAB_API_URL}/api/v4/users/{gitlab_user_id}/memberships",
                headers=headers,
                params={"per_page": 100},
            )
            if membership_resp.is_success:
                memberships = membership_resp.json()
                if memberships:
                    return max(m.get("access_level", 0) for m in memberships)
    except Exception:
        pass
    return 0


def _sync_role_from_gitlab(db: Session, gitlab_user_id: int, username: str, name: str = "", avatar_url: str = "") -> str:
    """GitLab 권한을 조회해 ITSM role을 동기화하고 반환한다.

    로그인마다 호출되어 GitLab 권한 변경을 자동 반영한다.
    GitLab 조회 실패 시 기존 DB 역할(또는 'user')을 유지한다.
    """
    access_level = _fetch_max_access_level(gitlab_user_id)

    record = db.query(UserRole).filter(UserRole.gitlab_user_id == gitlab_user_id).first()

    if access_level > 0:
        # GitLab 조회 성공 → 동기화
        new_role = _gitlab_access_to_itsm_role(access_level)
        if not record:
            record = UserRole(gitlab_user_id=gitlab_user_id, username=username, name=name or None, role=new_role, avatar_url=avatar_url or None)
            db.add(record)
        else:
            record.role = new_role
            record.username = username
            if name:
                record.name = name
            if avatar_url:
                record.avatar_url = avatar_url
        db.commit()
        return new_role
    else:
        # GitLab 조회 실패 → 기존 역할 유지 (없으면 'user')
        if not record:
            record = UserRole(gitlab_user_id=gitlab_user_id, username=username, name=name or None, role="user", avatar_url=avatar_url or None)
            db.add(record)
            db.commit()
        elif name and not record.name:
            record.name = name
            if avatar_url and not record.avatar_url:
                record.avatar_url = avatar_url
            db.commit()
        return record.role


def _create_refresh_token(db: Session, gitlab_user_id: str, gitlab_refresh_token: str = "") -> str:
    settings = get_settings()

    # 세션 최대 개수 제한 — 초과 시 가장 오래된 세션 폐기
    max_sessions = getattr(settings, "MAX_ACTIVE_SESSIONS", 5)
    if max_sessions > 0:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        active_sessions = (
            db.query(RefreshToken)
            .filter(
                RefreshToken.gitlab_user_id == str(gitlab_user_id),
                RefreshToken.revoked == False,  # noqa: E712
                RefreshToken.expires_at > now,
            )
            .order_by(RefreshToken.created_at.asc())
            .all()
        )
        if len(active_sessions) >= max_sessions:
            # 가장 오래된 세션 폐기
            to_revoke = active_sessions[: len(active_sessions) - max_sessions + 1]
            for old in to_revoke:
                old.revoked = True
            db.flush()

    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    rt = RefreshToken(
        token_hash=token_hash,
        gitlab_user_id=str(gitlab_user_id),
        expires_at=expires_at.replace(tzinfo=None),
        gitlab_refresh_token=encrypt_token(gitlab_refresh_token) if gitlab_refresh_token else None,
    )
    db.add(rt)
    db.commit()
    return raw


@router.get("/login")
@(limiter.limit("20/minute") if limiter else lambda f: f)
def login(request: Request):
    settings = get_settings()
    needs_reauth = request.cookies.get("itsm_reauth") == "1"
    scope = "openid read_user api" if needs_reauth else "read_user api"
    # C-3: state 값을 httponly 쿠키에 저장해 callback에서 검증
    state = secrets.token_urlsafe(32)
    params: dict = {
        "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "state": state,
    }
    if needs_reauth:
        params["prompt"] = "login"

    response = RedirectResponse(f"{settings.GITLAB_EXTERNAL_URL}/oauth/authorize?{urllib.parse.urlencode(params)}")
    response.set_cookie(
        "oauth_state", state,
        httponly=True, max_age=300, samesite="lax",
        secure=settings.COOKIE_SECURE,
    )
    if needs_reauth:
        response.delete_cookie("itsm_reauth")
    return response


@router.get("/callback")
@(limiter.limit("20/minute") if limiter else lambda f: f)
def callback(request: Request, code: str = "", error: str = "", state: str = "", db: Session = Depends(get_db)):
    if error or not code:
        return RedirectResponse("/login?error=access_denied")

    # C-3: OAuth CSRF 방지 — state 파라미터 검증
    expected_state = request.cookies.get("oauth_state", "")
    if not expected_state or not hmac.compare_digest(state, expected_state):
        return RedirectResponse("/login?error=csrf")

    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{settings.GITLAB_API_URL}/oauth/token",
            json={
                "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
                "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
            },
        )
        if not resp.is_success:
            return RedirectResponse("/login?error=token_exchange")

        oauth_resp = resp.json()
        access_token = oauth_resp.get("access_token")
        gitlab_refresh_token = oauth_resp.get("refresh_token", "")
        user_resp = client.get(
            f"{settings.GITLAB_API_URL}/api/v4/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not user_resp.is_success:
            return RedirectResponse("/login?error=user_info")

        user = user_resp.json()

    # GitLab 권한 기반 역할 동기화
    role = _sync_role_from_gitlab(db, user["id"], user["username"], name=user.get("name", ""), avatar_url=user.get("avatar_url", ""))

    token = create_token(user, gitlab_token=access_token, role=role)
    refresh_raw = _create_refresh_token(db, str(user["id"]), gitlab_refresh_token=gitlab_refresh_token)

    response = RedirectResponse("/")
    response.delete_cookie("oauth_state")  # C-3: 사용한 state 쿠키 즉시 삭제
    response.set_cookie(
        "itsm_token",
        token,
        httponly=True,
        max_age=TOKEN_EXPIRE_HOURS * 3600,
        samesite="strict",
        secure=settings.COOKIE_SECURE,
    )
    response.set_cookie(
        "itsm_refresh",
        refresh_raw,
        httponly=True,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        samesite="strict",
        secure=settings.COOKIE_SECURE,
    )
    return response


class _ExchangeBody(BaseModel):
    code: str
    state: str


@router.post("/exchange")
@(limiter.limit("20/minute") if limiter else lambda f: f)
def exchange(request: Request, body: _ExchangeBody, db: Session = Depends(get_db)):
    """프론트엔드 콜백 페이지에서 code/state를 받아 토큰을 발급한다.
    URL 노출 없이 OAuth code를 처리하기 위해 POST body로 수신한다.
    """
    # state 검증 (httponly 쿠키와 비교)
    expected_state = request.cookies.get("oauth_state", "")
    if not expected_state or not hmac.compare_digest(body.state, expected_state):
        raise HTTPException(status_code=400, detail="CSRF 검증 실패")

    settings = get_settings()
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            f"{settings.GITLAB_API_URL}/oauth/token",
            json={
                "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
                "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
                "code": body.code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
            },
        )
        if not resp.is_success:
            raise HTTPException(status_code=400, detail="token_exchange")

        oauth_resp = resp.json()
        access_token = oauth_resp.get("access_token")
        gitlab_refresh_token = oauth_resp.get("refresh_token", "")
        user_resp = client.get(
            f"{settings.GITLAB_API_URL}/api/v4/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not user_resp.is_success:
            raise HTTPException(status_code=400, detail="user_info")

        user = user_resp.json()

    role = _sync_role_from_gitlab(db, user["id"], user["username"], name=user.get("name", ""), avatar_url=user.get("avatar_url", ""))
    token = create_token(user, gitlab_token=access_token, role=role)
    refresh_raw = _create_refresh_token(db, str(user["id"]), gitlab_refresh_token=gitlab_refresh_token)

    response = JSONResponse({"ok": True})
    response.delete_cookie("oauth_state")
    response.set_cookie(
        "itsm_token", token,
        httponly=True, max_age=TOKEN_EXPIRE_HOURS * 3600,
        samesite="strict", secure=settings.COOKIE_SECURE,
    )
    response.set_cookie(
        "itsm_refresh", refresh_raw,
        httponly=True, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        samesite="strict", secure=settings.COOKIE_SECURE,
    )
    return response


@router.post("/refresh")
def refresh_token(request: Request, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    raw = request.cookies.get("itsm_refresh")
    if not raw:
        raise HTTPException(status_code=401, detail="리프레시 토큰이 없습니다.")

    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    record = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked == False,  # noqa: E712
    ).first()

    if not record:
        raise HTTPException(status_code=401, detail="유효하지 않은 리프레시 토큰입니다.")

    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="리프레시 토큰이 만료됐습니다.")

    settings = get_settings()

    role_record = db.query(UserRole).filter(
        UserRole.gitlab_user_id == int(record.gitlab_user_id)
    ).first()
    role = role_record.role if role_record else "user"

    # GitLab refresh_token으로 새 access_token 발급 (없으면 그룹 토큰 사용)
    new_gitlab_token = ""
    stored_gl_refresh = record.gitlab_refresh_token or ""
    plain_gl_refresh = decrypt_token(stored_gl_refresh)  # 복호화
    new_gitlab_refresh_token = plain_gl_refresh
    if plain_gl_refresh:
        try:
            with httpx.Client(timeout=10) as client:
                gl_resp = client.post(
                    f"{settings.GITLAB_API_URL}/oauth/token",
                    json={
                        "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
                        "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
                        "refresh_token": plain_gl_refresh,
                        "grant_type": "refresh_token",
                        "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
                    },
                )
                if gl_resp.is_success:
                    gl_data = gl_resp.json()
                    new_gitlab_token = gl_data.get("access_token", "")
                    new_gitlab_refresh_token = gl_data.get("refresh_token", plain_gl_refresh)
                    # 갱신된 refresh_token 암호화 후 DB 업데이트
                    record.gitlab_refresh_token = encrypt_token(new_gitlab_refresh_token)
                    db.commit()
        except Exception:
            pass  # GitLab 갱신 실패 시 그룹 토큰으로 폴백

    # GitLab OAuth refresh 불가 시 그룹 토큰으로 폴백 (읽기/쓰기 대부분 가능)
    if not new_gitlab_token:
        new_gitlab_token = settings.GITLAB_GROUP_TOKEN or ""

    user_stub = {
        "id": int(record.gitlab_user_id),
        "username": role_record.username if role_record else "",
        "name": (role_record.name or role_record.username) if role_record else "",
        "email": "",
    }
    new_token = create_token(user_stub, gitlab_token=new_gitlab_token, role=role)

    # Token Rotation: revoke old refresh token and issue a new one
    record.revoked = True
    new_refresh_raw = _create_refresh_token(
        db,
        record.gitlab_user_id,
        gitlab_refresh_token=new_gitlab_refresh_token,
    )

    response = JSONResponse({"ok": True})
    response.set_cookie(
        "itsm_token",
        new_token,
        httponly=True,
        max_age=TOKEN_EXPIRE_HOURS * 3600,
        samesite="strict",  # S-3: SameSite=Strict
        secure=settings.COOKIE_SECURE,
    )
    response.set_cookie(
        "itsm_refresh",
        new_refresh_raw,
        httponly=True,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        samesite="strict",
        secure=settings.COOKIE_SECURE,
    )
    return response


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    # Access Token JTI 블랙리스트 등록 (남은 유효 시간 동안)
    raw_access = request.cookies.get("itsm_token")
    if raw_access:
        try:
            settings = get_settings()
            from jose import jwt as _jwt, JWTError as _JWTError
            payload = _jwt.decode(
                raw_access, settings.SECRET_KEY,
                algorithms=[ALGORITHM],
                options={"verify_exp": False},
            )
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                import time as _time
                ttl = int(exp - _time.time())
                if ttl > 0:
                    blacklist_token(jti, ttl)
        except Exception:
            pass

    # Refresh Token 무효화
    raw_refresh = request.cookies.get("itsm_refresh")
    if raw_refresh:
        token_hash = hashlib.sha256(raw_refresh.encode()).hexdigest()
        record = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
        if record:
            record.revoked = True
            db.commit()

    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie("itsm_token")
    response.delete_cookie("itsm_refresh")
    response.set_cookie("itsm_reauth", "1", max_age=300, httponly=True, samesite="lax")
    return response


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "sub": user["sub"],
        "username": user["username"],
        "name": user["name"],
        "email": user.get("email", ""),
        "avatar_url": user.get("avatar_url"),
        "organization": user.get("organization", ""),
        "role": user.get("role", "user"),
    }


# ---------------------------------------------------------------------------
# Sudo Mode — 관리자 재인증 (고위험 작업 전 추가 인증)
# ---------------------------------------------------------------------------

@router.post("/sudo")
def create_sudo_token(
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """현재 GitLab Access Token이 유효함을 재확인하고 10분 유효 sudo_token을 발급한다.

    프론트엔드가 고위험 Admin 작업 전 이 엔드포인트를 호출하고,
    응답받은 sudo_token을 X-Sudo-Token 헤더에 포함시킨다.
    """
    from ..models import SudoToken
    from ..rbac import ROLE_LEVELS, require_admin
    import httpx as _httpx

    role = user.get("role", "user")
    if ROLE_LEVELS.get(role, 0) < ROLE_LEVELS["admin"]:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")

    # GitLab token 재검증 (현재 세션 토큰이 여전히 유효한지 확인)
    gitlab_token = user.get("gitlab_token", "")
    if gitlab_token:
        try:
            settings = get_settings()
            resp = _httpx.get(
                f"{settings.GITLAB_API_URL}/api/v4/user",
                headers={"Authorization": f"Bearer {gitlab_token}"},
                timeout=5,
            )
            if not resp.is_success:
                raise HTTPException(status_code=401, detail="GitLab 세션이 만료됐습니다. 다시 로그인하세요.")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Sudo token GitLab re-check failed (fail-open): %s", e)

    # Sudo 토큰 발급 (10분 유효)
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).replace(tzinfo=None)

    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    sudo = SudoToken(
        token_hash=token_hash,
        user_id=str(user.get("sub", "")),
        expires_at=expires_at,
        ip_address=ip,
    )
    db.add(sudo)
    db.commit()

    logger.info("Sudo token issued: user=%s ip=%s", user.get("username"), ip)
    return {"sudo_token": raw, "expires_in": 600}


def verify_sudo_token(token: Optional[str], user: dict, db) -> None:
    """sudo_token 검증 헬퍼 — 유효하지 않으면 403 raise.

    고위험 Admin 엔드포인트에서 호출한다.
    SUDO_MODE_ENABLED=false 환경변수로 전체 비활성화 가능 (개발 환경용).
    """
    from ..models import SudoToken
    settings = get_settings()
    if not getattr(settings, "SUDO_MODE_ENABLED", True):
        return  # 개발 환경에서 비활성화

    if not token:
        raise HTTPException(
            status_code=403,
            detail="고위험 작업입니다. POST /auth/sudo 로 재인증 후 X-Sudo-Token 헤더를 포함하세요.",
        )

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rec = db.query(SudoToken).filter(
        SudoToken.token_hash == token_hash,
        SudoToken.user_id == str(user.get("sub", "")),
        SudoToken.expires_at > now,
    ).first()
    if not rec:
        raise HTTPException(status_code=403, detail="Sudo 토큰이 유효하지 않거나 만료됐습니다.")
