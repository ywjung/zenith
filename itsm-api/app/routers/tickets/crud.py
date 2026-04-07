"""CRUD endpoints: list, create, get, update, delete, clone, merge, pipeline, SLA."""
import json as _json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...auth import get_current_user, require_scope
from ...audit import write_audit_log
from ...config import get_settings
from ...database import get_db
from ...schemas import TicketCreate, TicketUpdate
from ... import gitlab_client
from ...rbac import require_developer, require_pl, require_agent
from ... import sla as sla_module
from ...models import (
    SLARecord, TicketCustomValue, TicketWatcher, TicketLink,
    TimeEntry, ProjectForward, GuestToken, Rating, ApprovalRequest, TicketTypeMeta,
    ServiceCatalogItem,
)
from ...notifications import notify_ticket_created, notify_status_changed, notify_assigned, create_db_notification
from ...assignment import evaluate_rules
from ..automation import evaluate_automation_rules
from ...redis_client import get_redis as _get_redis
from .helpers import (
    STATUS_KO,
    CATEGORY_MAP,
    VALID_TRANSITIONS,
    REASON_REQUIRED_TRANSITIONS,
    _apply_automation_actions,
    _attach_sla_deadlines,
    _can_requester_modify,
    _dispatch_notification,
    _extract_meta,
    _invalidate_ticket_list_cache,
    _issue_to_response,
    _make_list_cache_key,
    _parse_labels,
    _sla_to_dict,
    user_limiter,
    LIMIT_TICKET_CREATE,
)

logger = logging.getLogger(__name__)

crud_router = APIRouter()


