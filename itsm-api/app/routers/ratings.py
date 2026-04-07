import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from ..auth import get_current_user
from ..database import get_db
from ..models import Rating
from ..schemas import RatingCreate, RatingUpdate, RatingResponse
from .. import gitlab_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ratings"])


def _get_my_rating(iid: int, username: str, db: Session) -> Optional[Rating]:
    return (
        db.query(Rating)
        .filter(Rating.gitlab_issue_iid == iid, Rating.username == username)
        .first()
    )


def _assert_ratable(iid: int):
    """처리완료(resolved) 또는 종료(closed) 상태인지 확인."""
    try:
        issue = gitlab_client.get_issue(iid)
        labels = issue.get("labels", [])
        is_resolved = "status::resolved" in labels
        if issue["state"] != "closed" and not is_resolved:
            raise HTTPException(status_code=400, detail="처리완료 또는 종료된 티켓만 평가할 수 있습니다.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("_assert_ratable(%d) error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 상태를 확인할 수 없습니다.")


@router.get("/tickets/{iid}/ratings/me", response_model=Optional[RatingResponse])
def get_my_rating(
    iid: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """현재 사용자의 해당 티켓 평가 조회."""
    return _get_my_rating(iid, user.get("username", ""), db)


@router.post("/tickets/{iid}/ratings", response_model=RatingResponse, status_code=201)
def create_rating(
    iid: int,
    data: RatingCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username", "")
    existing = _get_my_rating(iid, username, db)
    if existing:
        raise HTTPException(status_code=409, detail="이미 평가를 완료한 티켓입니다. 수정 API를 이용하세요.")

    _assert_ratable(iid)

    employee_name = user.get("name") or username
    employee_email = user.get("email") or data.employee_email

    rating = Rating(
        gitlab_issue_iid=iid,
        username=username,
        employee_name=employee_name,
        employee_email=employee_email,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)

    _post_gitlab_comment(iid, employee_name, data.score, data.comment, gitlab_token=user.get("gitlab_token"))
    if data.score <= 2:
        _notify_low_rating(iid, employee_name, data.score, data.comment, db)
    return rating


@router.put("/tickets/{iid}/ratings", response_model=RatingResponse)
def update_rating(
    iid: int,
    data: RatingUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username", "")
    existing = _get_my_rating(iid, username, db)
    if not existing:
        raise HTTPException(status_code=404, detail="평가 내역이 없습니다. 먼저 평가를 등록해주세요.")

    existing.score = data.score
    existing.comment = data.comment
    existing.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(existing)

    _post_gitlab_comment(iid, existing.employee_name, data.score, data.comment, updated=True, gitlab_token=user.get("gitlab_token"))
    if data.score <= 2:
        _notify_low_rating(iid, existing.employee_name, data.score, data.comment, db)
    return existing


@router.get("/tickets/{iid}/ratings", response_model=Optional[RatingResponse])
def get_rating(
    iid: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """하위 호환용 — 해당 티켓의 평가 반환. 에이전트/관리자는 전체, 일반 사용자는 본인 것만."""
    role = user.get("role", "user")
    if role in ("admin", "agent", "pl"):
        return db.query(Rating).filter(Rating.gitlab_issue_iid == iid).first()
    return _get_my_rating(iid, user.get("username", ""), db)


def _notify_low_rating(iid: int, employee_name: str, score: int, comment: Optional[str], db) -> None:
    """점수 ≤ 2인 낮은 평점 평가 시 담당 에이전트와 IT 팀에 알림 발송."""
    try:
        from ..notifications import create_db_notification, send_telegram
        from ..config import get_settings

        stars = "⭐" * score
        comment_part = f" — \"{comment}\"" if comment else ""
        title = f"낮은 만족도 평가: 티켓 #{iid} ({stars})"
        body = f"{employee_name}님이 {score}점을 평가했습니다.{comment_part}"

        # 담당 에이전트에게 in-app 알림
        try:
            issue = gitlab_client.get_issue(iid)
            assignees = issue.get("assignees", [])
            for assignee in assignees:
                assignee_id = str(assignee.get("id", ""))
                if assignee_id:
                    create_db_notification(
                        db=db,
                        recipient_id=assignee_id,
                        title=title,
                        body=body,
                        link=f"/tickets/{iid}",
                        dedup_key=f"low-rating-{iid}",
                        dedup_ttl=3600,
                    )
        except Exception as _e:
            logger.warning("low_rating notify assignee failed for #%d: %s", iid, _e)

        # Telegram 알림
        settings = get_settings()
        if settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID:
            send_telegram(
                f"⚠️ <b>낮은 만족도 평가</b>\n"
                f"#️⃣ 티켓 #{iid}\n"
                f"⭐ 점수: {score}/5점\n"
                f"👤 평가자: {employee_name}"
                + (f"\n💬 의견: {comment}" if comment else "")
            )
    except Exception as e:
        logger.warning("_notify_low_rating failed for #%d: %s", iid, e)


def _post_gitlab_comment(iid: int, name: str, score: int, comment: Optional[str], updated: bool = False, gitlab_token: Optional[str] = None):
    stars = "⭐" * score
    action = "수정" if updated else "완료"
    body = (
        f"### 만족도 평가 {action}\n\n"
        f"**점수:** {stars} ({score}/5점)\n"
        f"**평가자:** {name}\n"
    )
    if comment:
        body += f"**의견:** {comment}"
    try:
        gitlab_client.add_note(iid, body, gitlab_token=gitlab_token)
    except Exception as e:
        logger.warning("Failed to add rating comment to GitLab issue #%d: %s", iid, e)
