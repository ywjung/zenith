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
from ...schemas import TicketCreate, TicketUpdate, SLARecordResponse
from ... import gitlab_client
from ...rbac import require_developer, require_pl, require_agent
from ... import sla as sla_module
from ...models import (
    SLARecord, TicketCustomValue, TicketWatcher, TicketLink,
    TimeEntry, ProjectForward, GuestToken, Rating, ApprovalRequest, TicketTypeMeta,
)
from ...notifications import notify_ticket_created, notify_status_changed, notify_assigned, create_db_notification
from ...assignment import evaluate_rules
from ..automation import evaluate_automation_rules
from ...redis_client import get_redis as _get_redis
from .helpers import (
    STATUS_KO,
    VALID_TRANSITIONS,
    _apply_automation_actions,
    _attach_sla_deadlines,
    _can_requester_modify,
    _dispatch_notification,
    _extract_meta,
    _invalidate_ticket_list_cache,
    _issue_to_response,
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

        label_parts: list[str] = []
        if status_label:
            label_parts.append(status_label)
        if category:
            if category == "other":
                from ...models import ServiceType as _ST
                _other_cats = [
                    f"cat::{t.description}"
                    for t in db.query(_ST).filter(_ST.enabled == True).all()  # noqa: E712
                    if t.description and t.description != "other"
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
        _list_cache_key = (
            f"itsm:tickets:{project_id or ''}:v{_ver}:{role}:{_user_suffix}:"
            f"{state}:{category or ''}:{priority or ''}:{sla or ''}:"
            f"{search or ''}:{created_by_username or ''}:{page}:{per_page}:{sort_by}:{order}:"
            f"{created_after or ''}:{created_before or ''}"
        )
        if _r:
            _cached = _r.get(_list_cache_key)
            if _cached:
                return _json.loads(_cached)

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

            issues = gitlab_client.get_all_issues(
                state=gl_state, labels=labels, not_labels=not_labels,
                search=search, project_id=project_id,
                order_by=sort_by, sort=order,
                created_after=created_after, created_before=created_before,
                max_results=300,
            )
            filtered_issues = issues
            if role == "user":
                from .helpers import _get_issue_requester
                my_username = _user.get("username", "")
                filtered_issues = [
                    i for i in filtered_issues
                    if _get_issue_requester(i)[0] == my_username
                ]
            if created_by_username:
                from .helpers import _get_issue_requester
                filtered_issues = [
                    i for i in filtered_issues
                    if _get_issue_requester(i)[0] == created_by_username
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

        issues, total = gitlab_client.get_issues(
            state=gl_state, labels=labels, not_labels=not_labels,
            search=search, project_id=project_id, page=page, per_page=per_page,
            order_by=sort_by, sort=order,
            created_after=created_after, created_before=created_before,
        )
        tickets_page = [_issue_to_response(i, mask_pii=(role == "user")) for i in issues]
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

    labels = [f"cat::{data.category}", f"prio::{data.priority}", "status::open"]

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

    from ...tasks import send_ticket_notification
    _dispatch_notification(background_tasks, send_ticket_notification, notify_ticket_created, ticket)

    _invalidate_ticket_list_cache(data.project_id)

    return ticket


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

    if not is_developer:
        try:
            _pre_issue = gitlab_client.get_issue(iid, project_id=project_id)
        except Exception as e:
            logger.error("GitLab get_issue %d error: %s", iid, e)
            raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")
        if not _can_requester_modify(_pre_issue, user):
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
        issue = gitlab_client.get_issue(iid, project_id=project_id)

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

        add_labels: list[str] = []
        remove_labels: list[str] = []
        state_event = None

        if data.status is not None:
            allowed = VALID_TRANSITIONS.get(old_status, set())
            if data.status not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{STATUS_KO.get(old_status, old_status)}'에서 '{STATUS_KO.get(data.status, data.status)}'(으)로의 전환은 허용되지 않습니다.",
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
            for label in current_labels:
                if label.startswith("status::"):
                    remove_labels.append(label)
            if data.status == "closed":
                state_event = "close"
            elif data.status == "reopened":
                state_event = "reopen"
                add_labels.append("status::open")
            else:
                add_labels.append(f"status::{data.status.value}")

        if data.priority is not None:
            for label in current_labels:
                if label.startswith("prio::"):
                    remove_labels.append(label)
            add_labels.append(f"prio::{data.priority}")

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
            for label in current_labels:
                if label.startswith("cat::"):
                    remove_labels.append(label)
            add_labels.append(f"cat::{data.category}")

        updated = gitlab_client.update_issue(
            iid,
            add_labels=add_labels or None,
            remove_labels=remove_labels or None,
            state_event=state_event,
            project_id=project_id,
            assignee_id=data.assignee_id,
            title=new_title,
            description=new_description,
            milestone_id=data.milestone_id,
        )

        if data.status is not None and data.status != old_status:
            from_ko = STATUS_KO.get(old_status, old_status)
            to_ko = STATUS_KO.get(data.status, data.status)
            actor = user.get("name") or user.get("username", "담당자")
            note_body = f"🔄 **상태 변경**: {from_ko} → **{to_ko}** (by {actor})"
            try:
                gitlab_client.add_note(iid, note_body, project_id=project_id)
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
            f"🔁 이 티켓이 #{new_iid}로 복제됐습니다. (by {user.get('name', user.get('username', ''))})",
            project_id=pid,
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

    actor = user.get("name") or user.get("username", "?")

    try:
        source_notes = gitlab_client.get_notes(iid, project_id=pid)
        user_notes = [n for n in source_notes if not n.get("system", False)]
        if user_notes:
            header = f"**#{iid}에서 병합된 댓글 ({len(user_notes)}개)**\n\n---\n\n"
            combined = header + "\n\n---\n\n".join(
                f"**{n.get('author', {}).get('name', '?')}** ({n.get('created_at', '')[:10]}):\n{n.get('body', '')}"
                for n in user_notes
            )
            gitlab_client.add_note(target_iid, combined, project_id=pid)
    except Exception as e:
        logger.warning("Merge: failed to copy notes from #%s: %s", iid, e)

    try:
        gitlab_client.add_note(
            iid,
            f"🔀 이 티켓은 #{target_iid}로 병합됐습니다. (by {actor})\n\n"
            f"추가 문의는 #{target_iid}에서 이어서 처리됩니다.",
            project_id=pid,
        )
        gitlab_client.update_issue(iid, state_event="close", project_id=pid)
    except Exception as e:
        logger.warning("Merge: failed to close source #%s: %s", iid, e)

    try:
        gitlab_client.add_note(
            target_iid,
            f"🔀 #{iid} 티켓이 이 티켓으로 병합됐습니다. (by {actor})\n\n"
            f"**원본 제목:** {source.get('title', '')}",
            project_id=pid,
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
        actor = user.get("name") or user.get("username", "?")
        note = (
            f"⚙️ **파이프라인 트리거됨** (by {actor})\n\n"
            f"- **브랜치:** `{ref}`\n"
            f"- **파이프라인:** [{pipeline_id}]({pipeline_url})\n"
            f"- **상태:** {result.get('status', 'pending')}"
        )
        gitlab_client.add_note(iid, note, project_id=pid)
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
        return None
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
