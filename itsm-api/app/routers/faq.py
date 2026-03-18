"""FAQ(자주 묻는 질문) 관리 라우터."""
import logging
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import FaqItem
from ..rbac import require_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/faq", tags=["faq"])


def _to_dict(item: FaqItem) -> dict:
    return {
        "id": item.id,
        "question": item.question,
        "answer": item.answer,
        "category": item.category,
        "order_num": item.order_num,
        "is_active": item.is_active,
        "created_by": item.created_by,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


class FaqCreate(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    answer: str = Field(..., min_length=1, max_length=20000)
    category: Optional[str] = Field(default=None, max_length=50)
    order_num: int = Field(default=0, ge=0)
    is_active: bool = True


class FaqUpdate(BaseModel):
    question: Optional[str] = Field(default=None, min_length=1, max_length=500)
    answer: Optional[str] = Field(default=None, min_length=1, max_length=20000)
    category: Optional[str] = Field(default=None, max_length=50)
    order_num: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class FaqBulkCreate(BaseModel):
    items: List[FaqCreate]


@router.get("")
def list_faq(
    category: Optional[str] = None,
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """FAQ 목록 조회. active_only=false는 agent 이상만 허용."""
    role = current_user.get("role", "user")
    is_agent = role in ("agent", "admin", "pl")

    q = db.query(FaqItem)
    if active_only or not is_agent:
        q = q.filter(FaqItem.is_active == True)
    if category:
        q = q.filter(FaqItem.category == category)

    items = q.order_by(FaqItem.order_num.asc(), FaqItem.id.asc()).all()
    return [_to_dict(i) for i in items]


@router.post("", status_code=201)
def create_faq(
    body: FaqCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    item = FaqItem(
        question=body.question,
        answer=body.answer,
        category=body.category,
        order_num=body.order_num,
        is_active=body.is_active,
        created_by=current_user.get("username", ""),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.post("/bulk", status_code=201)
def bulk_create_faq(
    body: FaqBulkCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    """기존 정적 데이터를 일괄 가져올 때 사용."""
    # 기존 데이터가 있으면 중복 방지
    existing_qs = {r.question for r in db.query(FaqItem.question).all()}
    created = []
    for i, b in enumerate(body.items):
        if b.question in existing_qs:
            continue
        item = FaqItem(
            question=b.question,
            answer=b.answer,
            category=b.category,
            order_num=b.order_num if b.order_num else i,
            is_active=b.is_active,
            created_by=current_user.get("username", ""),
        )
        db.add(item)
        created.append(item)
    db.commit()
    for item in created:
        db.refresh(item)
    return {"created": len(created), "skipped": len(body.items) - len(created)}


@router.get("/{faq_id}")
def get_faq(
    faq_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    item = db.query(FaqItem).filter(FaqItem.id == faq_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")
    role = current_user.get("role", "user")
    if not item.is_active and role not in ("agent", "admin", "pl"):
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")
    return _to_dict(item)


@router.put("/{faq_id}")
def update_faq(
    faq_id: int,
    body: FaqUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    item = db.query(FaqItem).filter(FaqItem.id == faq_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")

    if body.question is not None:
        item.question = body.question
    if body.answer is not None:
        item.answer = body.answer
    if body.category is not None:
        item.category = body.category
    if body.order_num is not None:
        item.order_num = body.order_num
    if body.is_active is not None:
        item.is_active = body.is_active
    item.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(item)
    return _to_dict(item)


@router.delete("/{faq_id}", status_code=204)
def delete_faq(
    faq_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_agent),
):
    item = db.query(FaqItem).filter(FaqItem.id == faq_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="FAQ 항목을 찾을 수 없습니다.")
    db.delete(item)
    db.commit()
