"""
Admin — AI 설정 관리
GET  /admin/ai-settings                                   현재 설정 조회 (API 키는 마스킹)
PUT  /admin/ai-settings                                   설정 저장
POST /admin/ai-settings/test                              연결 테스트
GET  /admin/ai-settings/status                            현재 활성 상태 (프론트 헤더 배지용)
GET  /admin/ai-settings/openai-oauth/start                Codex OAuth URL + state 반환 (PKCE, JSON)
GET  /admin/ai-settings/openai-oauth/callback             OAuth 콜백 처리 (PKCE 토큰 교환 → 저장 → HTML)
GET  /admin/ai-settings/openai-oauth/callback-status      팝업 결과 폴링 엔드포인트
DELETE /admin/ai-settings/openai-oauth                    OAuth 연결 해제
POST /admin/ai-settings/openai-oauth/token                Client Credentials 방식 토큰 발급
GET  /admin/ai-settings/openai-oauth/codex-preset         Codex OAuth 프리셋 설정값 반환
"""
import base64
import hashlib
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import AISettings
from ...rbac import require_admin
from ...security import is_safe_external_url

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
    openai_auth_method: str = "api_key"          # api_key | oauth | codex_oauth
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
    openai_oauth_account_id: Optional[str]  # 연결된 계정 ID


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
        "openai_oauth_account_id": row.openai_oauth_account_id,
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
    request: Request,
    body: dict = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    AI 연결 테스트.
    body로 설정값을 직접 전달하면 그 값으로 테스트 (저장 전에도 가능).
    body가 없으면 DB에 저장된 설정으로 테스트.

    SEC #2: 임의 URL을 외부에서 입력받으므로 sudo token 필수.
    이전엔 admin 쿠키만으로 호출 가능 → 도난된 admin 세션으로 SSRF 가능.

    2단계:
      1) 서버 연결 확인 (Ollama: /api/tags, OpenAI: models list)
      2) 최소 추론 테스트 (단답형 JSON → 빠름)
    """
    # SEC #2: sudo 인증 요구
    from ...routers.auth import verify_sudo_token
    verify_sudo_token(request, admin, db)

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

    # ── SSRF 방지 — Ollama URL 검증 ─────────────────────────
    if cfg.provider == "ollama":
        from ...config import get_settings
        allow_internal = getattr(get_settings(), "ENVIRONMENT", "production") == "development"
        ok, reason = is_safe_external_url(cfg.ollama_base_url, allow_internal=allow_internal)
        if not ok:
            raise HTTPException(status_code=400, detail=f"허용되지 않는 Ollama 서버 주소입니다: {reason}")

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
            logger.error("Ollama connection failed: %s", e)
            raise HTTPException(
                status_code=502,
                detail="Ollama 연결 오류가 발생했습니다. 관리자 로그를 확인하세요.",
            )

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
    request: Request,
    body: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """
    주어진 Ollama 서버 URL에서 설치된 모델 목록을 조회합니다.
    Body: {base_url: "http://..."}

    SEC #2: 외부 입력 URL에 GET 요청을 발행하므로 sudo token 필수.
    """
    # SEC #2: sudo 인증 요구
    from ...routers.auth import verify_sudo_token
    verify_sudo_token(request, admin, db)

    import httpx

    base_url = (body.get("base_url") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=422, detail="base_url을 입력하세요.")

    # SSRF 방지 — 내부망 주소 차단 (Docker 내부 호스트는 허용)
    from ...config import get_settings
    allow_internal = getattr(get_settings(), "ENVIRONMENT", "production") == "development"
    ok, reason = is_safe_external_url(base_url, allow_internal=allow_internal)
    if not ok:
        raise HTTPException(status_code=400, detail=f"허용되지 않는 Ollama 서버 주소입니다: {reason}")

    try:
        resp = httpx.get(f"{base_url}/api/tags", timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Ollama 서버에 연결할 수 없습니다: {base_url}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Ollama 서버 응답 시간 초과 (10s)")
    except Exception as e:
        logger.error("Ollama list_models failed: %s", e)
        raise HTTPException(status_code=502, detail="Ollama 연결 오류가 발생했습니다. 관리자 로그를 확인하세요.")

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
# OpenAI OAuth 2.0 + Codex OAuth (PKCE)
# ──────────────────────────────────────────────────────────────
_OAUTH_STATE_PREFIX = "openai_oauth_state:"
_OAUTH_STATE_TTL = 600  # 10분
_CALLBACK_STATUS_PREFIX = "codex_callback_status:"
_CALLBACK_STATUS_TTL = 300  # 5분

# Codex OAuth redirect_uri — OpenAI auth.openai.com에 고정 등록된 값
# 변경 불가 (포트 1455, localhost 만 허용)
CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback"

# OpenAI Codex CLI 공개 OAuth 클라이언트
# 바이너리 역공학으로 확인된 실제 엔드포인트
# redirect_uri: RFC 8252 loopback (http://127.0.0.1:{port}/callback) 만 허용
CODEX_AUTH_URL = "https://auth.openai.com/oauth/authorize"
CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
# Codex CLI 공개 클라이언트 허용 스코프 (auth.openai.com에 등록된 값만 사용 가능)
CODEX_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke"
# Codex CLI 필수 추가 파라미터 (없으면 unknown_error)
CODEX_EXTRA_PARAMS = {
    "id_token_add_organizations": "true",
    "codex_cli_simplified_flow": "true",
    "originator": "codex_cli_rs",
}


def _redis():
    try:
        from ...redis_client import get_redis
        return get_redis()
    except Exception:
        return None


def _pkce_pair() -> tuple[str, str]:
    """PKCE code_verifier / code_challenge(S256) 쌍 생성."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _jwt_sub(token: str) -> str:
    """JWT payload에서 sub(account id) 추출."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        import json as _json
        data = _json.loads(base64.urlsafe_b64decode(payload))
        return data.get("sub") or data.get("account_id") or ""
    except Exception:
        return ""


def _popup_html(ok: bool, msg: str) -> HTMLResponse:
    """
    Codex OAuth 팝업 결과 페이지 (port 1455 경유).
    부모 창은 polling 방식으로 결과를 확인하므로 postMessage 불필요.
    window.close() 시도 후 실패 시 수동 닫기 안내.
    """
    import html as _html
    safe_msg = _html.escape(msg)
    status_text = "인증 완료! 창을 닫아주세요." if ok else f"인증 실패: {safe_msg}"
    icon = "✅" if ok else "❌"
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
  <div class="icon">{icon}</div>
  <p>{status_text}</p>
  <p style="font-size:.8rem;color:#9ca3af;margin-top:.5rem;">잠시 후 자동으로 닫힙니다…</p>
</div>
<script>setTimeout(function(){{ window.close(); }}, 1500);</script>
</body>
</html>""", status_code=200)


