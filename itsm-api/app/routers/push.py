"""Web Push 구독 관리 및 VAPID 공개키 제공."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..models import WebPushSubscription

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/push", tags=["push"])

settings = get_settings()


# ── 스키마 ─────────────────────────────────────────────────────────────────

class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


# ── 엔드포인트 ──────────────────────────────────────────────────────────────

@router.get("/vapid-public-key")
def get_vapid_public_key():
    """브라우저가 pushManager.subscribe()에 사용하는 VAPID 공개키를 반환한다."""
    if not settings.VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Web Push가 설정되지 않았습니다.")
    return {"publicKey": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=201)
def subscribe(
    body: PushSubscribeRequest,
    request: Request,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """브라우저 Push 구독 정보를 저장한다. 동일 endpoint는 upsert 처리."""
    existing = db.query(WebPushSubscription).filter_by(endpoint=body.endpoint).first()
    ua = request.headers.get("user-agent", "")[:500]
    if existing:
        # endpoint가 같으면 키 갱신 (브라우저가 구독을 갱신하는 경우)
        existing.username = user["username"]
        existing.p256dh = body.p256dh
        existing.auth = body.auth
        existing.user_agent = ua
    else:
        sub = WebPushSubscription(
            username=user["username"],
            endpoint=body.endpoint,
            p256dh=body.p256dh,
            auth=body.auth,
            user_agent=ua,
        )
        db.add(sub)
    db.commit()
    return {"status": "subscribed"}


@router.delete("/unsubscribe")
def unsubscribe(
    body: PushSubscribeRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """브라우저 Push 구독을 해제한다."""
    sub = (
        db.query(WebPushSubscription)
        .filter_by(endpoint=body.endpoint, username=user["username"])
        .first()
    )
    if sub:
        db.delete(sub)
        db.commit()
    return {"status": "unsubscribed"}


@router.get("/status")
def get_status(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 사용자의 구독 수를 반환한다 (설정 여부 포함)."""
    count = db.query(WebPushSubscription).filter_by(username=user["username"]).count()
    return {
        "enabled": bool(settings.VAPID_PUBLIC_KEY),
        "subscriptions": count,
    }


# ── 서버 → 클라이언트 발송 함수 (tasks.py 에서 호출) ────────────────────────

def send_push_to_user(username: str, title: str, body: str, url: str = "/") -> None:
    """해당 사용자의 모든 Push 구독 단말기에 메시지를 발송한다.

    pywebpush 가 설치되지 않았거나 VAPID 키가 없으면 조용히 스킵한다.
    """
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        return

    try:
        from pywebpush import webpush, WebPushException  # type: ignore
    except ImportError:
        logger.debug("pywebpush not installed — skipping Web Push")
        return

    subs = _get_subscriptions_for_user(username)
    payload = json.dumps({"title": title, "body": body, "url": url})

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_EMAIL},
            )
        except WebPushException as exc:
            # 410 Gone → 구독이 만료됨, DB에서 제거
            if exc.response is not None and exc.response.status_code == 410:
                logger.info("Web Push subscription expired for %s, removing.", username)
                _remove_subscription(sub.endpoint)
            else:
                logger.warning("Web Push failed for %s: %s", username, exc)
        except Exception as exc:
            logger.warning("Web Push error for %s: %s", username, exc)


def _get_subscriptions_for_user(username: str):
    from ..database import SessionLocal
    with SessionLocal() as db:
        return db.query(WebPushSubscription).filter_by(username=username).all()


def _remove_subscription(endpoint: str) -> None:
    from ..database import SessionLocal
    with SessionLocal() as db:
        sub = db.query(WebPushSubscription).filter_by(endpoint=endpoint).first()
        if sub:
            db.delete(sub)
            db.commit()