@crud_router.get("/", response_model=dict)
def list_tickets(
    state: str = "all",
    category: Optional[str] = None,
    priority: Optional[str] = None,
    sla: Optional[str] = None,
    search: Optional[str] = None,
    created_by_username: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    sort_by: str = Query(default="created_at", description="정렬 기준: created_at|updated_at|priority|title"),
    order: str = Query(default="desc", description="정렬 방향: asc|desc"),
    created_after: Optional[str] = Query(default=None, description="등록일 시작 (ISO 8601, 예: 2026-01-01)"),
    created_before: Optional[str] = Query(default=None, description="등록일 종료 (ISO 8601, 예: 2026-12-31)"),
    _user: dict = Depends(require_scope("tickets:read")),
    db: Session = Depends(get_db),
):
    try:
        gl_state = "all"
        status_label: Optional[str] = None
        not_labels: Optional[str] = None

        _all_status_labels = "status::approved,status::in_progress,status::waiting,status::resolved,status::testing,status::ready_for_release,status::released"
        if state == "open":
            gl_state = "opened"
            not_labels = _all_status_labels
        elif state == "approved":
            gl_state = "opened"
            status_label = "status::approved"
        elif state == "in_progress":
            gl_state = "opened"
            status_label = "status::in_progress"
        elif state == "waiting":
            gl_state = "opened"
            status_label = "status::waiting"
        elif state == "active":
            gl_state = "opened"
            not_labels = "status::resolved,status::ready_for_release,status::released"
        elif state == "resolved":
            gl_state = "opened"
            status_label = "status::resolved"
        elif state == "testing":
            gl_state = "opened"
            status_label = "status::testing"
        elif state == "ready_for_release":
            gl_state = "opened"
            status_label = "status::ready_for_release"
        elif state == "released":
            gl_state = "opened"
            status_label = "status::released"
        elif state == "closed":
            gl_state = "closed"

        # 문제관리·변경관리 전용 티켓은 일반 티켓 목록에서 제외
        _type_exclusions = "problem"
        if not_labels:
            not_labels = f"{not_labels},{_type_exclusions}"
        else:
            not_labels = _type_exclusions

        label_parts: list[str] = []
        if status_label:
            label_parts.append(status_label)
        if category:
            # "기타"(other) category: exclude all known non-other categories
            _other_label = "기타"
            if category == "other" or category == _other_label:
                from ...models import ServiceType as _ST
                _other_cats = [
                    f"cat::{t.label}"
                    for t in db.query(_ST).filter(_ST.enabled == True).limit(500).all()  # noqa: E712
                    if t.label and t.label != _other_label
                ]
                if not_labels:
                    not_labels += "," + ",".join(_other_cats)
                else:
                    not_labels = ",".join(_other_cats)
            else:
                label_parts.append(f"cat::{category}")
        if priority:
            label_parts.append(f"prio::{priority}")
        labels = ",".join(label_parts) if label_parts else None

        role = _user.get("role", "user")

        _user_suffix = _user.get("sub", "") if role in ("user", "developer") else ""
        _r = _get_redis()
        _ver = int(_r.get(f"itsm:tickets:v:{project_id or 'all'}") or 0) if _r else 0
        _list_cache_key = _make_list_cache_key(
            project_id, _ver,
            role=role, user=_user_suffix, state=state,
            cat=category or "", prio=priority or "", sla=sla or "",
            q=search or "", cbu=created_by_username or "",
            pg=page, pp=per_page, sb=sort_by, od=order,
            ca=created_after or "", cb=created_before or "",
        )
        if _r:
            _cached = _r.get(_list_cache_key)
            if _cached:
                return _json.loads(_cached)

        # ── DB 기반 빠른 경로: role=user 또는 created_by_username 필터 ──
        # TicketSearchIndex에서 조건에 맞는 iid를 먼저 조회하여
        # GitLab API 전체 조회(get_all_issues)를 회피한다.
        _use_db_fast_path = (role == "user" or bool(created_by_username)) and not sla
        if _use_db_fast_path:
            from ...models import TicketSearchIndex as _TSI
            from sqlalchemy import cast, literal
            from sqlalchemy.dialects.postgresql import JSONB as _JSONB
            def _jsonb_contains(col, val):
                return col.op("@>")(cast(literal(val), _JSONB))
            q = db.query(_TSI)

            # 작성자 필터
            target_author = created_by_username or (_user.get("username") if role == "user" else None)
            if target_author:
                q = q.filter(_TSI.author_username == target_author)

            # 상태 필터 (라벨 기반)
            if gl_state == "opened":
                q = q.filter(_TSI.state == "opened")
            elif gl_state == "closed":
                q = q.filter(_TSI.state == "closed")
            if status_label:
                q = q.filter(_jsonb_contains(_TSI.labels_json, f'["{status_label}"]'))
            if not_labels:
                for nl in not_labels.split(","):
                    nl = nl.strip()
                    if nl:
                        q = q.filter(~_jsonb_contains(_TSI.labels_json, f'["{nl}"]'))

            # 프로젝트 필터
            pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
            q = q.filter(_TSI.project_id == pid)

            # 카테고리/우선순위 (라벨)
            if labels:
                for lb in labels.split(","):
                    lb = lb.strip()
                    if lb:
                        q = q.filter(_jsonb_contains(_TSI.labels_json, f'["{lb}"]'))

            # 검색
            if search:
                q = q.filter(
                    _TSI.title.ilike(f"%{search}%") | _TSI.description_text.ilike(f"%{search}%")
                )

            # 날짜 필터
            if created_after:
                q = q.filter(_TSI.created_at >= created_after)
            if created_before:
                q = q.filter(_TSI.created_at <= created_before)

            # 정렬
            sort_col = getattr(_TSI, sort_by, _TSI.created_at)
            q = q.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

            total = q.count()
            page_rows = q.offset((page - 1) * per_page).limit(per_page).all()

            if page_rows:
                # DB에서 가져온 iid들로 GitLab API 상세 조회 (페이지 분량만)
                page_issues = []
                for row in page_rows:
                    try:
                        issue = gitlab_client.get_issue(row.iid, project_id=row.project_id)
                        page_issues.append(issue)
                    except Exception:
                        pass
                tickets_page = [_issue_to_response(i, mask_pii=(role == "user")) for i in page_issues]
            else:
                tickets_page = []

            _attach_sla_deadlines(tickets_page, db)
            _result = {"tickets": tickets_page, "total": total, "page": page, "per_page": per_page}
            if _r:
                _r.setex(_list_cache_key, 180, _json.dumps(_result))
            return _result

        needs_in_memory = role == "user" or bool(created_by_username) or bool(sla)
        api_assignee_username = _user.get("username") if role == "developer" else None

        if needs_in_memory or role == "developer":
            if role == "developer" and not needs_in_memory:
                issues, total = gitlab_client.get_issues(
                    state=gl_state, labels=labels, not_labels=not_labels,
                    search=search, project_id=project_id,
                    page=page, per_page=per_page,
                    order_by=sort_by, sort=order,
                    created_after=created_after, created_before=created_before,
                    assignee_username=api_assignee_username,
                )
                tickets_page = [_issue_to_response(i, mask_pii=(role == "user")) for i in issues]
                _attach_sla_deadlines(tickets_page, db)
                _result = {"tickets": tickets_page, "total": total, "page": page, "per_page": per_page}
                if _r:
                    _r.setex(_list_cache_key, 180, _json.dumps(_result))
                return _result

            # role==user 는 자기 이슈만 필요하므로 GitLab author_username 으로 1차 필터링.
            # 서비스 봇이 대신 등록한 경우를 위해 2차 description 파싱 필터도 유지.
            gl_author_filter = _user.get("username") if role == "user" else None
            issues = gitlab_client.get_all_issues(
                state=gl_state, labels=labels, not_labels=not_labels,
                search=search, project_id=project_id,
                order_by=sort_by, sort=order,
                created_after=created_after, created_before=created_before,
                author_username=gl_author_filter,
            )
            # _extract_meta 중복 호출 방지: 필터링이 필요한 경우
            # 이슈당 한 번만 requester를 추출해 캐싱한 뒤 두 필터에 재사용한다.
            filtered_issues = issues
            if role == "user" or created_by_username:
                from .helpers import _get_issue_requester
                _req_cache: dict[int, str] = {
                    i["iid"]: _get_issue_requester(i)[0] for i in issues
                }
                if role == "user":
                    my_username = _user.get("username", "")
                    filtered_issues = [
                        i for i in filtered_issues
                        if _req_cache.get(i["iid"]) == my_username
                    ]
                if created_by_username:
                    filtered_issues = [
                        i for i in filtered_issues
                        if _req_cache.get(i["iid"]) == created_by_username
                    ]

            all_tickets = [_issue_to_response(i, mask_pii=(role == "user")) for i in filtered_issues]

            if sla:
                from datetime import datetime, timezone
                filtered = []
                now = datetime.now(timezone.utc)
                for t in all_tickets:
                    if t["state"] == "closed":
                        continue
                    prio = t.get("priority") or "medium"
                    sla_hours = sla_module.SLA_HOURS.get(prio, 72)
                    try:
                        created_dt = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    elapsed_hours = (now - created_dt).total_seconds() / 3600.0
                    ratio = elapsed_hours / sla_hours

                    status = "good"
                    if ratio > 1.0:
                        status = "over"
                    elif ratio >= 0.9:
                        status = "imminent"
                    elif ratio >= 0.5:
                        status = "warning"

                    if status == sla:
                        filtered.append(t)
                all_tickets = filtered

            start = (page - 1) * per_page
            page_tickets = all_tickets[start:start + per_page]
            _attach_sla_deadlines(page_tickets, db)
            _result = {"tickets": page_tickets, "total": len(all_tickets), "page": page, "per_page": per_page}
            if _r:
                _r.setex(_list_cache_key, 180, _json.dumps(_result))
            return _result

        # ── agent/admin DB 빠른 경로 — TicketSearchIndex에서 iid 조회 후 페이지분만 GitLab 상세 호출
        from ...models import TicketSearchIndex as _TSI
        from sqlalchemy import cast, literal
        from sqlalchemy.dialects.postgresql import JSONB as _JSONB
        def _jc(col, val):
            return col.op("@>")(cast(literal(val), _JSONB))
        q = db.query(_TSI)
        pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
        q = q.filter(_TSI.project_id == pid)

        # 상태 필터
        if gl_state == "opened":
            q = q.filter(_TSI.state == "opened")
        elif gl_state == "closed":
            q = q.filter(_TSI.state == "closed")

        # 라벨 필터 (status, category, priority)
        if labels:
            for lb in labels.split(","):
                lb = lb.strip()
                if lb:
                    q = q.filter(_jc(_TSI.labels_json, f'["{lb}"]'))
        if not_labels:
            for nl in not_labels.split(","):
                nl = nl.strip()
                if nl:
                    q = q.filter(~_jc(_TSI.labels_json, f'["{nl}"]'))

        # 검색
        if search:
            q = q.filter(
                _TSI.title.ilike(f"%{search}%") | _TSI.description_text.ilike(f"%{search}%")
            )

        # 날짜 필터
        if created_after:
            q = q.filter(_TSI.created_at >= created_after)
        if created_before:
            q = q.filter(_TSI.created_at <= created_before)

        # 정렬
        sort_col = getattr(_TSI, sort_by, _TSI.created_at)
        q = q.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

        total = q.count()
        page_rows = q.offset((page - 1) * per_page).limit(per_page).all()

        if page_rows:
            page_issues = []
            for row in page_rows:
                try:
                    issue = gitlab_client.get_issue(row.iid, project_id=row.project_id)
                    page_issues.append(issue)
                except Exception:
                    pass
            tickets_page = [_issue_to_response(i, mask_pii=False) for i in page_issues]
        else:
            tickets_page = []

        _attach_sla_deadlines(tickets_page, db)
        _result = {
            "tickets": tickets_page,
            "total": total,
            "page": page,
            "per_page": per_page,
        }
        if _r:
            _r.setex(_list_cache_key, 180, _json.dumps(_result))
        return _result
    except Exception as e:
        logger.error("GitLab list_tickets error: %s", e)
        raise HTTPException(status_code=502, detail="티켓 목록을 불러오는 중 오류가 발생했습니다.")


