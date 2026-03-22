"""Bulk operations endpoint."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ...audit import write_audit_log
from ...database import get_db
from ... import gitlab_client
from ...rbac import require_pl
from ...schemas import BulkUpdate
from .helpers import (
    VALID_TRANSITIONS,
    _invalidate_ticket_list_cache,
    _parse_labels,
)

logger = logging.getLogger(__name__)

bulk_router = APIRouter()


@bulk_router.post("/bulk", response_model=dict)
def bulk_update_tickets(
    request: Request,
    data: BulkUpdate,
    user: dict = Depends(require_pl),
    db: Session = Depends(get_db),
):
    """일괄 상태 변경 / 담당자 배정 — ThreadPoolExecutor로 병렬 처리."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: dict = {"success": [], "errors": []}

    def _process_one(iid: int) -> tuple[int, Exception | None]:
        """단일 티켓 처리. (iid, None) 성공 | (iid, exc) 실패."""
        try:
            issue = gitlab_client.get_issue(iid, project_id=data.project_id)
            current_labels = issue.get("labels", [])
            old_label_info = _parse_labels(current_labels)
            old_status = old_label_info["status"] if issue["state"] == "opened" else "closed"

            add_labels: list[str] = []
            remove_labels: list[str] = []
            state_event = None
            assignee_id = None

            if data.action == "close":
                if "closed" in VALID_TRANSITIONS.get(old_status, set()):
                    remove_labels = [lb for lb in current_labels if lb.startswith("status::")]
                    state_event = "close"
            elif data.action == "assign" and data.value:
                assignee_id = int(data.value)
            elif data.action == "set_priority" and data.value:
                remove_labels = [lb for lb in current_labels if lb.startswith("prio::")]
                add_labels.append(f"prio::{data.value}")
            elif data.action == "set_status" and data.value:
                new_status = data.value
                if new_status in VALID_TRANSITIONS.get(old_status, set()):
                    remove_labels = [lb for lb in current_labels if lb.startswith("status::")]
                    add_labels.append(f"status::{new_status}")
            elif data.action == "add_label" and data.value:
                if data.value not in current_labels:
                    add_labels.append(data.value)
            elif data.action == "remove_label" and data.value:
                if data.value in current_labels:
                    remove_labels.append(data.value)

            gitlab_client.update_issue(
                iid,
                add_labels=add_labels or None,
                remove_labels=remove_labels or None,
                state_event=state_event,
                project_id=data.project_id,
                assignee_id=assignee_id,
            )
            return iid, None
        except Exception as exc:
            return iid, exc

    max_workers = min(8, len(data.iids))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_process_one, iid): iid for iid in data.iids}
        for future in as_completed(futures):
            iid, exc = future.result()
            if exc is None:
                results["success"].append(iid)
                write_audit_log(
                    db, user, f"ticket.bulk.{data.action.value}", "ticket", str(iid),
                    new_value={"action": data.action.value, "value": data.value},
                    request=request,
                )
            else:
                results["errors"].append({"iid": iid, "error": str(exc)})

    if results["success"]:
        _invalidate_ticket_list_cache(data.project_id)
    return results
