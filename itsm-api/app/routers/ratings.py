from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from ..auth import get_current_user
from ..database import get_db
from ..models import Rating
from ..schemas import RatingCreate, RatingResponse
from .. import gitlab_client

router = APIRouter(tags=["ratings"])


@router.post("/tickets/{iid}/ratings", response_model=RatingResponse, status_code=201)
def create_rating(iid: int, data: RatingCreate, db: Session = Depends(get_db), _user: dict = Depends(get_current_user)):
    existing = db.query(Rating).filter(Rating.gitlab_issue_iid == iid).first()
    if existing:
        raise HTTPException(status_code=409, detail="이미 평가가 완료된 티켓입니다.")

    # 티켓이 닫혀 있는지 확인
    try:
        issue = gitlab_client.get_issue(iid)
        if issue["state"] != "closed":
            raise HTTPException(status_code=400, detail="완료된 티켓만 평가할 수 있습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")

    rating = Rating(
        gitlab_issue_iid=iid,
        employee_name=data.employee_name,
        employee_email=data.employee_email,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)

    # GitLab 이슈에 평가 결과 코멘트 추가
    stars = "⭐" * data.score
    comment_body = (
        f"### 만족도 평가 완료\n\n"
        f"**점수:** {stars} ({data.score}/5점)\n"
        f"**평가자:** {data.employee_name}\n"
    )
    if data.comment:
        comment_body += f"**의견:** {data.comment}"
    try:
        gitlab_client.add_note(iid, comment_body)
    except Exception:
        pass  # 코멘트 실패해도 평가 저장은 유지

    return rating


@router.get("/tickets/{iid}/ratings", response_model=Optional[RatingResponse])
def get_rating(iid: int, db: Session = Depends(get_db)):
    return db.query(Rating).filter(Rating.gitlab_issue_iid == iid).first()
