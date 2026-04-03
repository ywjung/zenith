"""
Admin — AI 설정 관리
GET  /admin/ai-settings         현재 설정 조회 (API 키는 마스킹)
PUT  /admin/ai-settings         설정 저장
POST /admin/ai-settings/test    연결 테스트
GET  /admin/ai-settings/status  현재 활성 상태 (프론트 헤더 배지용)
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AISettings
from ...rbac import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/ai-settings", tags=["admin-ai"])


# ──────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────
class AISettingsIn(BaseModel):
    enabled: bool = False
    provider: str = "openai"          # openai | ollama
    openai_api_key: Optional[str] = None   # None = 변경 없음, "" = 삭제
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "llama3.2"
    feature_classify: bool = True
    feature_summarize: bool = True
    feature_kb_suggest: bool = True


class AISettingsOut(BaseModel):
    enabled: bool
    provider: str
    openai_api_key_set: bool     # API 키 설정 여부만 노출 (값 비노출)
    openai_model: str
    ollama_base_url: str
    ollama_model: str
    feature_classify: bool
    feature_summarize: bool
    feature_kb_suggest: bool


def _get_or_create(db: Session) -> AISettings:
    row = db.query(AISettings).filter(AISettings.id == 1).first()
    if not row:
        row = AISettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _to_out(row: AISettings) -> dict:
    return {
        "enabled": row.enabled,
        "provider": row.provider,
        "openai_api_key_set": bool(row.openai_api_key),
        "openai_model": row.openai_model,
        "ollama_base_url": row.ollama_base_url,
        "ollama_model": row.ollama_model,
        "feature_classify": row.feature_classify,
        "feature_summarize": row.feature_summarize,
        "feature_kb_suggest": row.feature_kb_suggest,
    }


# ──────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────
@router.get("")
def get_ai_settings(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = _get_or_create(db)
    return _to_out(row)


@router.put("")
def update_ai_settings(
    body: AISettingsIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if body.provider not in ("openai", "ollama"):
        raise HTTPException(status_code=422, detail="provider는 openai 또는 ollama만 허용됩니다.")

    row = _get_or_create(db)
    row.enabled = body.enabled
    row.provider = body.provider
    row.openai_model = body.openai_model
    row.ollama_base_url = body.ollama_base_url
    row.ollama_model = body.ollama_model
    row.feature_classify = body.feature_classify
    row.feature_summarize = body.feature_summarize
    row.feature_kb_suggest = body.feature_kb_suggest

    # API 키: None이면 기존 유지, ""이면 삭제, 값 있으면 저장
    if body.openai_api_key is not None:
        row.openai_api_key = body.openai_api_key or None

    db.commit()
    db.refresh(row)
    logger.info("AI 설정 업데이트: enabled=%s provider=%s", row.enabled, row.provider)
    return _to_out(row)


@router.post("/test")
def test_ai_connection(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """현재 설정으로 AI 연결 테스트."""
    row = _get_or_create(db)
    if not row.enabled:
        raise HTTPException(status_code=400, detail="AI 기능이 비활성화 상태입니다.")

    from ... import ai_service
    try:
        result = ai_service.classify_ticket(
            row,
            title="테스트 티켓",
            description="이메일 로그인이 되지 않습니다. 비밀번호를 올바르게 입력했는데도 접속이 안 됩니다.",
        )
        if result.get("category") is None and result.get("confidence", 0) == 0:
            raise RuntimeError(result.get("reasoning", "응답 파싱 실패"))
        return {
            "ok": True,
            "provider": row.provider,
            "sample_result": result,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 연결 실패: {e}")


@router.get("/status")
def get_ai_status(db: Session = Depends(get_db)):
    """인증 불필요 — 프론트에서 AI 기능 활성 여부 확인용."""
    row = db.query(AISettings).filter(AISettings.id == 1).first()
    if not row:
        return {"enabled": False, "features": {}}
    return {
        "enabled": row.enabled,
        "provider": row.provider if row.enabled else None,
        "features": {
            "classify": row.enabled and row.feature_classify,
            "summarize": row.enabled and row.feature_summarize,
            "kb_suggest": row.enabled and row.feature_kb_suggest,
        },
    }