@crud_router.post("/", response_model=dict, status_code=201)
@(user_limiter.limit(LIMIT_TICKET_CREATE) if user_limiter else lambda f: f)
def create_ticket(
    request: Request,
    data: TicketCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_scope("tickets:write")),
    db: Session = Depends(get_db),
):
    from ...secret_scanner import check_and_warn as _secret_check
    from ...pii_masker import check_and_warn as _pii_check
    _scan_text = f"{data.title}\n{data.description or ''}"
    _secret_check(_scan_text, context="ticket.create", actor=user.get("username", "?"))
    _pii_check(_scan_text, context="ticket.create")

    gitlab_client.ensure_labels(data.project_id)

    _cat_label = CATEGORY_MAP.get(str(data.category), str(data.category))
    labels = [f"cat::{_cat_label}", f"prio::{data.priority}", "status::open"]

    table_rows = [
        ("신청자", data.employee_name),
        ("이메일", data.employee_email or ""),
        ("작성자", user["username"]),
    ]
    if data.department:
        table_rows.append(("부서", data.department))
    if data.location:
        table_rows.append(("위치", data.location))

    header_lines = [
        f"**신청자:** {data.employee_name}",
        f"**이메일:** {data.employee_email}",
        f"**작성자:** {user['username']}",
    ]
    if data.department:
        header_lines.append(f"**부서:** {data.department}")
    if data.location:
        header_lines.append(f"**위치:** {data.location}")

    table_lines = [
        "| 항목 | 내용 |",
        "|------|------|",
    ] + [f"| {k} | {v} |" for k, v in table_rows]

    description_parts = header_lines + ["", "---", ""] + table_lines + ["", "---", "", data.description]
    description = "\n".join(description_parts)

    assignee_id = data.assignee_id
    if not assignee_id:
        assignee_id = evaluate_rules(db, data.category, data.priority, data.title)

    try:
        issue = gitlab_client.create_issue(
            data.title, description, labels,
            project_id=data.project_id,
            assignee_id=assignee_id,
            confidential=data.confidential,
            milestone_id=data.milestone_id,
        )
    except Exception as e:
        logger.error("GitLab create_issue error: %s", e)
        raise HTTPException(status_code=502, detail="티켓 생성 중 오류가 발생했습니다.")

    ticket = _issue_to_response(issue)

    pid = data.project_id or get_settings().GITLAB_PROJECT_ID
    try:
        sla_module.create_sla_record(db, ticket["iid"], pid, data.priority, custom_deadline=data.sla_due_date)
    except Exception as e:
        logger.warning("SLA record creation failed for ticket %d: %s", ticket["iid"], e)

    write_audit_log(
        db, user, "ticket.create", "ticket", str(ticket["iid"]),
        new_value={"title": data.title, "priority": data.priority, "category": data.category},
        request=request,
    )

    try:
        _ticket_ctx = {
            "iid": ticket["iid"],
            "project_id": str(pid),
            "status": ticket.get("status", "open"),
            "priority": data.priority,
            "category": data.category,
            "title": data.title,
            "assignee": (issue.get("assignee") or {}).get("username", ""),
        }
        auto_actions = evaluate_automation_rules(db, "ticket.created", _ticket_ctx)
        if auto_actions:
            _apply_automation_actions(
                auto_actions, ticket["iid"], data.project_id, db,
                current_labels=issue.get("labels", []),
            )
    except Exception as _ae:
        logger.warning("Automation rule evaluation failed for new ticket #%d: %s", ticket["iid"], _ae)

    # 서비스 카탈로그 승인 워크플로우 — 항목이 requires_approval=True면 자동으로 승인 요청 생성
    if data.service_catalog_id:
        try:
            catalog_item = db.query(ServiceCatalogItem).filter(
                ServiceCatalogItem.id == data.service_catalog_id,
                ServiceCatalogItem.is_active.is_(True),
            ).first()
            if catalog_item and catalog_item.requires_approval:
                approval = ApprovalRequest(
                    ticket_iid=ticket["iid"],
                    project_id=str(pid),
                    requester_username=user["username"],
                    requester_name=user.get("name", user["username"]),
                    approver_username=catalog_item.approver_username or None,
                    status="pending",
                    reason=catalog_item.approval_note,
                )
                db.add(approval)
                db.commit()
                # 담당 승인자에게 DB 알림 생성
                _approver = catalog_item.approver_username
                if _approver:
                    create_db_notification(
                        db,
                        username=_approver,
                        title=f"승인 요청 — #{ticket['iid']} {data.title}",
                        body=f"서비스 카탈로그 '{catalog_item.name}' 요청이 승인 대기 중입니다.",
                        link=f"/tickets/{ticket['iid']}",
                    )
        except Exception as _ce:
            logger.warning("Service catalog approval trigger failed for ticket #%d: %s", ticket["iid"], _ce)

    from ...tasks import send_ticket_notification
    _dispatch_notification(background_tasks, send_ticket_notification, notify_ticket_created, ticket)

    _invalidate_ticket_list_cache(data.project_id)

    return ticket


