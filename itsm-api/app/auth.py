from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt

from .config import get_settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8


def create_token(user: dict) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "avatar_url": user.get("avatar_url"),
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(request: Request) -> dict:
    token = request.cookies.get("itsm_token")
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    try:
        settings = get_settings()
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="인증이 만료됐습니다.")
