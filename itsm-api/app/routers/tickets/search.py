"""Search, stats, requesters, upload, and proxy endpoints."""
import json as _json
import logging
import re as _re_shared
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from ...auth import get_current_user
from ...config import get_settings
from ... import gitlab_client
from ...redis_client import get_redis as _get_redis
from .helpers import (
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE,
    _detect_mime_from_bytes,
    _get_issue_requester,
    _is_issue_assigned_to_user,
    _scan_with_clamav,
    _stats_executor,
    _strip_image_metadata,
    _validate_magic_bytes,
    user_limiter,
    LIMIT_SEARCH,
    LIMIT_UPLOAD,
)

logger = logging.getLogger(__name__)

search_router = APIRouter()


@search_router.get("/search", response_model=list)
@(user_limiter.limit(LIMIT_SEARCH) if user_limiter else lambda f: f)
def search_tickets(
    request: Request,
    q: str = Query(..., min_length=2, description="검색어 (제목+설명 대상)"),
    project_id: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None, description="opened | closed"),
    per_page: int = Query(default=20, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """티켓 전문검색 — DB FTS(pg_trgm) 우선, 결과 없을 때 GitLab API 폴백."""
    from sqlalchemy import or_
    from ...models import TicketSearchIndex
    from ...database import SessionLocal

    def _format_db_rows(rows):
        out = []
        for row in rows:
            labels = row.labels_json or []
            status = next((lb[8:] for lb in labels if lb.startswith("status::")), "open")
            priority = next((lb[6:] for lb in labels if lb.startswith("prio::")), "medium")
            category = next((lb[5:] for lb in labels if lb.startswith("cat::")), "other")
            assignees = [{"username": row.assignee_username}] if row.assignee_username else []
            out.append({
                "iid": row.iid,
                "title": row.title,
                "status": status,
                "priority": priority,
                "category": category,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "assignees": assignees,
                "project_id": row.project_id,
            })
        return out

    # ── DB FTS 1차 시도 ────────────────────────────────────────────────
    try:
        with SessionLocal() as db:
            fts_q = db.query(TicketSearchIndex).filter(
                or_(
                    TicketSearchIndex.title.ilike(f"%{q}%"),
                    TicketSearchIndex.description_text.ilike(f"%{q}%"),
                )
            )
            if project_id:
                fts_q = fts_q.filter(TicketSearchIndex.project_id == project_id)
            if state:
                db_state = state if state in ("opened", "closed") else None
                if db_state:
                    fts_q = fts_q.filter(TicketSearchIndex.state == db_state)
            rows = fts_q.order_by(TicketSearchIndex.updated_at.desc()).limit(per_page).all()
            if rows:
                return _format_db_rows(rows)
    except Exception as exc:
        logger.warning("DB FTS search failed, falling back to GitLab: %s", exc)

    # ── GitLab API 폴백 ────────────────────────────────────────────────
    results = gitlab_client.search_issues(
        query=q,
        project_id=project_id,
        state=state,
        per_page=per_page,
    )
    output = []
    for issue in results:
        labels = issue.get("labels", [])
        status = next((lb[8:] for lb in labels if lb.startswith("status::")), "open")
        priority = next((lb[6:] for lb in labels if lb.startswith("prio::")), "medium")
        category = next((lb[5:] for lb in labels if lb.startswith("cat::")), "other")
        output.append({
            "iid": issue.get("iid"),
            "title": issue.get("title"),
            "status": status,
            "priority": priority,
            "category": category,
            "created_at": issue.get("created_at"),
            "updated_at": issue.get("updated_at"),
            "assignees": issue.get("assignees", []),
        })
    return output


@search_router.get("/stats", response_model=dict)
def get_ticket_stats(
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """티켓 상태별 통계 반환."""
    role = _user.get("role", "user")
    needs_in_memory = role in ("user", "developer")

    if needs_in_memory:
        _cache_key = f"itsm:stats:{project_id or ''}:{_user.get('sub', '')}"
    else:
        _cache_key = f"itsm:stats:{project_id or ''}"
    _r = _get_redis()
    if _r:
        _cached = _r.get(_cache_key)
        if _cached:
            return _json.loads(_cached)

    try:
        if needs_in_memory:
            issues = gitlab_client.get_all_issues(
                state="all", project_id=project_id,
            )
            if role == "user":
                my_username = _user.get("username", "")
                issues = [i for i in issues if _get_issue_requester(i)[0] == my_username]
            elif role == "developer":
                issues = [i for i in issues if _is_issue_assigned_to_user(i, _user)]

            def _count_in(state_val, label=None, not_label=None):
                count = 0
                for i in issues:
                    s = i.get("state", "")
                    lbls = i.get("labels", [])
                    if state_val == "all":
                        pass
                    elif state_val == "opened" and s != "opened":
                        continue
                    elif state_val == "closed" and s != "closed":
                        continue
                    if label and label not in lbls:
                        continue
                    if not_label:
                        blocked = [nl.strip() for nl in not_label.split(",")]
                        if any(b in lbls for b in blocked):
                            continue
                    count += 1
                return count

            _all_sl = "status::approved,status::in_progress,status::waiting,status::resolved,status::testing,status::ready_for_release,status::released"
            _result = {
                "all":              _count_in("all"),
                "open":             _count_in("opened", not_label=_all_sl),
                "approved":         _count_in("opened", label="status::approved"),
                "in_progress":      _count_in("opened", label="status::in_progress"),
                "waiting":          _count_in("opened", label="status::waiting"),
                "resolved":         _count_in("opened", label="status::resolved"),
                "testing":          _count_in("opened", label="status::testing"),
                "ready_for_release":_count_in("opened", label="status::ready_for_release"),
                "released":         _count_in("opened", label="status::released"),
                "closed":           _count_in("closed"),
            }
            if _r:
                _r.setex(_cache_key, 300, _json.dumps(_result))
            return _result

        def _count(state, labels=None, not_labels=None):
            _, total = gitlab_client.get_issues(
                state=state, labels=labels, not_labels=not_labels,
                per_page=1, page=1, project_id=project_id,
            )
            return total

        _all_sl = "status::approved,status::in_progress,status::waiting,status::resolved,status::testing,status::ready_for_release,status::released"
        f_all               = _stats_executor.submit(_count, "all")
        f_open              = _stats_executor.submit(_count, "opened", None, _all_sl)
        f_approved          = _stats_executor.submit(_count, "opened", "status::approved")
        f_in_progress       = _stats_executor.submit(_count, "opened", "status::in_progress")
        f_waiting           = _stats_executor.submit(_count, "opened", "status::waiting")
        f_resolved          = _stats_executor.submit(_count, "opened", "status::resolved")
        f_testing           = _stats_executor.submit(_count, "opened", "status::testing")
        f_ready_for_release = _stats_executor.submit(_count, "opened", "status::ready_for_release")
        f_released          = _stats_executor.submit(_count, "opened", "status::released")
        f_closed            = _stats_executor.submit(_count, "closed")
        _result = {
            "all":              f_all.result(),
            "open":             f_open.result(),
            "approved":         f_approved.result(),
            "in_progress":      f_in_progress.result(),
            "waiting":          f_waiting.result(),
            "resolved":         f_resolved.result(),
            "testing":          f_testing.result(),
            "ready_for_release":f_ready_for_release.result(),
            "released":         f_released.result(),
            "closed":           f_closed.result(),
        }

        try:
            from ...models import SLARecord
            from ...database import SessionLocal
            from datetime import datetime as _dt, timedelta as _td, timezone as _tz
            from sqlalchemy import or_, and_
            _now_naive = _dt.now(_tz.utc).replace(tzinfo=None)
            with SessionLocal() as _db:
                # SLA 초과: DB breached 플래그 OR deadline이 이미 지난 미해결 티켓
                _sla_over = _db.query(SLARecord).filter(
                    or_(
                        SLARecord.breached == True,  # noqa: E712
                        and_(
                            SLARecord.sla_deadline != None,  # noqa: E711
                            SLARecord.sla_deadline < _now_naive,
                            SLARecord.resolved_at == None,  # noqa: E711
                        ),
                    )
                ).count()
                # SLA 임박: 초과 아닌데 2시간 이내
                _sla_imminent = _db.query(SLARecord).filter(
                    SLARecord.breached == False,  # noqa: E712
                    SLARecord.sla_deadline != None,  # noqa: E711
                    SLARecord.sla_deadline >= _now_naive,
                    SLARecord.sla_deadline <= _now_naive + _td(hours=2),
                    SLARecord.resolved_at == None,  # noqa: E711
                ).count()
                _result["sla_over"]     = _sla_over
                _result["sla_imminent"] = _sla_imminent
        except Exception:
            _result["sla_over"]     = 0
            _result["sla_imminent"] = 0

        if _r:
            _r.setex(_cache_key, 300, _json.dumps(_result))
        return _result
    except Exception as e:
        logger.error("GitLab stats error: %s", e)
        raise HTTPException(status_code=502, detail="통계를 불러오는 중 오류가 발생했습니다.")


@search_router.get("/requesters", response_model=list)
def list_requesters(
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """신청자 목록 반환 (developer 이상 역할 전용)."""
    from ...rbac import ROLE_LEVELS
    role = _user.get("role", "user")
    if ROLE_LEVELS.get(role, 0) < ROLE_LEVELS["developer"]:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    _user_suffix = _user.get("sub", "") if role == "developer" else ""
    _cache_key = f"itsm:requesters:{project_id or ''}:{role}:{_user_suffix}"
    _r = _get_redis()
    if _r:
        _cached = _r.get(_cache_key)
        if _cached:
            return _json.loads(_cached)

    try:
        issues = gitlab_client.get_all_issues(
            state="all", project_id=project_id,
        )
        if role == "developer":
            issues = [i for i in issues if _is_issue_assigned_to_user(i, _user)]

        seen: set[str] = set()
        result = []
        for issue in issues:
            username, _ = _get_issue_requester(issue)
            if username and username not in seen and username != "root":
                seen.add(username)
                result.append({"username": username, "employee_name": username})

        if result:
            name_map = gitlab_client.get_users_by_usernames([r["username"] for r in result])
            for r in result:
                r["employee_name"] = name_map.get(r["username"], r["username"])

        sorted_result = sorted(result, key=lambda x: ((x["employee_name"] or "").lower(), x["username"]))
        if _r:
            _r.setex(_cache_key, 600, _json.dumps(sorted_result))
        return sorted_result
    except Exception as e:
        logger.error("list_requesters error: %s", e)
        raise HTTPException(status_code=502, detail="신청자 목록을 불러오는 중 오류가 발생했습니다.")


@search_router.post("/upload", response_model=dict)
@(user_limiter.limit(LIMIT_UPLOAD) if user_limiter else lambda f: f)
async def upload_attachment(
    request: Request,
    file: UploadFile = File(...),
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="파일 크기는 10MB를 초과할 수 없습니다.")
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="허용되지 않는 파일 형식입니다.")
    _validate_magic_bytes(content, mime)
    content = _strip_image_metadata(content, mime)
    _scan_with_clamav(content, file.filename or "file")

    # MinIO 우선 시도 — 설정 없으면 GitLab 폴백
    from ... import storage as _storage
    minio_result = _storage.upload_file(content, file.filename or "file", mime)
    if minio_result:
        url = minio_result["url"]
        name = file.filename or "file"
        markdown = f"![{name}]({url})" if mime.startswith("image/") else f"[{name}]({url})"
        return {
            "markdown": markdown,
            "url": url,
            "full_path": url,
            "proxy_path": url,
            "name": name,
            "storage": "minio",
            "object_name": minio_result.get("object_name", ""),
            "bucket": minio_result.get("bucket", ""),
        }

    pid = project_id or get_settings().GITLAB_PROJECT_ID
    try:
        result = gitlab_client.upload_file(
            pid,
            file.filename or "file",
            content,
            mime,
        )
        return {
            "markdown": result.get("markdown", ""),
            "url": result.get("url", ""),
            "full_path": result.get("full_path", ""),
            "proxy_path": result.get("proxy_path", result.get("full_path", "")),
            "name": file.filename,
            "storage": "gitlab",
        }
    except Exception as e:
        logger.error("File upload failed: %s", e)
        raise HTTPException(status_code=502, detail="파일 업로드에 실패했습니다.")


@search_router.get("/uploads/proxy")
def proxy_upload(
    path: str = Query(..., description="GitLab upload path"),
    download: bool = Query(default=False),
    _user: dict = Depends(get_current_user),
):
    """GitLab 업로드 파일을 파일시스템에서 직접 읽어 인증된 사용자에게 제공."""
    import hashlib, os, mimetypes
    settings = get_settings()

    project_id: str | None = None
    upload_id: str | None = None
    filename: str | None = None

    m1 = _re_shared.match(r"^/-/project/(\d+)/uploads/([0-9a-f]+)/([^/]+)$", path)
    if m1:
        project_id, upload_id, filename = m1.group(1), m1.group(2), m1.group(3)
    else:
        m2 = _re_shared.match(r"^(/[^/]+/[^/]+)/uploads/([0-9a-f]+)/([^/]+)$", path)
        if m2:
            upload_id, filename = m2.group(2), m2.group(3)
            ns_path = m2.group(1).lstrip("/")
            try:
                with httpx.Client(timeout=10) as c:
                    pr = c.get(
                        f"{settings.GITLAB_API_URL}/api/v4/projects/{ns_path.replace('/', '%2F')}",
                        headers={"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN},
                    )
                    if pr.is_success:
                        project_id = str(pr.json().get("id", ""))
            except Exception as e:
                logger.warning("Failed to resolve project namespace for proxy: %s", e)

    if project_id and upload_id and filename:
        from urllib.parse import unquote as _unquote
        decoded_filename = _unquote(filename)
        safe_filename = os.path.basename(decoded_filename)
        if not safe_filename or safe_filename != decoded_filename:
            raise HTTPException(status_code=400, detail="잘못된 파일명입니다.")

        sha256 = hashlib.sha256(project_id.encode()).hexdigest()
        base_dir = "/gitlab_data/gitlab-rails/uploads/@hashed"
        fs_path = os.path.normpath(
            os.path.join(base_dir, sha256[:2], sha256[2:4], sha256, upload_id, safe_filename)
        )
        if not fs_path.startswith(base_dir + os.sep):
            raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")

        content_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
        # L3: inline 허용 MIME allowlist — 외부 allowlist에 없는 타입은 attachment 강제
        # HTML/JS/SVG inline 제공 시 Stored XSS 위험
        _INLINE_SAFE_MIMES = frozenset({
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "image/avif", "application/pdf",
        })
        force_download = download or (content_type not in _INLINE_SAFE_MIMES)

        def _make_disposition(fname: str, attach: bool) -> str:
            if not attach:
                return "inline"
            from urllib.parse import quote as _q
            try:
                fname.encode("latin-1")
                return f'attachment; filename="{fname.replace(chr(34), "_")}"'
            except UnicodeEncodeError:
                encoded = _q(fname, safe="")
                return f"attachment; filename*=UTF-8''{encoded}"

        disposition = _make_disposition(safe_filename, force_download)

        actual_path = fs_path
        if not os.path.isfile(actual_path):
            upload_dir = os.path.dirname(fs_path)
            if os.path.isdir(upload_dir):
                entries = [e for e in os.listdir(upload_dir) if os.path.isfile(os.path.join(upload_dir, e))]
                if len(entries) == 1:
                    actual_path = os.path.join(upload_dir, entries[0])
                    content_type = mimetypes.guess_type(entries[0])[0] or content_type
                    force_download = download or (content_type not in _INLINE_SAFE_MIMES)
                    disposition = _make_disposition(entries[0], force_download)

        if os.path.isfile(actual_path):
            with open(actual_path, "rb") as f:
                return Response(
                    content=f.read(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": disposition,
                        "Cache-Control": "private, max-age=3600",
                    },
                )

        from urllib.parse import quote as _url_quote
        encoded_filename = _url_quote(safe_filename, safe='')
        gitlab_url = f"{settings.GITLAB_API_URL}/-/project/{project_id}/uploads/{upload_id}/{encoded_filename}"
        oauth_token = _user.get("gitlab_token") if _user else None
        auth_headers_list = []
        if oauth_token:
            auth_headers_list.append({"Authorization": f"Bearer {oauth_token}"})
        auth_headers_list.append({"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN})
        try:
            with httpx.Client(timeout=30, follow_redirects=True) as c:
                for auth_headers in auth_headers_list:
                    r = c.get(gitlab_url, headers=auth_headers)
                    ct_resp = r.headers.get("content-type", "")
                    if r.status_code == 200 and "text/html" not in ct_resp:
                        return Response(
                            content=r.content,
                            media_type=content_type,
                            headers={
                                "Content-Disposition": disposition,
                                "Cache-Control": "private, max-age=3600",
                            },
                        )
        except Exception as e:
            logger.warning("GitLab HTTP proxy fallback failed: %s", e)

    raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
