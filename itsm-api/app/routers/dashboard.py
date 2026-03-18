"""사용자별 대시보드 위젯 설정."""
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db
from ..models import UserDashboardConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_WIDGETS = [
    {"id": "stats_bar",       "visible": True,  "order": 0},
    {"id": "my_tickets",      "visible": True,  "order": 1},
    {"id": "sla_status",      "visible": True,  "order": 2},
    {"id": "recent_activity", "visible": False, "order": 3},
]


class DashboardConfigUpdate(BaseModel):
    widgets: list = []


@router.get("/config", response_model=dict)
def get_dashboard_config(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = db.query(UserDashboardConfig).filter_by(username=user["username"]).first()
    widgets = config.widgets if config and config.widgets else DEFAULT_WIDGETS
    return {"username": user["username"], "widgets": widgets}


@router.put("/config", response_model=dict)
def update_dashboard_config(
    data: DashboardConfigUpdate,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = db.query(UserDashboardConfig).filter_by(username=user["username"]).with_for_update().first()
    if config:
        config.widgets = list(data.widgets)[:20]  # 최대 20개 위젯
        flag_modified(config, "widgets")
    else:
        config = UserDashboardConfig(username=user["username"], widgets=list(data.widgets)[:20])
        db.add(config)
    db.commit()
    db.refresh(config)
    return {"username": user["username"], "widgets": config.widgets}
