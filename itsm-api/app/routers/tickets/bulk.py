"""Bulk operations endpoint."""
import logging

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ...audit import write_audit_log
from ...database import get_db
from ... import gitlab_client
from ...rbac import require_pl
from ...schemas import BulkUpdate
from .helpers import (
    VALID_TRANSITIONS,
    status_to_label,
    priority_to_label,
    _invalidate_ticket_list_cache,
    _parse_labels,
)

logger = logging.getLogger(__name__)

bulk_router = APIRouter()


def _classify_exc(exc: Exception) -> tuple[int, str]:
    """예외를 HTTP 상태 코드와 사용자 메시지로 변환."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code if exc.response is not None else 502
        if code == 404:
            return 404, "티켓을 찾을 수 없습니다."
        if code == 403:
            return 403, "권한이 없습니다."
        if code == 409:
            return 409, "상태가 충돌했습니다. 다시 시도하세요."
        return code, f"GitLab 오류 ({code})"
    if isinstance(exc, httpx.TimeoutException):
        return 504, "GitLab 응답 시간 초과"
    if isinstance(exc, httpx.RequestError):
        return 502, "GitLab 통신 오류"
    return 500, str(exc) or "알 수 없는 오류"


@bulk_router.post("/bulk", response_model=dict)
def bulk_update_tickets(
    request: Request,
    data: BulkUpdate,
    user: dict = Depends(require_pl),
    db: Session = Depends(get_db),
):
    """일괄 상태 변경 / 담당자 배정 — ThreadPoolExecutor로 병렬 처리.

    응답: {"success": [...], "errors": [{"iid", "code", "error"}], "summary": {...}}
    - 전체 성공: 200
    - 하나라도 실패: 207 Multi-Status (부분·전체 실패 모두 동일, body로 판단)

    207 고정 이유: 4xx/5xx 응답은 프론트 request()의 !ok 분기로 가 텍스트로
    문자열화되어 구조화된 errors 배열이 유실된다. 클라이언트는 summary.failed로 판단.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: dict = {"success": [], "errors": []}
    _gl_token = user.get("gitlab_token")

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
                add_labels.append(priority_to_label(data.value))
            elif data.action == "set_status" and data.value:
                new_status = data.value
                if new_status in VALID_TRANSITIONS.get(old_status, set()):
                    remove_labels = [lb for lb in current_labels if lb.startswith("status::")]
                    add_labels.append(status_to_label(new_status))
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
                gitlab_token=_gl_token,
            )
            return iid, None
        except Exception as exc:
            return iid, exc

    total = len(data.iids)
    max_workers = min(8, total or 1)
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
                code, msg = _classify_exc(exc)
                logger.warning("Bulk %s failed for ticket #%d: %s", data.action.value, iid, exc)
                results["errors"].append({"iid": iid, "code": code, "error": msg})

    if results["success"]:
        _invalidate_ticket_list_cache(data.project_id)

    succeeded = len(results["success"])
    failed = len(results["errors"])
    results["summary"] = {"total": total, "succeeded": succeeded, "failed": failed}

    # 실패가 하나라도 있으면 207 Multi-Status — 구조화된 errors/summary를 그대로 전달.
    # 이전에는 전체 실패 시 4xx/5xx로 응답해 프론트 request()가 텍스트로 에러 throw했고
    # 결과적으로 호출자가 errors 배열에 접근하지 못했다. (전체 실패도 207은 WebDAV 규약상
    # 유효하며, 2xx이므로 fetch `!res.ok` 분기로 가지 않는다.)
    if failed:
        return JSONResponse(status_code=207, content=results)
    return results
