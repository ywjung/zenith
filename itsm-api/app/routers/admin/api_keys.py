"""Admin API key management endpoints."""
import hashlib as _hashlib
import logging
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ...database import get_db
from ...rbac import require_admin

logger = logging.getLogger(__name__)

api_keys_router = APIRouter()

_API_KEY_SCOPES = ["tickets:read", "tickets:write", "kb:read", "kb:write", "webhooks:write"]


class ApiKeyCreate(BaseModel):
    name: str
    scopes: list[str]
    expires_days: Optional[int] = Field(None, gt=0)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        import re
        if not re.match(r'^[a-zA-Z0-9가-힣\-_\. ]{1,64}$', v):
            raise ValueError("API 키 이름은 1~64자의 영문, 숫자, 한글, -, _, . 만 허용됩니다")
        return v


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list
    created_by: str
    created_at: Optional[datetime]
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    revoked: bool

    model_config = ConfigDict(from_attributes=True)


@api_keys_router.get("/api-keys", response_model=list[ApiKeyResponse])
def list_api_keys(db: Session = Depends(get_db), _user: dict = Depends(require_admin)):
    from ...models import ApiKey
    return db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()


@api_keys_router.post("/api-keys", status_code=201)
def create_api_key(
    body: ApiKeyCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """API 키 발급. raw 키는 응답에서 한 번만 반환 — 재조회 불가."""
    from ...models import ApiKey

    invalid_scopes = [s for s in body.scopes if s not in _API_KEY_SCOPES]
    if invalid_scopes:
        raise HTTPException(400, f"유효하지 않은 스코프: {invalid_scopes}. 가능: {_API_KEY_SCOPES}")

    if db.query(ApiKey).filter(ApiKey.name == body.name, ApiKey.revoked == False).first():  # noqa: E712
        raise HTTPException(400, f"'{body.name}' 이름의 활성 API 키가 이미 존재합니다.")

    raw_key = "itsm_live_" + _secrets.token_urlsafe(24)
    prefix = raw_key[:16]
    key_hash = _hashlib.sha256(raw_key.encode()).hexdigest()

    expires_at = None
    if body.expires_days:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=body.expires_days)).replace(tzinfo=None)

    rec = ApiKey(
        name=body.name,
        key_prefix=prefix,
        key_hash=key_hash,
        scopes=body.scopes,
        created_by=user["username"],
        expires_at=expires_at,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return {
        "id": rec.id,
        "name": rec.name,
        "key": raw_key,
        "key_prefix": prefix,
        "scopes": rec.scopes,
        "expires_at": rec.expires_at.isoformat() if rec.expires_at else None,
        "warning": "이 키는 지금만 표시됩니다. 안전한 곳에 저장하세요.",
    }


@api_keys_router.delete("/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    request: Request,
    key_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    from ...routers.auth import verify_sudo_token  # HIGH-03
    verify_sudo_token(request, user, db)
    from ...models import ApiKey
    rec = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not rec:
        raise HTTPException(404, "API 키를 찾을 수 없습니다.")
    rec.revoked = True
    db.commit()
