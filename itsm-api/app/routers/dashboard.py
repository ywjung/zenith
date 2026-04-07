"""사용자별 대시보드 위젯 설정."""
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import get_current_user
from ..database import get_db
from ..models import UserDashboardConfig

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_WIDGETS = [
    {"id": "my_tickets",         "visible": True,  "order": 0},
    {"id": "sla_status",         "visible": True,  "order": 1},
    {"id": "recent_kb",          "visible": True,  "order": 2},
    {"id": "ticket_stats",       "visible": True,  "order": 3},
    {"id": "notifications",      "visible": True,  "order": 4},
    {"id": "quick_actions",      "visible": True,  "order": 5},
    {"id": "sla_breached",       "visible": False, "order": 6},
    {"id": "unassigned_tickets", "visible": False, "order": 7},
    {"id": "team_workload",      "visible": False, "order": 8},
]


class DashboardConfigUpdate(BaseModel):
    widgets: list = []


@router.get("/config", response_model=dict)
def get_dashboard_config(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    config = db.query(UserDashboardConfig).filter_by(username=user["username"]).first()
    valid_ids = {w["id"] for w in DEFAULT_WIDGETS}
    if config and config.widgets:
        stored_ids = {w.get("id") for w in config.widgets}
        if not stored_ids.issubset(valid_ids):
            # 알 수 없는 구버전 위젯 ID → 기본값으로 초기화
            widgets = DEFAULT_WIDGETS
        else:
            # 새로 추가된 위젯 ID가 있으면 default로 병합
            stored = {w["id"]: w for w in config.widgets}
            widgets = list(config.widgets)
            max_order = max((w.get("order", 0) for w in widgets), default=0)
            for default_w in DEFAULT_WIDGETS:
                if default_w["id"] not in stored:
                    max_order += 1
                    widgets.append({**default_w, "order": max_order})
    else:
        widgets = DEFAULT_WIDGETS
    return {"username": user["username"], "widgets": widgets}


@router.put("/config", response_model=dict)
def update_dashboard_config(
    data: DashboardConfigUpdate,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 허용된 위젯 ID·속성만 통과 (임의 속성 주입 방지)
    valid_ids = {w["id"] for w in DEFAULT_WIDGETS}
    sanitized: list[dict] = []
    for w in data.widgets[:20]:
        wid = w.get("id") if isinstance(w, dict) else None
        if wid not in valid_ids:
            continue
        sanitized.append({
            "id": wid,
            "visible": bool(w.get("visible", True)),
            "order": int(w.get("order", 0)),
        })

    config = db.query(UserDashboardConfig).filter_by(username=user["username"]).with_for_update().first()
    if config:
        config.widgets = sanitized
        flag_modified(config, "widgets")
    else:
        config = UserDashboardConfig(username=user["username"], widgets=sanitized)
        db.add(config)
    db.commit()
    db.refresh(config)
    return {"username": user["username"], "widgets": config.widgets}


@router.get("/widgets/extra-stats", response_model=dict)
def get_widget_extra_stats(
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """신규 위젯용 추가 통계: SLA 위반 목록, 미배정 티켓 수, 팀별 워크로드."""
    try:
        # SLA 위반 전체 건수 (LIMIT 없이 집계)
        sla_breached_total: int = db.execute(text(
            "SELECT COUNT(*) FROM sla_records WHERE breached=true AND resolved_at IS NULL"
        )).scalar() or 0
        # 화면 표시용 상위 10개 목록
        breached_rows = db.execute(text(
            "SELECT gitlab_issue_iid, sla_deadline FROM sla_records "
            "WHERE breached=true AND resolved_at IS NULL "
            "ORDER BY sla_deadline ASC LIMIT 10"
        )).all()
        sla_breached = [
            {"iid": r[0], "sla_deadline": r[1].isoformat() if r[1] else None}
            for r in breached_rows
        ]
    except Exception:
        sla_breached = []
        sla_breached_total = 0

    try:
        workload_rows = db.execute(text(
            "SELECT assignee_username, COUNT(*) as cnt "
            "FROM ticket_type_meta "
            "WHERE assignee_username IS NOT NULL AND assignee_username != '' "
            "GROUP BY assignee_username ORDER BY cnt DESC LIMIT 10"
        )).all()
        team_workload = [{"username": r[0], "count": r[1]} for r in workload_rows]
    except Exception:
        team_workload = []

    return {
        "sla_breached": sla_breached,
        "sla_breached_count": sla_breached_total,
        "team_workload": team_workload,
    }
