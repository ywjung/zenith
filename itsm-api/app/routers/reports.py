"""Reports router: real-time stats, trends, ratings, and CSV export."""
import csv
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as dt_time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from .. import gitlab_client
from ..models import DailyStatsSnapshot, Rating, SLARecord, TimeEntry
from ..rbac import require_agent

router = APIRouter(prefix="/reports", tags=["reports"])
logger = logging.getLogger(__name__)


@router.get("/current-stats")
def get_current_stats(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """실시간 통계: GitLab에서 직접 조회. 날짜 범위가 지정되면 해당 기간의 신규/완료 건수를 반환."""
    from fastapi import HTTPException as _HTTPException
    if from_date and to_date and from_date > to_date:
        raise _HTTPException(status_code=400, detail="시작일이 종료일보다 늦을 수 없습니다.")

    # GitLab API 날짜 필터: ISO 형식 (날짜 경계를 명확히 하기 위해 datetime 문자열 사용)
    from_iso = datetime.combine(from_date, dt_time.min).isoformat() if from_date else None
    to_iso = datetime.combine(to_date, dt_time.max).isoformat() if to_date else None

    def _count_new():
        """기간 내 신규 생성된 티켓 수"""
        _, total = gitlab_client.get_issues(
            state="all",
            project_id=project_id,
            per_page=1, page=1,
            created_after=from_iso,
            created_before=to_iso,
        )
        return total

    def _count_open():
        """기간 내 생성된 티켓 중 현재 접수됨 상태"""
        _, total = gitlab_client.get_issues(
            state="opened",
            not_labels="status::in_progress,status::waiting,status::resolved",
            project_id=project_id,
            per_page=1, page=1,
            created_after=from_iso,
            created_before=to_iso,
        )
        return total

    def _count_in_progress():
        """기간 내 생성된 티켓 중 현재 처리 중"""
        _, total = gitlab_client.get_issues(
            state="opened",
            labels="status::in_progress",
            project_id=project_id,
            per_page=1, page=1,
            created_after=from_iso,
            created_before=to_iso,
        )
        return total

    def _count_resolved():
        """기간 내 생성된 티켓 중 현재 처리 완료"""
        _, total = gitlab_client.get_issues(
            state="opened",
            labels="status::resolved",
            project_id=project_id,
            per_page=1, page=1,
            created_after=from_iso,
            created_before=to_iso,
        )
        return total

    def _count_closed():
        """기간 내 종료된 티켓 수 (updated_after 근사치)"""
        _, total = gitlab_client.get_issues(
            state="closed",
            project_id=project_id,
            per_page=1, page=1,
            updated_after=from_iso,
            updated_before=to_iso,
        )
        return total

    def _count_sla_breached():
        """기간 내 SLA 위반 건수"""
        q = db.query(SLARecord).filter(SLARecord.breached == True)  # noqa: E712
        if from_date:
            q = q.filter(SLARecord.sla_deadline >= datetime.combine(from_date, dt_time.min))
        if to_date:
            q = q.filter(SLARecord.sla_deadline <= datetime.combine(to_date, dt_time.max))
        if project_id:
            q = q.filter(SLARecord.project_id == project_id)
        return q.count()

    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            f_new         = pool.submit(_count_new)
            f_open        = pool.submit(_count_open)
            f_in_progress = pool.submit(_count_in_progress)
            f_resolved    = pool.submit(_count_resolved)
            f_closed      = pool.submit(_count_closed)
            f_breached    = pool.submit(_count_sla_breached)

            return {
                "new":         f_new.result(),
                "open":        f_open.result(),
                "in_progress": f_in_progress.result(),
                "resolved":    f_resolved.result(),
                "closed":      f_closed.result(),
                "sla_breached":f_breached.result(),
                "fetched_at":  datetime.utcnow().isoformat() + "Z",
            }
    except Exception as e:
        logger.error("current-stats GitLab error: %s", e)
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="통계를 불러오는 중 오류가 발생했습니다.")


