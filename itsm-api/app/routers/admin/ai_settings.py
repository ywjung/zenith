"""
Admin — AI 설정 관리
GET  /admin/ai-settings                         현재 설정 조회 (API 키는 마스킹)
PUT  /admin/ai-settings                         설정 저장
POST /admin/ai-settings/test                    연결 테스트
GET  /admin/ai-settings/status                  현재 활성 상태 (프론트 헤더 배지용)
GET  /admin/ai-settings/openai-oauth/start      팝업에서 OAuth 인증 페이지로 즉시 리다이렉트
GET  /admin/ai-settings/openai-oauth/callback   OAuth 콜백 처리 (토큰 교환 → 저장 → 팝업 결과 전달)
DELETE /admin/ai-settings/openai-oauth          OAuth 연결 해제
POST /admin/ai-settings/openai-oauth/token      Client Credentials 방식 토큰 발급
"""
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
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
    # OAuth 설정
    openai_auth_method: str = "api_key"          # api_key | oauth
    openai_oauth_client_id: Optional[str] = None
    openai_oauth_client_secret: Optional[str] = None  # None = 변경 없음
    openai_oauth_auth_url: Optional[str] = None
    openai_oauth_token_url: Optional[str] = None
    openai_oauth_scope: Optional[str] = None


class AISettingsOut(BaseModel):
    enabled: bool
    provider: str
    openai_api_key_set: bool          # API 키 설정 여부만 노출
    openai_model: str
    ollama_base_url: str
    ollama_model: str
    feature_classify: bool
    feature_summarize: bool
    feature_kb_suggest: bool
    openai_auth_method: str
    openai_oauth_client_id: Optional[str]
    openai_oauth_auth_url: Optional[str]
    openai_oauth_token_url: Optional[str]
    openai_oauth_scope: Optional[str]
    openai_oauth_connected: bool      # access token 보유 여부


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
        "openai_auth_method": row.openai_auth_method or "api_key",
        "openai_oauth_client_id": row.openai_oauth_client_id,
        "openai_oauth_auth_url": row.openai_oauth_auth_url,
        "openai_oauth_token_url": row.openai_oauth_token_url,
        "openai_oauth_scope": row.openai_oauth_scope,
        "openai_oauth_connected": bool(row.openai_oauth_access_token),
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

    # OAuth 설정
    row.openai_auth_method = body.openai_auth_method
    if body.openai_oauth_client_id is not None:
        row.openai_oauth_client_id = body.openai_oauth_client_id or None
    if body.openai_oauth_client_secret is not None:
        row.openai_oauth_client_secret = body.openai_oauth_client_secret or None
    if body.openai_oauth_auth_url is not None:
        row.openai_oauth_auth_url = body.openai_oauth_auth_url or None
    if body.openai_oauth_token_url is not None:
        row.openai_oauth_token_url = body.openai_oauth_token_url or None
    if body.openai_oauth_scope is not None:
        row.openai_oauth_scope = body.openai_oauth_scope or None

    db.commit()
    db.refresh(row)
    logger.info("AI 설정 업데이트: enabled=%s provider=%s auth=%s", row.enabled, row.provider, row.openai_auth_method)
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


# ──────────────────────────────────────────────────────────────
# OpenAI OAuth 2.0 Authorization Code Flow
# ──────────────────────────────────────────────────────────────
_OAUTH_STATE_PREFIX = "openai_oauth_state:"
_OAUTH_STATE_TTL = 600  # 10분


def _redis():
    try:
        from ...redis_client import get_redis
        return get_redis()
    except Exception:
        return None