@crud_router.get("/calendar")
def get_calendar_tickets(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """월간 캘린더 뷰용 티켓 목록.

    해당 연월에 생성되었거나 마감일(SLA)이 걸쳐 있는 티켓을 반환한다.
    role==user 는 본인 티켓만 반환.
    """
    from datetime import datetime as _dt, timezone as _tz
    import calendar

    settings = get_settings()
    pid = project_id or settings.GITLAB_PROJECT_ID

    # 월의 시작/끝
    first_day = _dt(year, month, 1, tzinfo=_tz.utc)
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = _dt(year, month, last_day_num, 23, 59, 59, tzinfo=_tz.utc)

    created_after = first_day.isoformat()
    created_before = last_day.isoformat()

    try:
        issues, _ = gitlab_client.get_issues(
            state="all",
            project_id=pid,
            per_page=100,
            page=1,
            created_after=created_after,
            created_before=created_before,
        )
    except Exception as e:
        logger.error("Calendar: failed to fetch issues: %s", e)
        raise HTTPException(status_code=502, detail="티켓 목록을 불러오는 중 오류가 발생했습니다.")

    # SLA 기한이 해당 월에 걸친 레코드도 포함
    sla_iids_in_month = set()
    try:
        sla_q = db.query(SLARecord).filter(
            SLARecord.project_id == pid,
            SLARecord.sla_deadline >= first_day.replace(tzinfo=None),
            SLARecord.sla_deadline <= last_day.replace(tzinfo=None),
        ).limit(500).all()
        sla_iids_in_month = {r.gitlab_issue_iid for r in sla_q}
        {r.gitlab_issue_iid: r.sla_deadline.isoformat() for r in sla_q}
    except Exception as e:
        logger.warning("Calendar: SLA query failed: %s", e)

    # SLA 기한이 해당 월에 걸치지만 created_at이 범위 밖인 이슈 추가 조회
    extra_iids = sla_iids_in_month - {iss["iid"] for iss in issues}
    for extra_iid in extra_iids:
        try:
            extra_issue = gitlab_client.get_issue(extra_iid, project_id=pid)
            issues.append(extra_issue)
        except Exception:
            pass

    # 이슈별 SLA 정보 매핑
    all_sla = db.query(SLARecord).filter(
        SLARecord.project_id == pid,
        SLARecord.gitlab_issue_iid.in_([iss["iid"] for iss in issues]),
    ).all()
    sla_map = {r.gitlab_issue_iid: r for r in all_sla}

    is_regular_user = current_user.get("role", "user") == "user"
    username = current_user.get("username", "")

    result = []
    for issue in issues:
        # role==user: 본인이 작성했거나 담당자인 이슈만 포함
        if is_regular_user:
            author = (issue.get("author") or {}).get("username", "")
            assignees = [a.get("username", "") for a in (issue.get("assignees") or [])]
            if author != username and username not in assignees:
                continue

        iid = issue.get("iid") or issue.get("id")
        labels = issue.get("labels", [])
        status = next(
            (lb.split("::")[1] for lb in labels if lb.startswith("status::")),
            "open" if issue.get("state") == "opened" else "closed",
        )
        priority = next(
            (lb.split("::")[1] for lb in labels if lb.startswith("prio::")),
            "medium",
        )
        sla_rec = sla_map.get(iid)
        result.append({
            "iid": iid,
            "title": issue.get("title", ""),
            "status": status,
            "priority": priority,
            "created_at": issue.get("created_at", ""),
            "closed_at": issue.get("closed_at"),
            "sla_deadline": sla_rec.sla_deadline.isoformat() if sla_rec else None,
            "web_url": issue.get("web_url", ""),
        })

    return result


@crud_router.get("/gantt", summary="간트 차트 데이터")
def get_gantt_data(
    days: int = Query(30, ge=7, le=90),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    """최근 N일 티켓 + 의존 관계 반환."""
    from datetime import datetime as _dt, timedelta, date, timezone as _tz

    settings = get_settings()
    project_id = settings.GITLAB_PROJECT_ID

    cutoff = _dt.now(_tz.utc) - timedelta(days=days)

    # GitLab에서 최근 N일 이슈 조회
    try:
        issues = gitlab_client.get_all_issues(
            state="all",
            project_id=project_id,
            created_after=cutoff.isoformat(),
        )
    except Exception as e:
        logger.error("Gantt: GitLab issue fetch failed: %s", e)
        issues = []

    priority_days = {"critical": 1, "high": 3, "medium": 7, "low": 14}

    ticket_items = []
    iid_set = set()
    for issue in issues:
        iid = issue.get("iid")
        if not iid:
            continue
        iid_set.add(iid)

        labels = issue.get("labels", [])
        priority = "medium"
        status = "open"
        for lbl in labels:
            if lbl.startswith("prio::"):
                priority = lbl[6:]
            if lbl.startswith("status::"):
                status = lbl[8:]
        if issue.get("state") == "closed":
            status = "closed"

        created_raw = issue.get("created_at", "")
        issue.get("closed_at") or issue.get("updated_at", "")

        def _parse_date(s: str) -> date:
            if not s:
                return date.today()
            try:
                return _dt.fromisoformat(s.replace("Z", "+00:00")).date()
            except Exception:
                return date.today()

        start_date = _parse_date(created_raw)

        if issue.get("state") == "closed" and issue.get("closed_at"):
            end_date = _parse_date(issue["closed_at"])
        else:
            delta = priority_days.get(priority, 7)
            end_date = start_date + timedelta(days=delta)

        assignee = None
        if issue.get("assignee"):
            assignee = issue["assignee"].get("name") or issue["assignee"].get("username")

        ticket_items.append({
            "iid": iid,
            "title": issue.get("title", ""),
            "status": status,
            "priority": priority,
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "assignee": assignee,
        })

    # ticket_links 테이블에서 관련 링크 조회
    links_rows = (
        db.query(TicketLink)
        .filter(
            TicketLink.project_id == project_id,
            TicketLink.source_iid.in_(iid_set),
        )
        .all()
    ) if iid_set else []

    link_items = [
        {"from": row.source_iid, "to": row.target_iid, "type": row.link_type}
        for row in links_rows
        if row.target_iid in iid_set
    ]

    return {"tickets": ticket_items, "links": link_items}


@crud_router.get("/{iid}", response_model=dict)
def get_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
        ticket = _issue_to_response(issue, mask_pii=(_user.get("role") == "user"))
        creator = ticket.get("created_by_username")
        if creator:
            name_map = gitlab_client.get_users_by_usernames([creator])
            if creator in name_map:
                ticket["employee_name"] = name_map[creator]
        return ticket
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")
        logger.error("GitLab get_ticket %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")
    except Exception as e:
        logger.error("GitLab get_ticket %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")


@crud_router.patch("/{iid}", response_model=dict)
def update_ticket(
    request: Request,
    iid: int,
    data: TicketUpdate,
    background_tasks: BackgroundTasks,
    project_id: Optional[str] = Query(default=None),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ...rbac import ROLE_LEVELS
    role = user.get("role", "user")
    is_developer = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["developer"]
    is_pl = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["pl"]

    # 이슈를 미리 조회 (권한 확인 + 업데이트 로직 공통 사용 — 중복 API 호출 방지)
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
    except Exception as e:
        logger.error("GitLab get_issue %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")

    if not is_developer:
        if not _can_requester_modify(issue, user):
            raise HTTPException(
                status_code=403,
                detail="접수 상태의 본인 티켓만 수정할 수 있습니다.",
            )
        if data.status is not None or data.priority is not None or data.assignee_id is not None:
            raise HTTPException(
                status_code=403,
                detail="상태·우선순위·담당자 변경은 IT 담당자만 가능합니다.",
            )

    if data.assignee_id is not None and not is_pl:
        raise HTTPException(status_code=403, detail="담당자 변경은 IT 관리자 이상만 가능합니다.")
    try:
        if if_match:
            current_etag = issue.get("updated_at", "")
            if if_match.strip('"') != current_etag:
                raise HTTPException(
                    status_code=409,
                    detail="다른 사용자가 이미 수정했습니다. 페이지를 새로고침 후 다시 시도하세요.",
                    headers={"ETag": f'"{current_etag}"'},
                )

        current_labels = issue.get("labels", [])

        old_label_info = _parse_labels(current_labels)
        old_status = old_label_info["status"] if issue["state"] == "opened" else "closed"

        state_event = None

        # Compute final labels in one shot to avoid GitLab add+remove race conditions
        final_labels: list[str] = list(current_labels)

        if data.status is not None:
            allowed = VALID_TRANSITIONS.get(old_status, set())
            if data.status not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{STATUS_KO.get(old_status, old_status)}'에서 '{STATUS_KO.get(data.status, data.status)}'(으)로의 전환은 허용되지 않습니다.",
                )
            if data.status in REASON_REQUIRED_TRANSITIONS and not (data.change_reason or "").strip():
                raise HTTPException(
                    status_code=422,
                    detail=f"'{STATUS_KO.get(data.status, data.status)}' 상태로 전환하려면 변경 이유를 입력해야 합니다.",
                )
            pid = str(project_id or get_settings().GITLAB_PROJECT_ID)
            pending_approval = db.query(ApprovalRequest).filter(
                ApprovalRequest.ticket_iid == iid,
                ApprovalRequest.project_id == pid,
                ApprovalRequest.status == "pending",
            ).first()
            if pending_approval:
                raise HTTPException(
                    status_code=409,
                    detail="대기 중인 승인 요청이 있어 상태를 변경할 수 없습니다. 먼저 승인 요청을 처리하세요.",
                )
            final_labels = [l for l in final_labels if not l.startswith("status::")]
            if data.status == "closed":
                state_event = "close"
            elif data.status == "reopened":
                state_event = "reopen"
                final_labels.append("status::open")
            else:
                final_labels.append(f"status::{data.status.value}")

        if data.priority is not None:
            final_labels = [l for l in final_labels if not l.startswith("prio::")]
            final_labels.append(f"prio::{data.priority}")

        new_title = None
        new_description = None
        if data.title is not None:
            new_title = data.title
        if data.description is not None:
            old_meta = _extract_meta(issue.get("description") or "")
            meta_lines = []
            if old_meta["employee_name"]:
                meta_lines.append(f"**신청자:** {old_meta['employee_name']}")
            if old_meta["employee_email"]:
                meta_lines.append(f"**이메일:** {old_meta['employee_email']}")
            if old_meta["created_by_username"]:
                meta_lines.append(f"**작성자:** {old_meta['created_by_username']}")
            if old_meta["department"]:
                meta_lines.append(f"**부서:** {old_meta['department']}")
            if old_meta["location"]:
                meta_lines.append(f"**위치:** {old_meta['location']}")
            meta_lines.extend(["", "---", "", data.description])
            new_description = "\n".join(meta_lines)

        if data.category is not None:
            final_labels = [l for l in final_labels if not l.startswith("cat::")]
            _cat_label = CATEGORY_MAP.get(str(data.category), str(data.category))
            final_labels.append(f"cat::{_cat_label}")

        # Only send labels if something actually changed
        labels_changed = set(final_labels) != set(current_labels)

        updated = gitlab_client.update_issue(
            iid,
            labels=final_labels if labels_changed else None,
            state_event=state_event,
            project_id=project_id,
            assignee_id=data.assignee_id,
            title=new_title,
            description=new_description,
            milestone_id=data.milestone_id,
            gitlab_token=user.get("gitlab_token"),
        )

        if data.status is not None and data.status != old_status:
            from_ko = STATUS_KO.get(old_status, old_status)
            to_ko = STATUS_KO.get(data.status, data.status)
            note_body = f"🔄 **상태 변경**: {from_ko} → **{to_ko}**"
            try:
                gitlab_client.add_note(iid, note_body, project_id=project_id, gitlab_token=user.get("gitlab_token"))
            except Exception as e:
                logger.warning("Failed to add status change note to ticket %d: %s", iid, e)

        ticket = _issue_to_response(updated)

        changes: dict = {}
        if data.status is not None:
            changes["status"] = {"old": old_status, "new": data.status}
        if data.assignee_id is not None:
            changes["assignee_id"] = data.assignee_id
        if data.change_reason:
            changes["change_reason"] = data.change_reason
        write_audit_log(db, user, "ticket.update", "ticket", str(iid),
                        old_value={"status": old_status}, new_value=changes, request=request)

        pid = project_id or get_settings().GITLAB_PROJECT_ID

        # 이유 필수 상태 전환 시 GitLab 댓글로 자동 기록
        if data.status is not None and data.change_reason and data.status != old_status:
            _status_labels = {
                "waiting": "추가정보 대기",
                "reopened": "재오픈",
            }
            _status_val = data.status.value if hasattr(data.status, "value") else str(data.status)
            _label = _status_labels.get(_status_val, _status_val)
            _comment = f"**[{_label}]** 상태로 전환되었습니다.\n\n> {data.change_reason}"
            try:
                gitlab_client.add_note(iid, _comment, project_id=pid, gitlab_token=user.get("gitlab_token"))
            except Exception as _e:
                logger.warning("Failed to add change_reason note for ticket #%d: %s", iid, _e)
        if data.status in ("resolved", "ready_for_release", "released", "closed"):
            sla_module.mark_resolved(db, iid, pid)
        if data.status is not None and data.status != old_status:
            if data.status == "waiting":
                sla_module.pause_sla(db, iid, pid)
            elif old_status == "waiting":
                sla_module.resume_sla(db, iid, pid)
            if data.status == "reopened":
                try:
                    from datetime import datetime as _dt, timezone as _tz
                    from ...models import SLARecord as _SLARecord
                    _sla_rec = db.query(_SLARecord).filter(
                        _SLARecord.gitlab_issue_iid == iid,
                        _SLARecord.project_id == pid,
                    ).first()
                    if _sla_rec:
                        _sla_rec.reopened_at = _dt.now(_tz.utc)
                        db.commit()
                except Exception as _e:
                    logger.warning("Failed to record reopened_at for ticket #%d: %s", iid, _e)

        if data.status in ("resolved", "closed") and data.resolution_note:
            try:
                from ...models import ResolutionNote
                rn = ResolutionNote(
                    ticket_iid=iid,
                    project_id=pid,
                    note=data.resolution_note,
                    resolution_type=data.resolution_type,
                    created_by=str(user.get("sub", "")),
                    created_by_name=user.get("name", user.get("username", "")),
                )
                db.add(rn)
                db.commit()
                _type_label = {
                    "permanent_fix": "🔧 영구 해결",
                    "workaround": "🔄 임시 해결",
                    "no_action": "⏭️ 조치 불필요",
                    "duplicate": "♻️ 중복 티켓",
                    "by_mr": "🔀 MR 머지로 해결",
                }.get(data.resolution_type or "", "✅ 해결")
                gitlab_client.add_note(
                    iid,
                    f"**{_type_label}** — 해결 노트\n\n{data.resolution_note}",
                    project_id=pid,
                    confidential=True,
                    gitlab_token=user.get("gitlab_token"),
                )
            except Exception as e:
                logger.warning("Failed to save resolution note for ticket #%d: %s", iid, e)

        if data.status is not None and data.status != old_status:
            try:
                _pid_str = str(project_id or get_settings().GITLAB_PROJECT_ID)
                _ticket_ctx = {
                    "iid": iid,
                    "project_id": _pid_str,
                    "status": str(data.status.value) if hasattr(data.status, "value") else str(data.status),
                    "priority": ticket.get("priority", ""),
                    "category": ticket.get("category", ""),
                    "title": ticket.get("title", ""),
                    "assignee": (updated.get("assignee") or {}).get("username", ""),
                }
                auto_actions = evaluate_automation_rules(db, "ticket.status_changed", _ticket_ctx)
                if auto_actions:
                    _apply_automation_actions(
                        auto_actions, iid, project_id, db,
                        current_labels=updated.get("labels", []),
                    )
            except Exception as _ae:
                logger.warning("Automation rule evaluation failed for ticket #%d status change: %s", iid, _ae)

        if data.status is not None and data.status != old_status:
            _actor_name = user.get("name", user.get("username", "담당자"))
            from ...tasks import send_status_notification
            _dispatch_notification(
                background_tasks, send_status_notification, notify_status_changed,
                ticket, old_status, data.status, _actor_name,
            )
            try:
                assignee_gl_id = (updated.get("assignee") or {}).get("id")
                actor_gl_id = user.get("sub")
                if assignee_gl_id and str(assignee_gl_id) != str(actor_gl_id):
                    create_db_notification(
                        db,
                        recipient_id=str(assignee_gl_id),
                        title=f"티켓 #{iid} 상태 변경",
                        body=f"{STATUS_KO.get(old_status)} → {STATUS_KO.get(data.status)}",
                        link=f"/tickets/{iid}",
                    )
            except Exception as e:
                logger.warning("Failed to create in-app notification for ticket %d: %s", iid, e)

            if data.status in ("resolved", "closed"):
                try:
                    description_text = updated.get("description") or ""
                    from ...routers.webhooks import _parse_submitter_username, _get_gitlab_user_id_by_username
                    submitter_username = _parse_submitter_username(description_text)
                    submitter_user_id = _get_gitlab_user_id_by_username(submitter_username) if submitter_username else None
                    if submitter_user_id and submitter_user_id != str(actor_gl_id if actor_gl_id else ""):
                        create_db_notification(
                            db,
                            recipient_id=submitter_user_id,
                            title=f"티켓 #{iid} 처리가 완료됐습니다",
                            body="서비스 만족도를 평가해 주세요. 소중한 의견이 서비스 개선에 도움이 됩니다.",
                            link=f"/tickets/{iid}",
                        )
                except Exception as e:
                    logger.warning("Failed to send CSAT notification for ticket %d: %s", iid, e)

        if data.assignee_id is not None:
            try:
                from ...tasks import send_assigned_notification as _assign_task
                from ...gitlab_client import get_user_email as _get_email
                _actor_name_assign = user.get("name", user.get("username", "담당자"))
                _assignee_email = _get_email(data.assignee_id) or ""
                if _assignee_email:
                    _dispatch_notification(
                        background_tasks, _assign_task, notify_assigned,
                        _assignee_email, ticket, _actor_name_assign,
                    )
            except Exception as _e:
                logger.warning("Failed to dispatch assigned notification for ticket %d: %s", iid, _e)

        _invalidate_ticket_list_cache(project_id)
        etag = updated.get("updated_at", "")
        return JSONResponse(content=ticket, headers={"ETag": f'"{etag}"'})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("GitLab update_ticket %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 수정 중 오류가 발생했습니다.")


@crud_router.delete("/{iid}", status_code=204)
def delete_ticket(
    request: Request,
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ...rbac import ROLE_LEVELS
    role = user.get("role", "user")
    is_admin = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["admin"]

    if not is_admin:
        try:
            issue = gitlab_client.get_issue(iid, project_id=project_id)
        except Exception as e:
            logger.error("GitLab get_issue %d error: %s", iid, e)
            raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")
        if not _can_requester_modify(issue, user):
            raise HTTPException(
                status_code=403,
                detail="접수 상태의 본인 티켓만 삭제할 수 있습니다.",
            )

    try:
        gitlab_token = user.get("gitlab_token") or None
        gitlab_client.delete_issue(iid, project_id=project_id, gitlab_token=gitlab_token)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")
        logger.error("GitLab delete_issue %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 삭제 중 오류가 발생했습니다.")
    except Exception as e:
        logger.error("GitLab delete_issue %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 삭제 중 오류가 발생했습니다.")

    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    try:
        db.query(SLARecord).filter(
            SLARecord.gitlab_issue_iid == iid, SLARecord.project_id == pid
        ).delete(synchronize_session=False)
        db.query(TicketCustomValue).filter(
            TicketCustomValue.gitlab_issue_iid == iid, TicketCustomValue.project_id == pid
        ).delete(synchronize_session=False)
        db.query(TicketWatcher).filter(
            TicketWatcher.ticket_iid == iid, TicketWatcher.project_id == pid
        ).delete(synchronize_session=False)
        db.query(TicketLink).filter(
            (TicketLink.source_iid == iid) | (TicketLink.target_iid == iid),
            TicketLink.project_id == pid,
        ).delete(synchronize_session=False)
        db.query(TimeEntry).filter(
            TimeEntry.issue_iid == iid, TimeEntry.project_id == pid
        ).delete(synchronize_session=False)
        db.query(ProjectForward).filter(
            ProjectForward.source_iid == iid, ProjectForward.source_project_id == pid
        ).delete(synchronize_session=False)
        db.query(GuestToken).filter(
            GuestToken.ticket_iid == iid, GuestToken.project_id == pid
        ).delete(synchronize_session=False)
        db.query(ApprovalRequest).filter(
            ApprovalRequest.ticket_iid == iid, ApprovalRequest.project_id == pid
        ).delete(synchronize_session=False)
        db.query(TicketTypeMeta).filter(
            TicketTypeMeta.ticket_iid == iid, TicketTypeMeta.project_id == pid
        ).delete(synchronize_session=False)
        db.query(Rating).filter(Rating.gitlab_issue_iid == iid).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        logger.warning("delete_ticket #%d: DB 연관 레코드 정리 실패 (무시): %s", iid, e)
        db.rollback()

    write_audit_log(db, user, "ticket.delete", "ticket", str(iid), request=request)


@crud_router.post("/{iid}/clone", response_model=dict, status_code=201)
def clone_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓 복제 — 제목·카테고리·우선순위·본문을 복사해 새 티켓을 생성한다."""
    try:
        original = gitlab_client.get_issue(iid, project_id=project_id)
    except Exception:
        raise HTTPException(status_code=404, detail="원본 티켓을 찾을 수 없습니다.")

    orig_labels = original.get("labels", [])
    category = next((lb[5:] for lb in orig_labels if lb.startswith("cat::")), "other")
    priority = next((lb[6:] for lb in orig_labels if lb.startswith("prio::")), "medium")

    new_title = f"[복제] {original.get('title', '')}"
    new_labels = [f"cat::{category}", f"prio::{priority}", "status::open"]

    try:
        new_issue = gitlab_client.create_issue(
            title=new_title,
            description=original.get("description", ""),
            labels=new_labels,
            project_id=project_id or get_settings().GITLAB_PROJECT_ID,
        )
    except Exception as e:
        logger.error("Clone ticket create error: %s", e)
        raise HTTPException(status_code=502, detail="티켓 복제 중 오류가 발생했습니다.")

    new_iid = new_issue.get("iid")
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)

    try:
        from ...models import TicketLink
        link = TicketLink(
            source_iid=iid,
            target_iid=new_iid,
            project_id=pid,
            link_type="related",
            created_by=user.get("username", ""),
        )
        db.add(link)

        sla_module.create_sla_record(db, new_iid, pid, priority)
        db.commit()
    except Exception as e:
        logger.warning("Clone ticket post-processing error: %s", e)

    try:
        gitlab_client.add_note(
            iid,
            f"🔁 이 티켓이 #{new_iid}로 복제됐습니다.",
            project_id=pid,
            gitlab_token=user.get("gitlab_token"),
        )
    except Exception:
        pass

    return _issue_to_response(new_issue)


@crud_router.post("/{iid}/merge", response_model=dict)
def merge_ticket(
    iid: int,
    request: Request,
    target_iid: int = Query(..., description="병합 대상 티켓 IID — 이 티켓이 유지됩니다"),
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓 병합 — iid를 target_iid로 병합한다."""
    from ...rbac import require_agent as _req_agent
    _req_agent(user)

    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)

    if iid == target_iid:
        raise HTTPException(status_code=400, detail="자기 자신에게 병합할 수 없습니다.")

    try:
        source = gitlab_client.get_issue(iid, project_id=pid)
    except Exception:
        raise HTTPException(status_code=404, detail=f"소스 티켓 #{iid}를 찾을 수 없습니다.")

    try:
        target = gitlab_client.get_issue(target_iid, project_id=pid)
    except Exception:
        raise HTTPException(status_code=404, detail=f"대상 티켓 #{target_iid}를 찾을 수 없습니다.")

    if target.get("state") == "closed":
        raise HTTPException(status_code=400, detail=f"대상 티켓 #{target_iid}가 이미 닫혀 있습니다.")

    try:
        source_notes = gitlab_client.get_notes(iid, project_id=pid)
        user_notes = [n for n in source_notes if not n.get("system", False)]
        if user_notes:
            header = f"**#{iid}에서 병합된 댓글 ({len(user_notes)}개)**\n\n---\n\n"
            combined = header + "\n\n---\n\n".join(
                f"**{n.get('author', {}).get('name', '?')}** ({n.get('created_at', '')[:10]}):\n{n.get('body', '')}"
                for n in user_notes
            )
            gitlab_client.add_note(target_iid, combined, project_id=pid, gitlab_token=user.get("gitlab_token"))
    except Exception as e:
        logger.warning("Merge: failed to copy notes from #%s: %s", iid, e)

    try:
        _gl_tok = user.get("gitlab_token")
        gitlab_client.add_note(
            iid,
            f"🔀 이 티켓은 #{target_iid}로 병합됐습니다.\n\n"
            f"추가 문의는 #{target_iid}에서 이어서 처리됩니다.",
            project_id=pid,
            gitlab_token=_gl_tok,
        )
        gitlab_client.update_issue(iid, state_event="close", project_id=pid, gitlab_token=_gl_tok)
    except Exception as e:
        logger.warning("Merge: failed to close source #%s: %s", iid, e)

    try:
        gitlab_client.add_note(
            target_iid,
            f"🔀 #{iid} 티켓이 이 티켓으로 병합됐습니다.\n\n"
            f"**원본 제목:** {source.get('title', '')}",
            project_id=pid,
            gitlab_token=user.get("gitlab_token"),
        )
    except Exception as e:
        logger.warning("Merge: failed to add merge note to target #%s: %s", target_iid, e)

    write_audit_log(db, user, "ticket.merge", "ticket", str(iid),
                    new_value={"target_iid": target_iid}, request=request)

    return {"ok": True, "source_iid": iid, "target_iid": target_iid}


@crud_router.post("/{iid}/pipeline", response_model=dict, status_code=201)
def trigger_ticket_pipeline(
    iid: int,
    request: Request,
    ref: str = Query(default="main", description="브랜치 또는 태그"),
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """티켓과 연계하여 GitLab CI/CD 파이프라인을 트리거한다."""
    try:
        result = gitlab_client.trigger_pipeline(
            ref=ref,
            variables={"ITSM_TICKET_IID": str(iid)},
            project_id=project_id,
        )
    except Exception as e:
        logger.error("Pipeline trigger failed for ticket #%s: %s", iid, e)
        raise HTTPException(status_code=502, detail=f"파이프라인 트리거 실패: {e}")

    try:
        pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
        pipeline_id = result.get("id", "?")
        pipeline_url = result.get("web_url", "")
        note = (
            f"⚙️ **파이프라인 트리거됨**\n\n"
            f"- **브랜치:** `{ref}`\n"
            f"- **파이프라인:** [{pipeline_id}]({pipeline_url})\n"
            f"- **상태:** {result.get('status', 'pending')}"
        )
        gitlab_client.add_note(iid, note, project_id=pid, gitlab_token=user.get("gitlab_token"))
    except Exception as e:
        logger.warning("Failed to add pipeline note to ticket #%s: %s", iid, e)

    write_audit_log(db, user, "ticket.pipeline_trigger", "ticket", str(iid),
                    new_value={"ref": ref, "pipeline_id": result.get("id")}, request=request)

    return result


@crud_router.get("/{iid}/pipelines", response_model=list)
def list_ticket_pipelines(
    iid: int,
    ref: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
):
    """티켓 관련 프로젝트의 최근 파이프라인 목록 조회."""
    try:
        return gitlab_client.list_pipelines(ref=ref, project_id=project_id)
    except Exception as e:
        logger.error("List pipelines error: %s", e)
        raise HTTPException(status_code=502, detail="파이프라인 목록 조회 실패")


@crud_router.get("/{iid}/linked-mrs")
def get_linked_mrs(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_pl),
):
    """G-2: Return GitLab Merge Requests related to this ticket/issue."""
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    try:
        mrs = gitlab_client.get_issue_linked_mrs(iid, pid)
        return [
            {
                "iid": mr.get("iid"),
                "title": mr.get("title"),
                "state": mr.get("state"),
                "web_url": mr.get("web_url"),
                "author_name": mr.get("author", {}).get("name"),
                "created_at": mr.get("created_at"),
                "merged_at": mr.get("merged_at"),
            }
            for mr in mrs
        ]
    except Exception as e:
        logger.error("Failed to fetch linked MRs for #%s: %s", iid, e)
        raise HTTPException(status_code=502, detail="GitLab MR 목록을 불러오는 중 오류가 발생했습니다.")


@crud_router.get("/{iid}/sla")
def get_ticket_sla(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_developer),
):
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        return {}
    return _sla_to_dict(record)


@crud_router.patch("/{iid}/sla")
def update_ticket_sla(
    iid: int,
    body: dict,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_pl),
):
    """IT 관리자 이상 — SLA 기한 수동 변경."""
    from datetime import date as date_type
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        raise HTTPException(status_code=404, detail="SLA 레코드를 찾을 수 없습니다.")

    due_date_str = body.get("sla_due_date")
    if not due_date_str:
        raise HTTPException(status_code=400, detail="sla_due_date 필드가 필요합니다.")
    try:
        d = date_type.fromisoformat(due_date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).")

    from datetime import datetime as dt, timezone
    today = dt.now(timezone.utc).date()
    if d < today:
        raise HTTPException(status_code=400, detail=f"SLA 기한은 오늘({today}) 이후 날짜여야 합니다.")

    record.sla_deadline = dt(d.year, d.month, d.day, 23, 59, 59)
    record.breached = False
    db.commit()
    return _sla_to_dict(record)


