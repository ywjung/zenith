"""IP 접근 허용 목록 관리 API."""
import ipaddress
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import IpAllowlistEntry
from ..rbac import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/ip-allowlist", tags=["ip-allowlist"])


class EntryCreate(BaseModel):
    cidr: str
    label: Optional[str] = None
    is_active: bool = True

    @field_validator("cidr")
    @classmethod
    def validate_cidr(cls, v: str) -> str:
        v = v.strip()
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError(f"올바른 CIDR 형식이 아닙니다: {v}")
        return v


class EntryUpdate(BaseModel):
    label: Optional[str] = None
    is_active: Optional[bool] = None


def _serialize(e: IpAllowlistEntry) -> dict:
    return {
        "id": e.id,
        "cidr": e.cidr,
        "label": e.label,
        "is_active": e.is_active,
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@router.get("/my-ip")
def get_my_ip(
    request: Request,
    _user: dict = Depends(require_admin),
):
    """요청자의 실제 IP 반환 (관리자 전용).

    신뢰 프록시(사설 IP)에서 온 요청만 X-Forwarded-For를 신뢰한다.
    직접 요청이거나 공개 IP 프록시이면 client.host를 사용한다.
    """
    client_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded and client_ip != "unknown":
        try:
            proxy_addr = ipaddress.ip_address(client_ip)
            if proxy_addr.is_private:
                ip = forwarded.split(",")[0].strip()
            else:
                ip = client_ip
        except ValueError:
            ip = client_ip
    else:
        ip = client_ip
    return {"ip": ip}


@router.get("", response_model=list)
def list_entries(
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    return [_serialize(e) for e in db.query(IpAllowlistEntry).order_by(IpAllowlistEntry.id).all()]


@router.post("", response_model=dict, status_code=201)
def create_entry(
    data: EntryCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    if db.query(IpAllowlistEntry).filter_by(cidr=data.cidr).first():
        raise HTTPException(status_code=409, detail="이미 등록된 CIDR입니다.")
    entry = IpAllowlistEntry(
        cidr=data.cidr,
        label=data.label,
        is_active=data.is_active,
        created_by=user["username"],
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    logger.info("IP allowlist: added %s by %s", data.cidr, user["username"])
    return _serialize(entry)


@router.patch("/{entry_id}", response_model=dict)
def update_entry(
    entry_id: int,
    data: EntryUpdate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    entry = db.query(IpAllowlistEntry).filter_by(id=entry_id).with_for_update().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.commit()
    db.refresh(entry)
    return _serialize(entry)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    entry = db.query(IpAllowlistEntry).filter_by(id=entry_id).with_for_update().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(entry)
    db.commit()
    logger.info("IP allowlist: removed %s by %s", entry.cidr, user["username"])
