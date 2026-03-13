"""F-13: Saved filter presets."""
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import SavedFilter

router = APIRouter(prefix="/filters", tags=["filters"])


class FilterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    filters: dict[str, Any]


@router.get("/")
def list_saved_filters(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username", "")
    rows = db.query(SavedFilter).filter(SavedFilter.username == username).order_by(SavedFilter.created_at).all()
    return [_to_dict(r) for r in rows]


@router.post("/", status_code=201)
def create_saved_filter(
    data: FilterCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username", "")
    existing = db.query(SavedFilter).filter(
        SavedFilter.username == username,
        SavedFilter.name == data.name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"'{data.name}' 이름의 필터가 이미 존재합니다.")

    sf = SavedFilter(username=username, name=data.name, filters=data.filters)
    db.add(sf)
    db.commit()
    db.refresh(sf)
    return _to_dict(sf)


@router.delete("/{filter_id}", status_code=204)
def delete_saved_filter(
    filter_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username", "")
    sf = db.query(SavedFilter).filter(SavedFilter.id == filter_id, SavedFilter.username == username).first()
    if not sf:
        raise HTTPException(status_code=404, detail="필터를 찾을 수 없습니다.")
    db.delete(sf)
    db.commit()


def _to_dict(sf: SavedFilter) -> dict:
    return {
        "id": sf.id,
        "name": sf.name,
        "filters": sf.filters,
        "created_at": sf.created_at.isoformat() if sf.created_at else None,
    }