@router.get("/openai-oauth/codex-preset")
def openai_oauth_codex_preset(_admin=Depends(require_admin)):
    """Codex OAuth 고정 설정값 반환 — 프론트에서 폼 자동 입력에 사용."""
    return {
        "auth_url": CODEX_AUTH_URL,
        "token_url": CODEX_TOKEN_URL,
        "client_id": CODEX_CLIENT_ID,
        "scope": CODEX_SCOPE,
    }


@router.get("/openai-oauth/start")
def openai_oauth_start(
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """
    OAuth 인증 URL과 state를 JSON으로 반환.
    프론트엔드가 window.open(authorize_url) 후 state로 폴링.

    - Codex OAuth: PKCE + 고정 redirect_uri (http://localhost:1455/auth/callback)
    - 일반 OAuth: DB 저장 endpoint 사용
    """
    from urllib.parse import urlencode

    row = _get_or_create(db)
    is_codex = row.openai_auth_method == "codex_oauth"

    # 인증 URL / client_id / redirect_uri 결정
    if is_codex:
        auth_url_base = CODEX_AUTH_URL
        client_id = CODEX_CLIENT_ID
        scope = CODEX_SCOPE
        # OpenAI auth.openai.com에 고정 등록된 값 — 변경 불가
        redirect_uri = CODEX_REDIRECT_URI
    else:
        if not row.openai_oauth_client_id:
            raise HTTPException(status_code=400, detail="client_id가 설정되지 않았습니다.")
        if not row.openai_oauth_auth_url:
            raise HTTPException(status_code=400, detail="auth_url이 설정되지 않았습니다.")
        auth_url_base = row.openai_oauth_auth_url
        client_id = row.openai_oauth_client_id
        scope = row.openai_oauth_scope or "openid"
        proto = request.headers.get("x-forwarded-proto", "http")
        host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
        redirect_uri = f"{proto}://{host}/api/admin/ai-settings/openai-oauth/callback"

    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()

    # SEC #10: state를 시작 admin에게 바인딩 — callback이 다른 사용자에 의해 횡탈되는 것 방지
    admin_sub = str(_admin.get("sub", "") or "")

    r = _redis()
    if r:
        r.setex(f"{_OAUTH_STATE_PREFIX}{state}", _OAUTH_STATE_TTL, "valid")
        r.setex(f"{_OAUTH_STATE_PREFIX}ruri:{state}", _OAUTH_STATE_TTL, redirect_uri)
        r.setex(f"{_OAUTH_STATE_PREFIX}pkce:{state}", _OAUTH_STATE_TTL, verifier)
        # SEC #10: state → 시작 admin sub 매핑 (callback에서 검증)
        if admin_sub:
            r.setex(f"{_OAUTH_STATE_PREFIX}sub:{state}", _OAUTH_STATE_TTL, admin_sub)
        if is_codex:
            r.setex(f"{_OAUTH_STATE_PREFIX}codex:{state}", _OAUTH_STATE_TTL, "1")

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if is_codex:
        params.update(CODEX_EXTRA_PARAMS)

    sep = "&" if "?" in auth_url_base else "?"
    authorize_url = f"{auth_url_base.rstrip('?')}{sep}{urlencode(params)}"
    logger.info("OAuth start → %s mode, redirect_uri=%s", "codex" if is_codex else "custom", redirect_uri)
    return {"authorize_url": authorize_url, "state": state}


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

    def _fail(reason: str) -> HTMLResponse:
        r2 = _redis()
        if r2:
            import json as _json
            r2.setex(f"{_CALLBACK_STATUS_PREFIX}{state}", _CALLBACK_STATUS_TTL,
                     _json.dumps({"ok": False, "error": reason}))
        return _popup_html(False, reason)

    if error:
        return _fail(error)

    if not code:
        return _fail("no_code")

    # state 검증 & redirect_uri / PKCE verifier 복원
    r = _redis()
    redirect_uri = None
    code_verifier = None
    is_codex = False
    bound_admin_sub: Optional[str] = None
    if r:
        key = f"{_OAUTH_STATE_PREFIX}{state}"
        if not r.exists(key):
            logger.warning("OAuth callback with invalid state (possible CSRF): state=%s ip=%s",
                           state[:16], request.client.host if request.client else "unknown")
            return _fail("invalid_state")
        r.delete(key)

        ruri_raw = r.get(f"{_OAUTH_STATE_PREFIX}ruri:{state}")
        r.delete(f"{_OAUTH_STATE_PREFIX}ruri:{state}")
        if ruri_raw:
            redirect_uri = ruri_raw.decode() if isinstance(ruri_raw, bytes) else ruri_raw

        pkce_raw = r.get(f"{_OAUTH_STATE_PREFIX}pkce:{state}")
        r.delete(f"{_OAUTH_STATE_PREFIX}pkce:{state}")
        if pkce_raw:
            code_verifier = pkce_raw.decode() if isinstance(pkce_raw, bytes) else pkce_raw

        codex_flag = r.get(f"{_OAUTH_STATE_PREFIX}codex:{state}")
        r.delete(f"{_OAUTH_STATE_PREFIX}codex:{state}")
        is_codex = bool(codex_flag)

        # SEC #10: state를 시작한 admin sub 복원 (audit log 용도)
        sub_raw = r.get(f"{_OAUTH_STATE_PREFIX}sub:{state}")
        r.delete(f"{_OAUTH_STATE_PREFIX}sub:{state}")
        if sub_raw:
            bound_admin_sub = sub_raw.decode() if isinstance(sub_raw, bytes) else sub_raw
        # Codex callback은 cross-site redirect (auth.openai.com → localhost:1455)이므로
        # SameSite=strict 쿠키가 전송되지 않아 cookie 기반 검증 불가.
        # state 자체가 32바이트 random + Redis 단발 사용으로 충분히 강력하므로
        # bound sub는 audit trail 용도로만 사용.
        logger.info("OAuth callback success: state=%s bound_admin_sub=%s ip=%s",
                    state[:16], bound_admin_sub or "(none)",
                    request.client.host if request.client else "unknown")

    # Codex OAuth는 항상 고정 redirect_uri 사용
    if is_codex:
        redirect_uri = CODEX_REDIRECT_URI
    elif not redirect_uri:
        forwarded_proto = request.headers.get("x-forwarded-proto", "http")
        forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
        redirect_uri = f"{forwarded_proto}://{forwarded_host}/api/admin/ai-settings/openai-oauth/callback"

    row = _get_or_create(db)

    # token_url / client_id 결정
    if is_codex:
        token_url = CODEX_TOKEN_URL
        client_id = CODEX_CLIENT_ID
        client_secret = None  # PKCE public client — secret 불필요
    else:
        token_url = row.openai_oauth_token_url
        client_id = row.openai_oauth_client_id
        client_secret = row.openai_oauth_client_secret
        if not token_url:
            return _fail("token_url_not_set")

    token_params: dict = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }
    if client_secret:
        token_params["client_secret"] = client_secret
    if code_verifier:
        token_params["code_verifier"] = code_verifier

    try:
        resp = httpx.post(token_url, data=token_params, timeout=15.0)
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as e:
        logger.error("OpenAI OAuth token exchange failed: %s", e)
        return _fail("token_exchange_failed")

    access_token = token_data.get("access_token")
    if not access_token:
        return _fail("no_access_token")

    expires_in = token_data.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    row.openai_oauth_access_token = access_token
    row.openai_oauth_token_expires_at = expires_at
    row.openai_api_key = access_token

    # Codex OAuth 전용 필드
    refresh_token = token_data.get("refresh_token")
    if refresh_token:
        row.openai_oauth_refresh_token = refresh_token
    account_id = _jwt_sub(access_token)
    if account_id:
        row.openai_oauth_account_id = account_id

    db.commit()
    logger.info("OpenAI OAuth token saved (codex=%s, account=%s, expires_at=%s)",
                is_codex, account_id or "-", expires_at)

    # 폴링 엔드포인트를 위해 결과를 Redis에 저장
    if r:
        import json as _json
        r.setex(f"{_CALLBACK_STATUS_PREFIX}{state}", _CALLBACK_STATUS_TTL,
                _json.dumps({"ok": True, "account_id": account_id or ""}))

    return _popup_html(True, "connected")


@router.get("/openai-oauth/callback-status")
def openai_oauth_callback_status(
    state: str = Query(...),
    _admin=Depends(require_admin),
):
    """
    팝업 OAuth 결과 폴링 엔드포인트.
    프론트엔드가 2초 간격으로 호출하여 인증 완료 여부를 확인.
    Returns: {"done": false} 또는 {"done": true, "ok": true/false, ...}
    """
    import json as _json
    r = _redis()
    if not r:
        raise HTTPException(status_code=503, detail="Redis 연결 불가")
    raw = r.get(f"{_CALLBACK_STATUS_PREFIX}{state}")
    if raw is None:
        return {"done": False}
    data = _json.loads(raw)
    return {"done": True, **data}


@router.delete("/openai-oauth")
def disconnect_openai_oauth(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """OAuth 연결 해제 — 저장된 access token 삭제."""
    row = _get_or_create(db)
    row.openai_oauth_access_token = None
    row.openai_oauth_token_expires_at = None
    row.openai_oauth_refresh_token = None
    row.openai_oauth_account_id = None
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
