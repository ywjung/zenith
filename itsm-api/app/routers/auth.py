import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse

from ..auth import TOKEN_EXPIRE_HOURS, create_token, get_current_user
from ..config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
def login():
    settings = get_settings()
    params = urllib.parse.urlencode({
        "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": "read_user read_api",
        "state": secrets.token_urlsafe(16),
    })
    return RedirectResponse(f"{settings.GITLAB_EXTERNAL_URL}/oauth/authorize?{params}")


@router.get("/callback")
def callback(code: str = "", error: str = ""):
    if error or not code:
        return RedirectResponse("/login?error=access_denied")

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

        access_token = resp.json().get("access_token")
        user_resp = client.get(
            f"{settings.GITLAB_API_URL}/api/v4/user",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if not user_resp.is_success:
            return RedirectResponse("/login?error=user_info")

        user = user_resp.json()

    token = create_token(user, gitlab_token=access_token)
    response = RedirectResponse("/")
    response.set_cookie(
        "itsm_token",
        token,
        httponly=True,
        max_age=TOKEN_EXPIRE_HOURS * 3600,
        samesite="lax",
    )
    return response


@router.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie("itsm_token")
    return response


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "sub": user["sub"],
        "username": user["username"],
        "name": user["name"],
        "avatar_url": user.get("avatar_url"),
    }