@router.get("/trends")
def get_trends(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """날짜별 티켓 스냅샷 추이 (자정마다 기록된 일별 통계)."""
    q = db.query(DailyStatsSnapshot).order_by(DailyStatsSnapshot.snapshot_date)
    if from_date:
        q = q.filter(DailyStatsSnapshot.snapshot_date >= from_date)
    if to_date:
        q = q.filter(DailyStatsSnapshot.snapshot_date <= to_date)
    if project_id:
        q = q.filter(DailyStatsSnapshot.project_id == project_id)

    rows = q.all()
    return [
        {
            "snapshot_date":      str(r.snapshot_date),
            "project_id":         r.project_id,
            "total_open":         r.total_open,
            "total_in_progress":  r.total_in_progress,
            "total_closed":       r.total_closed,
            "total_new":          r.total_new,
            "total_breached":     r.total_breached,
        }
        for r in rows
    ]


@router.get("/export")
def export_report(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    project_id: Optional[str] = None,
    format: str = Query(default="csv"),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    q = db.query(DailyStatsSnapshot).order_by(DailyStatsSnapshot.snapshot_date)
    if from_date:
        q = q.filter(DailyStatsSnapshot.snapshot_date >= from_date)
    if to_date:
        q = q.filter(DailyStatsSnapshot.snapshot_date <= to_date)
    if project_id:
        q = q.filter(DailyStatsSnapshot.project_id == project_id)

    rows = q.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["날짜", "프로젝트", "당일신규", "접수됨", "처리중(대기·완료포함)", "누적종료", "SLA위반누적"])
    for r in rows:
        writer.writerow([
            str(r.snapshot_date),
            r.project_id,
            r.total_new,
            r.total_open,
            r.total_in_progress,
            r.total_closed,
            r.total_breached,
        ])

    filename = f"itsm_report_{datetime.now().strftime('%Y%m%d')}.csv"
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/breakdown")
def get_breakdown(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """기간 내 티켓을 상태별·카테고리별·우선순위별로 집계."""
    from fastapi import HTTPException as _HTTPException
    if from_date and to_date and from_date > to_date:
        raise _HTTPException(status_code=400, detail="시작일이 종료일보다 늦을 수 없습니다.")
    from_iso = datetime.combine(from_date, dt_time.min).isoformat() if from_date else None
    to_iso = datetime.combine(to_date, dt_time.max).isoformat() if to_date else None

    all_issues: list[dict] = []
    page = 1
    while True:
        issues, total = gitlab_client.get_issues(
            state="all", per_page=100, page=page,
            project_id=project_id,
            created_after=from_iso, created_before=to_iso,
        )
        all_issues.extend(issues)
        if len(all_issues) >= total or not issues:
            break
        page += 1

    by_status: dict[str, int] = {"open": 0, "in_progress": 0, "resolved": 0, "closed": 0}
    by_category: dict[str, int] = {}
    by_priority: dict[str, int] = {}

    for issue in all_issues:
        labels = issue.get("labels", [])
        state = issue.get("state", "")

        if state == "closed":
            by_status["closed"] += 1
        else:
            status_lbl = next((l[8:] for l in labels if l.startswith("status::")), None)
            if status_lbl in ("in_progress", "waiting"):
                by_status["in_progress"] += 1
            elif status_lbl == "resolved":
                by_status["resolved"] += 1
            else:
                by_status["open"] += 1

        cat = next((l[5:] for l in labels if l.startswith("cat::")), "기타")
        # 영문 카테고리 키를 한국어로 정규화 (영문/한국어 혼재 방지)
        _CAT_KO = {"hardware": "하드웨어", "software": "소프트웨어",
                   "network": "네트워크", "account": "계정/권한", "other": "기타"}
        cat = _CAT_KO.get(cat, cat)
        by_category[cat] = by_category.get(cat, 0) + 1

        prio = next((l[6:] for l in labels if l.startswith("prio::")), "medium")
        # corrupt 라벨 정규화: PriorityEnum.MEDIUM → medium
        if "." in prio and prio[0].isupper():
            prio = prio.split(".")[-1].lower()
        by_priority[prio] = by_priority.get(prio, 0) + 1

    return {
        "total": len(all_issues),
        "by_status": by_status,
        "by_category": by_category,
        "by_priority": by_priority,
    }


@router.get("/ratings")
def get_rating_stats(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """만족도 평가 통계: 평균, 분포, 최근 평가 목록."""
    q = db.query(Rating).order_by(Rating.created_at.desc())
    if from_date:
        q = q.filter(Rating.created_at >= datetime.combine(from_date, dt_time.min))
    if to_date:
        q = q.filter(Rating.created_at <= datetime.combine(to_date, dt_time.max))
    ratings = q.all()
    total = len(ratings)

    if total == 0:
        return {
            "total": 0,
            "average": None,
            "distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
            "recent": [],
        }

    average = round(sum(r.score for r in ratings) / total, 2)
    distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for r in ratings:
        distribution[r.score] = distribution.get(r.score, 0) + 1

    recent = [
        {
            "id": r.id,
            "gitlab_issue_iid": r.gitlab_issue_iid,
            "employee_name": r.employee_name,
            "score": r.score,
            "comment": r.comment,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in ratings[:20]
    ]

    return {
        "total": total,
        "average": average,
        "distribution": distribution,
        "recent": recent,
    }


@router.get("/agent-performance")
def get_agent_performance(
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """F-7: Per-agent performance stats: assigned, resolved, avg_rating, sla_met_rate."""
    from_dt = datetime.combine(from_date, dt_time.min) if from_date else None
    to_dt = datetime.combine(to_date, dt_time.max) if to_date else None

    # Gather all issues from GitLab with assignees
    all_issues: list[dict] = []
    try:
        page = 1
        from_iso = from_dt.isoformat() if from_dt else None
        to_iso = to_dt.isoformat() if to_dt else None
        while True:
            issues, total = gitlab_client.get_issues(
                state="all", per_page=100, page=page,
                project_id=project_id,
                created_after=from_iso,
                created_before=to_iso,
            )
            all_issues.extend(issues)
            if len(all_issues) >= total or not issues:
                break
            page += 1
    except Exception as e:
        logger.error("agent-performance GitLab error: %s", e)

    # Aggregate by assignee
    agents: dict[str, dict] = {}
    for issue in all_issues:
        assignees = issue.get("assignees", [])
        if not assignees:
            continue
        assignee = assignees[0]
        agent_name = assignee.get("name", assignee.get("username", "unknown"))
        agent_username = assignee.get("username", "unknown")
        key = agent_username
        if key not in agents:
            agents[key] = {
                "agent_name": agent_name,
                "agent_username": agent_username,
                "assigned": 0,
                "resolved": 0,
                "sla_met": 0,
                "sla_total": 0,
            }
        agents[key]["assigned"] += 1
        if issue.get("state") == "closed":
            agents[key]["resolved"] += 1

    # SLA met rate from DB
    sla_q = db.query(SLARecord)
    if project_id:
        sla_q = sla_q.filter(SLARecord.project_id == project_id)
    if from_dt:
        sla_q = sla_q.filter(SLARecord.created_at >= from_dt)
    if to_dt:
        sla_q = sla_q.filter(SLARecord.created_at <= to_dt)
    sla_records = sla_q.all()

    sla_iid_map = {r.gitlab_issue_iid: r for r in sla_records}
    for issue in all_issues:
        iid = issue.get("iid")
        assignees = issue.get("assignees", [])
        if not assignees or iid not in sla_iid_map:
            continue
        key = assignees[0].get("username", "unknown")
        if key not in agents:
            continue
        agents[key]["sla_total"] += 1
        if not sla_iid_map[iid].breached:
            agents[key]["sla_met"] += 1

    # Ratings per issue → map to assignee
    rating_q = db.query(Rating)
    if from_dt:
        rating_q = rating_q.filter(Rating.created_at >= from_dt)
    if to_dt:
        rating_q = rating_q.filter(Rating.created_at <= to_dt)
    ratings = rating_q.all()
    rating_map: dict[int, list[int]] = {}
    for r in ratings:
        rating_map.setdefault(r.gitlab_issue_iid, []).append(r.score)

    iid_to_agent: dict[int, str] = {}
    for issue in all_issues:
        assignees = issue.get("assignees", [])
        if assignees:
            iid_to_agent[issue["iid"]] = assignees[0].get("username", "unknown")

    for iid, scores in rating_map.items():
        key = iid_to_agent.get(iid)
        if key and key in agents:
            agents[key].setdefault("_scores", []).extend(scores)

    result = []
    for data in agents.values():
        scores = data.pop("_scores", [])
        avg_rating = round(sum(scores) / len(scores), 2) if scores else None
        sla_met_rate = (
            round(data["sla_met"] / data["sla_total"] * 100, 1)
            if data["sla_total"] > 0 else None
        )
        result.append({
            "agent_name": data["agent_name"],
            "agent_username": data["agent_username"],
            "assigned": data["assigned"],
            "resolved": data["resolved"],
            "avg_rating": avg_rating,
            "sla_met_rate": sla_met_rate,
        })

    result.sort(key=lambda x: x["assigned"], reverse=True)
    return result


def take_snapshot(project_id: str, db) -> dict:
    """스냅샷 생성 내부 함수 — HTTP 컨텍스트 없이 호출 가능."""
    today = date.today()
    today_start = datetime.combine(today, dt_time.min).isoformat()
    today_end = datetime.combine(today, dt_time.max).isoformat()

    existing = db.query(DailyStatsSnapshot).filter(
        DailyStatsSnapshot.snapshot_date == today,
        DailyStatsSnapshot.project_id == project_id,
    ).first()
    if existing:
        return {"message": "already_exists", "date": str(today)}

    try:
        def _get(state, labels=None, not_labels=None, created_after=None, created_before=None):
            _, total = gitlab_client.get_issues(
                state=state, labels=labels, not_labels=not_labels,
                per_page=1, page=1, project_id=project_id,
                created_after=created_after, created_before=created_before,
            )
            return total

        with ThreadPoolExecutor(max_workers=7) as pool:
            f_open     = pool.submit(_get, "opened", None, "status::in_progress,status::waiting,status::resolved")
            f_closed   = pool.submit(_get, "closed")
            f_ip       = pool.submit(_get, "opened", "status::in_progress")
            f_waiting  = pool.submit(_get, "opened", "status::waiting")
            f_resolved = pool.submit(_get, "opened", "status::resolved")
            f_new      = pool.submit(_get, "all", None, None, today_start, today_end)
            f_breached = pool.submit(
                lambda: db.query(SLARecord).filter(
                    SLARecord.project_id == project_id,
                    SLARecord.breached == True,  # noqa: E712
                ).count()
            )
            total_open        = f_open.result()
            total_closed      = f_closed.result()
            total_in_progress = f_ip.result() + f_waiting.result() + f_resolved.result()
            total_new         = f_new.result()
            total_breached    = f_breached.result()
    except Exception as e:
        logger.error("Snapshot fetch error for project %s: %s", project_id, e)
        total_open = total_closed = total_in_progress = total_new = total_breached = 0

    snapshot = DailyStatsSnapshot(
        snapshot_date=today,
        project_id=project_id,
        total_open=total_open,
        total_in_progress=total_in_progress,
        total_closed=total_closed,
        total_new=total_new,
        total_breached=total_breached,
    )
    db.add(snapshot)
    db.commit()
    return {"message": "created", "date": str(today)}


@router.post("/snapshots", status_code=201)
def create_daily_snapshot(
    project_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """Manually trigger a daily stats snapshot for a project."""
    result = take_snapshot(project_id, db)
    if result["message"] == "already_exists":
        return {"message": "오늘 스냅샷이 이미 있습니다.", "date": result["date"]}
    return {"message": "스냅샷이 생성됐습니다.", "date": result["date"]}