@crud_router.post("/{iid}/sla/pause")
def pause_ticket_sla(
    iid: int,
    request: Request,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    """SLA 카운트 일시정지 — 에이전트 이상."""
    from datetime import datetime as dt, timezone
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        raise HTTPException(status_code=404, detail="SLA 레코드를 찾을 수 없습니다.")
    if record.paused_at:
        raise HTTPException(status_code=409, detail="이미 일시정지 상태입니다.")
    record.paused_at = dt.now(timezone.utc)
    db.commit()
    write_audit_log(db, user, "sla.pause", "sla_record", str(record.id), request=request)
    return _sla_to_dict(record)


@crud_router.post("/{iid}/sla/resume")
def resume_ticket_sla(
    iid: int,
    request: Request,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    """SLA 카운트 재개 — 에이전트 이상."""
    from datetime import datetime as dt, timezone
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        raise HTTPException(status_code=404, detail="SLA 레코드를 찾을 수 없습니다.")
    if not record.paused_at:
        raise HTTPException(status_code=409, detail="일시정지 상태가 아닙니다.")
    now = dt.now(timezone.utc)
    paused_at = record.paused_at if record.paused_at.tzinfo else record.paused_at.replace(tzinfo=timezone.utc)
    delta = int((now - paused_at).total_seconds())
    record.total_paused_seconds = (record.total_paused_seconds or 0) + delta
    record.paused_at = None
    db.commit()
    write_audit_log(db, user, "sla.resume", "sla_record", str(record.id), request=request)
    return _sla_to_dict(record)


@crud_router.post("/{iid}/sla/extend")
def extend_ticket_sla(
    iid: int,
    body: dict,
    request: Request,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_pl),
):
    """SLA 기한 연장 — IT 관리자 이상. body: {minutes: int}"""
    from datetime import timezone, timedelta
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        raise HTTPException(status_code=404, detail="SLA 레코드를 찾을 수 없습니다.")
    minutes = int(body.get("minutes", 0))
    if minutes <= 0:
        raise HTTPException(status_code=400, detail="minutes는 양수여야 합니다.")
    deadline = record.sla_deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    record.sla_deadline = deadline + timedelta(minutes=minutes)
    record.breached = False
    db.commit()
    write_audit_log(db, user, "sla.extend", "sla_record", str(record.id),
                    new_value={"minutes": minutes}, request=request)
    return _sla_to_dict(record)


@crud_router.get("/{iid}/sla-prediction")
def get_sla_prediction(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_developer),
):
    """과거 데이터 기반 티켓 해결 시간 예측 (중위수 통계 모델).

    오픈 티켓에서만 유의미하나, 종료된 티켓에도 응답은 반환한다.
    과거 데이터가 없어도 priority 기본값으로 응답한다.
    """
    from ...sla_prediction import predict_resolution as _predict
    from datetime import timezone as _tz

    pid = project_id or get_settings().GITLAB_PROJECT_ID

    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
    except Exception as e:
        logger.error("Failed to fetch issue #%s for SLA prediction: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 정보를 불러오는 중 오류가 발생했습니다.")

    labels = issue.get("labels", [])
    priority = "medium"
    category = None
    for label in labels:
        if label.startswith("prio::"):
            priority = label.removeprefix("prio::")
        elif label.startswith("category::"):
            category = label.removeprefix("category::")

    assignee_id: Optional[int] = None
    assignees = issue.get("assignees") or []
    if assignees:
        assignee_id = assignees[0].get("id")

    created_at_str = issue.get("created_at", "")
    try:
        from datetime import datetime as _dt
        created_at = _dt.fromisoformat(created_at_str.replace("Z", "+00:00"))
    except Exception:
        created_at = _dt.now(_tz.utc)

    try:
        result = _predict(
            db=db,
            iid=iid,
            project_id=pid,
            priority=priority,
            created_at=created_at,
            category=category,
            assignee_id=assignee_id,
        )
    except Exception as e:
        logger.error("SLA prediction failed for ticket #%s: %s", iid, e)
        raise HTTPException(status_code=500, detail="SLA 예측 중 오류가 발생했습니다.")

    return result


