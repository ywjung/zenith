"""Ticket templates router."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import TicketTemplate, TicketLink, TimeEntry
from ..rbac import require_developer, require_agent, require_admin

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateCreate(BaseModel):
    name: str
    category: Optional[str] = None
    description: str
    enabled: bool = True


class TemplatePatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/")
def list_templates(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    templates = db.query(TicketTemplate).filter(TicketTemplate.enabled == True).all()  # noqa: E712
    return [_tmpl_to_dict(t) for t in templates]


@router.get("/{template_id}")
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    t = db.query(TicketTemplate).filter(TicketTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="템플릿을 찾을 수 없습니다.")
    return _tmpl_to_dict(t)


@router.post("/", status_code=201)
def create_template(
    data: TemplateCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    t = TicketTemplate(
        name=data.name,
        category=data.category,
        description=data.description,
        enabled=data.enabled,
        created_by=str(user.get("sub", "")),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tmpl_to_dict(t)


@router.put("/{template_id}")
def update_template(
    template_id: int,
    data: TemplateCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    t = db.query(TicketTemplate).filter(TicketTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="템플릿을 찾을 수 없습니다.")
    t.name = data.name
    t.category = data.category
    t.description = data.description
    t.enabled = data.enabled
    db.commit()
    db.refresh(t)
    return _tmpl_to_dict(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    t = db.query(TicketTemplate).filter(TicketTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="템플릿을 찾을 수 없습니다.")
    db.delete(t)
    db.commit()


def _tmpl_to_dict(t: TicketTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "category": t.category,
        "description": t.description,
        "enabled": t.enabled,
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ---------------------------------------------------------------------------
# Ticket Links
# ---------------------------------------------------------------------------

link_router = APIRouter(prefix="/tickets", tags=["ticket-links"])


class LinkCreate(BaseModel):
    target_iid: int
    project_id: str
    link_type: str  # related|blocks|duplicate_of


@link_router.get("/{iid}/links")
def get_ticket_links(
    iid: int,
    project_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    links = db.query(TicketLink).filter(
        TicketLink.source_iid == iid,
        TicketLink.project_id == project_id,
    ).all()
    return [_link_to_dict(lk) for lk in links]


@link_router.post("/{iid}/links", status_code=201)
def create_ticket_link(
    iid: int,
    data: LinkCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_developer),
):
    allowed_types = {"related", "blocks", "duplicate_of"}
    if data.link_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"허용된 링크 유형: {', '.join(allowed_types)}")

    lk = TicketLink(
        source_iid=iid,
        target_iid=data.target_iid,
        project_id=data.project_id,
        link_type=data.link_type,
        created_by=str(user.get("sub", "")),
    )
    db.add(lk)
    db.commit()
    db.refresh(lk)
    return _link_to_dict(lk)


@link_router.delete("/{iid}/links/{link_id}", status_code=204)
def delete_ticket_link(
    iid: int,
    link_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_developer),
):
    lk = db.query(TicketLink).filter(TicketLink.id == link_id, TicketLink.source_iid == iid).first()
    if not lk:
        raise HTTPException(status_code=404, detail="링크를 찾을 수 없습니다.")
    db.delete(lk)
    db.commit()


def _link_to_dict(lk: TicketLink) -> dict:
    return {
        "id": lk.id,
        "source_iid": lk.source_iid,
        "target_iid": lk.target_iid,
        "project_id": lk.project_id,
        "link_type": lk.link_type,
        "created_by": lk.created_by,
        "created_at": lk.created_at.isoformat() if lk.created_at else None,
    }


# ---------------------------------------------------------------------------
# Time Tracking
# ---------------------------------------------------------------------------

time_router = APIRouter(prefix="/tickets", tags=["time-tracking"])


class TimeEntryCreate(BaseModel):
    minutes: int = Field(..., ge=1, le=10080, description="작업 시간(분), 최대 1주일(10080분)")
    description: Optional[str] = Field(default=None, max_length=1000)


@time_router.get("/{iid}/time")
def get_time_entries(
    iid: int,
    project_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_developer),
):
    entries = db.query(TimeEntry).filter(
        TimeEntry.issue_iid == iid,
        TimeEntry.project_id == project_id,
    ).order_by(TimeEntry.logged_at.desc()).all()
    total = sum(e.minutes for e in entries)
    return {
        "total_minutes": total,
        "entries": [_time_to_dict(e) for e in entries],
    }


@time_router.post("/{iid}/time", status_code=201)
def log_time(
    iid: int,
    project_id: str,
    data: TimeEntryCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_developer),
):
    entry = TimeEntry(
        issue_iid=iid,
        project_id=project_id,
        agent_id=str(user.get("sub", "")),
        agent_name=user.get("name", user.get("username", "")),
        minutes=data.minutes,
        description=data.description,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _time_to_dict(entry)


def _time_to_dict(e: TimeEntry) -> dict:
    return {
        "id": e.id,
        "issue_iid": e.issue_iid,
        "project_id": e.project_id,
        "agent_id": e.agent_id,
        "agent_name": e.agent_name,
        "minutes": e.minutes,
        "description": e.description,
        "logged_at": e.logged_at.isoformat() if e.logged_at else None,
    }
