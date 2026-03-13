"""Quick Reply (canned response) templates for agents."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import QuickReply
from ..rbac import require_agent

router = APIRouter(prefix="/quick-replies", tags=["quick-replies"])


class QuickReplyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=5000)
    category: Optional[str] = Field(default=None, max_length=100)


@router.get("")
def list_quick_replies(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    query = db.query(QuickReply)
    if category:
        query = query.filter(QuickReply.category == category)
    items = query.order_by(QuickReply.name).all()
    return [_to_dict(r) for r in items]


@router.post("", status_code=201)
def create_quick_reply(
    data: QuickReplyCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    qr = QuickReply(
        name=data.name,
        content=data.content,
        category=data.category,
        created_by=str(user.get("sub", "")),
    )
    db.add(qr)
    db.commit()
    db.refresh(qr)
    return _to_dict(qr)


@router.put("/{reply_id}")
def update_quick_reply(
    reply_id: int,
    data: QuickReplyCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    qr = db.query(QuickReply).filter(QuickReply.id == reply_id).first()
    if not qr:
        raise HTTPException(status_code=404, detail="빠른 답변을 찾을 수 없습니다.")
    qr.name = data.name
    qr.content = data.content
    qr.category = data.category
    db.commit()
    return _to_dict(qr)


@router.delete("/{reply_id}", status_code=204)
def delete_quick_reply(
    reply_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    qr = db.query(QuickReply).filter(QuickReply.id == reply_id).first()
    if not qr:
        raise HTTPException(status_code=404, detail="빠른 답변을 찾을 수 없습니다.")
    db.delete(qr)
    db.commit()


def _to_dict(qr: QuickReply) -> dict:
    return {
        "id": qr.id,
        "name": qr.name,
        "content": qr.content,
        "category": qr.category,
        "created_by": qr.created_by,
        "created_at": qr.created_at.isoformat() if qr.created_at else None,
    }