def _popup_html(ok: bool, msg: str) -> HTMLResponse:
    """
    팝업 창에서 부모 창으로 결과를 전달하고 닫히는 HTML 페이지.
    window.opener가 없으면 (팝업이 아닌 경우) 일반 리다이렉트로 fallback.
    """
    event = "oauth_success" if ok else "oauth_error"
    fallback = f"/admin/ai-settings?oauth={'success' if ok else 'error'}&msg={msg}"
    status_text = "인증 완료" if ok else f"인증 실패: {msg}"
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>OAuth 인증</title>
<style>
  body {{ font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center;
         height:100vh; margin:0; background:#f9fafb; }}
  .box {{ text-align:center; padding:2rem; background:white; border-radius:1rem;
          box-shadow:0 4px 24px rgba(0,0,0,.08); max-width:320px; }}
  .icon {{ font-size:3rem; }}
  p {{ color:#374151; margin:.5rem 0 0; }}
</style>
</head>
<body>
<div class="box">
  <div class="icon">{'✅' if ok else '❌'}</div>
  <p>{status_text}</p>
  <p style="font-size:.8rem;color:#9ca3af;margin-top:.5rem;">이 창은 자동으로 닫힙니다…</p>
</div>
<script>
  (function() {{
    var sent = false;
    function done() {{
      if (sent) return;
      sent = true;
      if (window.opener && !window.opener.closed) {{
        window.opener.postMessage({{event: "{event}", msg: "{msg}"}}, window.location.origin);
        setTimeout(function() {{ window.close(); }}, 800);
      }} else {{
        window.location.href = "{fallback}";
      }}
    }}
    if (document.readyState === "loading") {{
      document.addEventListener("DOMContentLoaded", done);
    }} else {{
      done();
    }}
  }})();
</script>
</body>
</html>""", status_code=200)


@router.get("/openai-oauth/start")
def openai_oauth_start(
    request: Request,
    redirect_uri: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """
    팝업 창에서 직접 열리는 엔드포인트.
    OAuth 설정을 검증하고 즉시 인증 제공자 로그인 페이지로 리다이렉트.
    redirect_uri: 프론트에서 전달한 공개 콜백 URL (없으면 request.base_url 기반으로 자동 구성)
    """
    from urllib.parse import urlencode

    row = _get_or_create(db)
    if not row.openai_oauth_client_id:
        return _popup_html(False, "client_id_not_set")
    if not row.openai_oauth_auth_url:
        return _popup_html(False, "auth_url_not_set")

    state = secrets.token_urlsafe(32)
    r = _redis()

    # redirect_uri 결정: 프론트 전달 값 우선, 없으면 요청 base_url + X-Forwarded 헤더 활용
    if not redirect_uri:
        forwarded_proto = request.headers.get("x-forwarded-proto", "http")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
        redirect_uri = f"{forwarded_proto}://{forwarded_host}/api/admin/ai-settings/openai-oauth/callback"

    if r:
        r.setex(f"{_OAUTH_STATE_PREFIX}{state}", _OAUTH_STATE_TTL, "valid")
        # redirect_uri를 state와 함께 저장 (콜백에서 token exchange 시 재사용)
        r.setex(f"{_OAUTH_STATE_PREFIX}ruri:{state}", _OAUTH_STATE_TTL, redirect_uri)

    scope = row.openai_oauth_scope or "openid"
    params = urlencode({
        "response_type": "code",
        "client_id": row.openai_oauth_client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
    })
    auth_url = f"{row.openai_oauth_auth_url.rstrip('?')}&{params}" if "?" in row.openai_oauth_auth_url else f"{row.openai_oauth_auth_url}?{params}"
    logger.info("OpenAI OAuth start → redirect to auth provider (redirect_uri=%s)", redirect_uri)
    return RedirectResponse(auth_url, status_code=302)


@router.get("/openai-oauth/callback")
def openai_oauth_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    state: str = Query(...),
    error: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    OAuth 콜백 — 인증 코드를 access token으로 교환 후 DB 저장.
    결과를 팝업 postMessage로 부모 창에 전달한 뒤 창을 닫음.
    팝업이 아닌 경우 /admin/ai-settings 로 리다이렉트 (fallback).
    """
    import httpx
    from datetime import datetime, timezone, timedelta

    if error:
        return _popup_html(False, error)

    if not code:
        return _popup_html(False, "no_code")

    # state 검증 & redirect_uri 복원
    r = _redis()
    redirect_uri = None
    if r:
        key = f"{_OAUTH_STATE_PREFIX}{state}"
        if not r.exists(key):
            return _popup_html(False, "invalid_state")
        r.delete(key)
        ruri_raw = r.get(f"{_OAUTH_STATE_PREFIX}ruri:{state}")
        r.delete(f"{_OAUTH_STATE_PREFIX}ruri:{state}")
        if ruri_raw:
            redirect_uri = ruri_raw.decode() if isinstance(ruri_raw, bytes) else ruri_raw

    if not redirect_uri:
        forwarded_proto = request.headers.get("x-forwarded-proto", "http")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
        redirect_uri = f"{forwarded_proto}://{forwarded_host}/api/admin/ai-settings/openai-oauth/callback"

    row = _get_or_create(db)
    if not row.openai_oauth_token_url:
        return _popup_html(False, "token_url_not_set")

    try:
        resp = httpx.post(
            row.openai_oauth_token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": row.openai_oauth_client_id,
                "client_secret": row.openai_oauth_client_secret,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        logger.error("OpenAI OAuth token exchange failed: %s", e)
        return _popup_html(False, "token_exchange_failed")

    access_token = token_data.get("access_token")
    if not access_token:
        return _popup_html(False, "no_access_token")

    expires_in = token_data.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    row.openai_oauth_access_token = access_token
    row.openai_oauth_token_expires_at = expires_at
    row.openai_api_key = access_token
    db.commit()
    logger.info("OpenAI OAuth token saved (expires_at=%s)", expires_at)
    return _popup_html(True, "connected")


@router.delete("/openai-oauth")
def disconnect_openai_oauth(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """OAuth 연결 해제 — 저장된 access token 삭제."""
    row = _get_or_create(db)
    row.openai_oauth_access_token = None
    row.openai_oauth_token_expires_at = None
    row.openai_api_key = None
    row.openai_auth_method = "api_key"
    db.commit()
    return {"ok": True, "message": "OpenAI OAuth 연결이 해제되었습니다."}


@router.post("/openai-oauth/token")
def openai_oauth_client_credentials(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """
    Client Credentials 방식 — 클라이언트 ID/Secret으로 직접 토큰 발급.
    (사용자 리다이렉트 없이 서버-to-서버 인증)
    """
    import httpx
    from datetime import datetime, timezone, timedelta

    row = _get_or_create(db)
    if not row.openai_oauth_client_id or not row.openai_oauth_client_secret:
        raise HTTPException(status_code=400, detail="OAuth Client ID와 Secret이 필요합니다.")
    if not row.openai_oauth_token_url:
        raise HTTPException(status_code=400, detail="OAuth 토큰 URL이 설정되지 않았습니다.")

    try:
        resp = httpx.post(
            row.openai_oauth_token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": row.openai_oauth_client_id,
                "client_secret": row.openai_oauth_client_secret,
                "scope": row.openai_oauth_scope or "",
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"토큰 발급 실패: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OAuth 연결 오류: {e}")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="access_token이 응답에 없습니다.")

    expires_in = token_data.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    row.openai_oauth_access_token = access_token
    row.openai_oauth_token_expires_at = expires_at
    row.openai_api_key = access_token
    db.commit()
    logger.info("OpenAI OAuth client_credentials token saved (expires_at=%s)", expires_at)
    return {
        "ok": True,
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_in": expires_in,
        "scope": token_data.get("scope", ""),
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
