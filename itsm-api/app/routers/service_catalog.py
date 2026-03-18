"""서비스 카탈로그 — 관리자 CRUD + 포털 공개 목록."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db
from ..models import ServiceCatalogItem
from ..rbac import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/service-catalog", tags=["service-catalog"])


class CatalogItemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    fields_schema: list = []
    is_active: bool = True
    order: int = 0


class CatalogItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    fields_schema: Optional[list] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None


def _serialize(item: ServiceCatalogItem) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "category": item.category,
        "icon": item.icon,
        "fields_schema": item.fields_schema or [],
        "is_active": item.is_active,
        "order": item.order,
        "created_by": item.created_by,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


# ---------------------------------------------------------------------------
# 공개 엔드포인트 (포털용 — 인증 불필요)
# ---------------------------------------------------------------------------

@router.get("/public", response_model=list)
def list_catalog_public(db: Session = Depends(get_db)):
    """활성화된 카탈로그 항목 목록 (포털 공개용)."""
    items = (
        db.query(ServiceCatalogItem)
        .filter_by(is_active=True)
        .order_by(ServiceCatalogItem.order, ServiceCatalogItem.id)
        .all()
    )
    return [_serialize(i) for i in items]


# ---------------------------------------------------------------------------
# 인증 필요 엔드포인트
# ---------------------------------------------------------------------------

@router.get("", response_model=list)
def list_catalog(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = (
        db.query(ServiceCatalogItem)
        .order_by(ServiceCatalogItem.order, ServiceCatalogItem.id)
        .all()
    )
    return [_serialize(i) for i in items]


@router.post("", response_model=dict, status_code=201)
def create_catalog_item(
    data: CatalogItemCreate,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = ServiceCatalogItem(
        name=data.name,
        description=data.description,
        category=data.category,
        icon=data.icon,
        fields_schema=data.fields_schema,
        is_active=data.is_active,
        order=data.order,
        created_by=user["username"],
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.patch("/{item_id}", response_model=dict)
def update_catalog_item(
    item_id: int,
    data: CatalogItemUpdate,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = db.query(ServiceCatalogItem).filter_by(id=item_id).with_for_update().first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
        if field == "fields_schema":
            flag_modified(item, "fields_schema")
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.delete("/{item_id}", status_code=204)
def delete_catalog_item(
    item_id: int,
    user: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    item = db.query(ServiceCatalogItem).filter_by(id=item_id).with_for_update().first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(item)
    db.commit()
