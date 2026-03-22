"""Admin announcements endpoints."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ...database import get_db
from ...models import Announcement as AnnouncementModel
from ...rbac import require_admin

announcements_router = APIRouter()


class AnnouncementCreate(BaseModel):
    title: str
    content: str
    type: str = "info"
    enabled: bool = True
    expires_at: Optional[datetime] = None


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    content: str
    type: str
    enabled: bool
    expires_at: Optional[datetime]
    created_by: str
    created_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


@announcements_router.get("/announcements", response_model=list[AnnouncementResponse])
def list_announcements(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 전체 목록 조회 (관리자)."""
    return db.query(AnnouncementModel).order_by(AnnouncementModel.created_at.desc()).all()


@announcements_router.post("/announcements", response_model=AnnouncementResponse, status_code=201)
def create_announcement(
    body: AnnouncementCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """공지사항 생성 (관리자)."""
    allowed_types = {"info", "warning", "critical"}
    if body.type not in allowed_types:
        raise HTTPException(400, f"type은 {allowed_types} 중 하나여야 합니다.")
    ann = AnnouncementModel(
        title=body.title,
        content=body.content,
        type=body.type,
        enabled=body.enabled,
        expires_at=body.expires_at,
        created_by=user.get("username", ""),
        created_at=datetime.now(timezone.utc),
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@announcements_router.put("/announcements/{ann_id}", response_model=AnnouncementResponse)
def update_announcement(
    ann_id: int,
    body: AnnouncementCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 수정 (관리자)."""
    ann = db.query(AnnouncementModel).filter(AnnouncementModel.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    ann.title = body.title
    ann.content = body.content
    ann.type = body.type
    ann.enabled = body.enabled
    ann.expires_at = body.expires_at
    db.commit()
    db.refresh(ann)
    return ann


@announcements_router.delete("/announcements/{ann_id}", status_code=204)
def delete_announcement(
    ann_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """공지사항 삭제 (관리자)."""
    ann = db.query(AnnouncementModel).filter(AnnouncementModel.id == ann_id).first()
    if not ann:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다.")
    db.delete(ann)
    db.commit()
