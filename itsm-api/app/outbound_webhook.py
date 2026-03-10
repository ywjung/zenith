"""아웃바운드 웹훅 발송 모듈.

ITSM 이벤트를 등록된 외부 URL로 HTTP POST 전송한다.
Slack Incoming Webhook, Teams Power Automate, 사내 ERP 등과 연동 가능.

발송 실패 시 최대 3회 재시도(지수 백오프)하고 last_status를 DB에 기록한다.
"""
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# 지원 이벤트 타입
SUPPORTED_EVENTS = {
    "ticket_created",
    "ticket_updated",
    "status_changed",
    "comment_added",
    "assigned",
    "sla_warning",
    "sla_breach",
}

_MAX_RETRIES = 3
_RETRY_DELAYS = [1, 3, 7]  # seconds


def _sign_payload(secret: str, body: bytes) -> str:
    """HMAC-SHA256으로 페이로드를 서명한다.

    수신 측에서 X-ITSM-Signature 헤더로 검증 가능.
    """
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _send_one(url: str, payload: dict, secret: str | None) -> int:
    """단일 URL로 페이로드를 전송하고 HTTP 상태코드를 반환한다."""
    body = json.dumps(payload, ensure_ascii=False, default=str).encode()
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "User-Agent": "ITSM-Portal/1.0",
        "X-ITSM-Event": payload.get("event", ""),
    }
    if secret:
        headers["X-ITSM-Signature"] = _sign_payload(secret, body)

    for attempt, delay in enumerate(_RETRY_DELAYS, 1):
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(url, content=body, headers=headers)
                if resp.is_success:
                    return resp.status_code
                logger.warning(
                    "Outbound webhook attempt %d failed: url=%s status=%d",
                    attempt, url, resp.status_code,
                )
                if attempt < _MAX_RETRIES:
                    time.sleep(delay)
                else:
                    return resp.status_code
        except Exception as e:
            logger.warning("Outbound webhook attempt %d error: url=%s err=%s", attempt, url, e)
            if attempt < _MAX_RETRIES:
                time.sleep(delay)
            else:
                return 0  # 연결 실패
    return 0


def fire_event(event_type: str, payload: dict[str, Any]) -> None:
    """등록된 모든 아웃바운드 웹훅 중 이 이벤트를 구독하는 것을 비동기 전송.

    백그라운드 스레드에서 호출되므로 DB 세션을 직접 열어야 한다.
    """
    if event_type not in SUPPORTED_EVENTS:
        return

    try:
        from .database import SessionLocal
        from .models import OutboundWebhook
        from .security import is_safe_external_url

        full_payload = {
            "event": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **payload,
        }

        with SessionLocal() as db:
            hooks = (
                db.query(OutboundWebhook)
                .filter(
                    OutboundWebhook.enabled == True,  # noqa: E712
                    OutboundWebhook.events.contains([event_type]),
                )
                .all()
            )

            for hook in hooks:
                # SSRF 방지 재검증
                ok, reason = is_safe_external_url(hook.url)
                if not ok:
                    logger.error("Outbound webhook SSRF blocked: id=%d url=%s reason=%s", hook.id, hook.url, reason)
                    continue

                status = _send_one(hook.url, full_payload, hook.secret)
                hook.last_triggered_at = datetime.now(timezone.utc)
                hook.last_status = status
                logger.info("Outbound webhook fired: id=%d event=%s url=%s status=%d", hook.id, event_type, hook.url, status)

            db.commit()
    except Exception as e:
        logger.error("Outbound webhook fire_event error: event=%s err=%s", event_type, e)