@crud_router.post("/{iid}/ai-summary")
def ai_summarize_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI로 티켓 댓글 스레드를 요약합니다. AI 설정 미활성화 시 404."""
    from ...models import AISettings
    from ... import ai_service

    ai_row = db.query(AISettings).filter(AISettings.id == 1).first()
    if not ai_row or not ai_row.enabled or not ai_row.feature_summarize:
        raise HTTPException(status_code=404, detail="AI 요약이 비활성화되어 있습니다. 관리자 > AI 설정에서 활성화하세요.")

    settings = get_settings()
    pid = project_id or settings.GITLAB_PROJECT_ID
    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
        notes_raw = gitlab_client.get_notes(iid, project_id=pid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 데이터 조회 실패: {e}")

    comments = [
        n for n in (notes_raw or [])
        if not n.get("system", False) and n.get("body", "").strip()
    ]

    try:
        result = ai_service.summarize_ticket(
            ai_row,
            title=issue.get("title", ""),
            description=issue.get("description") or "",
            comments=comments,
        )
    except Exception as e:
        logger.error("AI summary failed for ticket #%s: %s", iid, e)
        raise HTTPException(status_code=500, detail="AI 요약 생성 중 오류가 발생했습니다.")

    return {
        "iid": iid,
        "summary": result.get("summary", ""),
        "key_points": result.get("key_points", []),
        "suggested_action": result.get("suggested_action", ""),
        "comment_count": len(comments),
    }


@crud_router.post("/{iid}/ai-classify")
def ai_classify_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI로 기존 티켓 카테고리·우선순위를 재분류합니다."""
    from ...models import AISettings
    from ... import ai_service

    ai_row = db.query(AISettings).filter(AISettings.id == 1).first()
    if not ai_row or not ai_row.enabled or not ai_row.feature_classify:
        raise HTTPException(status_code=404, detail="AI 분류가 비활성화되어 있습니다.")

    settings = get_settings()
    pid = project_id or settings.GITLAB_PROJECT_ID
    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 데이터 조회 실패: {e}")

    result = ai_service.classify_ticket(
        ai_row,
        title=issue.get("title", ""),
        description=issue.get("description") or "",
    )
    return {"iid": iid, **result}


@crud_router.post("/ai-suggest")
def ai_suggest_ticket(
    body: dict,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """
    티켓 작성 중 카테고리·우선순위 실시간 제안.
    Body: {title, description}
    """
    from ...models import AISettings
    from ... import ai_service

    ai_row = db.query(AISettings).filter(AISettings.id == 1).first()
    if not ai_row or not ai_row.enabled or not ai_row.feature_classify:
        raise HTTPException(status_code=404, detail="AI 분류가 비활성화되어 있습니다.")

    title = (body.get("title") or "").strip()
    description = (body.get("description") or "").strip()
    if len(title) < 3:
        raise HTTPException(status_code=422, detail="제목을 3자 이상 입력하세요.")

    result = ai_service.classify_ticket(ai_row, title=title, description=description)
    return result
