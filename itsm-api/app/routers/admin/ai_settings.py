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
    provider: str = "ollama"          # openai | ollama
    openai_api_key: Optional[str] = None   # None = 변경 없음, "" = 삭제
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://host.docker.internal:11434"
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
    body: dict = None,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """
    AI 연결 테스트.
    body로 설정값을 직접 전달하면 그 값으로 테스트 (저장 전에도 가능).
    body가 없으면 DB에 저장된 설정으로 테스트.

    2단계:
      1) 서버 연결 확인 (Ollama: /api/tags, OpenAI: models list)
      2) 최소 추론 테스트 (단답형 JSON → 빠름)
    """
    import time
    import httpx
    from ... import ai_service

    body = body or {}

    # ── 설정 객체 구성 ──────────────────────────────────────
    if body.get("provider"):
        class _Cfg:
            pass
        cfg = _Cfg()
        cfg.provider       = body.get("provider", "ollama")
        cfg.openai_model   = body.get("openai_model", "gpt-4o-mini")
        cfg.ollama_base_url = body.get("ollama_base_url", "http://host.docker.internal:11434")
        cfg.ollama_model   = body.get("ollama_model", "llama3.2")
        new_key = (body.get("openai_api_key") or "").strip()
        if new_key:
            cfg.openai_api_key = new_key
        else:
            db_row = db.query(AISettings).filter(AISettings.id == 1).first()
            cfg.openai_api_key = db_row.openai_api_key if db_row else None
    else:
        cfg = _get_or_create(db)
        if not cfg.enabled:
            raise HTTPException(status_code=400, detail="AI 기능이 비활성화 상태입니다. 먼저 저장하세요.")

    # ── 1단계: 서버 연결 확인 ───────────────────────────────
    t0 = time.time()
    if cfg.provider == "ollama":
        try:
            r = httpx.get(f"{cfg.ollama_base_url.rstrip('/')}/api/tags", timeout=8.0)
            r.raise_for_status()
            model_names = [m.get("name") for m in r.json().get("models", [])]
        except httpx.ConnectError:
            raise HTTPException(status_code=502,
                detail=f"Ollama 서버에 연결할 수 없습니다: {cfg.ollama_base_url}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Ollama 서버 응답 시간 초과")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Ollama 연결 오류: {e}")

        if cfg.ollama_model not in model_names:
            available = ", ".join(model_names[:5]) or "(없음)"
            raise HTTPException(
                status_code=400,
                detail=f"모델 '{cfg.ollama_model}'이 설치되어 있지 않습니다. "
                       f"사용 가능: {available}"
            )

    elif cfg.provider == "openai":
        if not cfg.openai_api_key:
            raise HTTPException(status_code=400, detail="OpenAI API 키가 설정되지 않았습니다.")
        try:
            from openai import OpenAI, AuthenticationError, APIConnectionError
            client = OpenAI(api_key=cfg.openai_api_key)
            client.models.retrieve(cfg.openai_model)
        except AuthenticationError:
            raise HTTPException(status_code=401, detail="OpenAI API 키가 유효하지 않습니다.")
        except APIConnectionError:
            raise HTTPException(status_code=502, detail="OpenAI 서버에 연결할 수 없습니다.")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAI 연결 오류: {e}")

    connect_ms = int((time.time() - t0) * 1000)

    # ── 2단계: 최소 추론 테스트 (단답형) ─────────────────────
    # 전체 분류 프롬프트 대신 단답형 JSON으로 추론 시간 최소화
    MINI_PROMPT = (
        '다음 JSON만 반환하세요: {"category":"account","priority":"medium",'
        '"confidence":0.9,"reasoning":"테스트"}'
    )
    t1 = time.time()
    try:
        result = ai_service._dispatch(cfg, MINI_PROMPT)
        parsed = ai_service._parse_json(result)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 추론 실패: {e}")

    infer_ms = int((time.time() - t1) * 1000)

    return {
        "ok": True,
        "provider": cfg.provider,
        "model": cfg.ollama_model if cfg.provider == "ollama" else cfg.openai_model,
        "connect_ms": connect_ms,
        "infer_ms": infer_ms,
        "sample_result": {
            "category": parsed.get("category", "account"),
            "priority": parsed.get("priority", "medium"),
            "confidence": parsed.get("confidence", 0.9),
            "reasoning": parsed.get("reasoning", ""),
        },
    }


@router.post("/ollama-models")
def list_ollama_models(
    body: dict,
    _admin=Depends(require_admin),
):
    """
    주어진 Ollama 서버 URL에서 설치된 모델 목록을 조회합니다.
    Body: {base_url: "http://..."}
    """
    import httpx

    base_url = (body.get("base_url") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=422, detail="base_url을 입력하세요.")

    try:
        resp = httpx.get(f"{base_url}/api/tags", timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Ollama 서버에 연결할 수 없습니다: {base_url}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Ollama 서버 응답 시간 초과 (10s)")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama 연결 오류: {e}")

    models = data.get("models", [])
    return {
        "base_url": base_url,
        "models": [
            {
                "name": m.get("name", ""),
                "size_gb": round(m.get("size", 0) / 1e9, 1),
                "modified_at": m.get("modified_at", ""),
                "family": (m.get("details") or {}).get("family", ""),
                "parameter_size": (m.get("details") or {}).get("parameter_size", ""),
            }
            for m in models
        ],
    }


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
