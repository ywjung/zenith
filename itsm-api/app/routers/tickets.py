import asyncio
import json as _json
import logging
import re as _re_shared
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from typing import AsyncGenerator
from typing import Optional
import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from ..auth import get_current_user
from ..audit import write_audit_log
from ..config import get_settings
from ..database import get_db
from ..schemas import TicketCreate, TicketResponse, CommentResponse, TicketUpdate, CommentCreate, BulkUpdate, SLARecordResponse
from .. import gitlab_client
from ..rbac import require_developer, require_agent, require_admin
from .. import sla as sla_module
from ..models import SLARecord, AuditLog
from ..notifications import (
    notify_ticket_created,
    notify_status_changed,
    notify_comment_added,
    notify_assigned,
    create_db_notification,
)
from ..assignment import evaluate_rules
from ..rate_limit import user_limiter, LIMIT_TICKET_CREATE, LIMIT_UPLOAD

def _get_redis():
    """Redis 클라이언트 반환. 연결 실패 시 None."""
    try:
        import redis as _redis
        r = _redis.from_url(get_settings().REDIS_URL, socket_connect_timeout=1, decode_responses=True)
        r.ping()
        return r
    except Exception:
        return None


def _invalidate_ticket_list_cache(project_id: Optional[str] = None) -> None:
    """티켓 목록 캐시 버전을 증가 + 구 버전 캐시 키를 즉시 삭제한다.

    버전 키를 올리는 것만으로는 이전 버전 키가 TTL 만료까지 Redis 메모리에 남는다.
    _r.delete()로 실제 구 키를 제거해 메모리 낭비를 방지한다.
    """
    _r = _get_redis()
    if _r:
        ver_key = f"itsm:tickets:v:{project_id or 'all'}"
        # 구 버전 캐시 키 삭제 (버전 올리기 전에 패턴 수집)
        pid_part = project_id or ''
        old_keys = _r.keys(f"itsm:tickets:{pid_part}:v*")
        if old_keys:
            _r.delete(*old_keys)
        _r.incr(ver_key)
        _r.expire(ver_key, 3600)
        # stats/requesters 캐시도 무효화 (프로젝트별)
        stat_keys = _r.keys(f"itsm:stats:{pid_part}*")
        if stat_keys:
            _r.delete(*stat_keys)


MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    # SVG는 <script> 태그를 포함할 수 있는 XML이므로 업로드 허용하지 않음 (C-1 XSS)
    "application/pdf",
    "text/plain", "text/csv",
    "application/zip", "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# S-2: Magic bytes signatures for allowed types
_MAGIC_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),  # RIFF....WEBP
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),  # ZIP / docx / xlsx / pptx
    (b"\xd0\xcf\x11\xe0", "application/msword"),  # OLE2 (doc/xls/ppt)
]


def _detect_mime_from_bytes(data: bytes) -> str | None:
    """Detect MIME type from magic bytes. Returns None if unknown."""
    for sig, mime in _MAGIC_SIGNATURES:
        if data[:len(sig)] == sig:
            # Special: RIFF must contain WEBP at offset 8
            if sig == b"RIFF":
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return mime
                return None
            return mime
    # Try python-magic if available (optional)
    try:
        import magic as _magic
        return _magic.from_buffer(data[:2048], mime=True)
    except ImportError:
        pass
    return None


def _validate_magic_bytes(content: bytes, declared_mime: str) -> None:
    """Raise 400 if magic bytes don't match an allowed type. S-2."""
    detected = _detect_mime_from_bytes(content)
    if detected is None:
        # Unknown magic bytes — allow plain text (no specific magic)
        # but block executable-like content
        _EXECUTABLE_PATTERNS = [b"MZ", b"\x7fELF", b"#!/"]
        for pat in _EXECUTABLE_PATTERNS:
            if content[:len(pat)] == pat:
                raise HTTPException(status_code=400, detail="허용되지 않는 파일 형식입니다. (실행 파일)")
        return
    # ZIP container covers docx/xlsx/pptx
    ZIP_MIMES = {
        "application/zip", "application/x-zip-compressed",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
    # OLE2 covers doc/xls/ppt
    OLE2_MIMES = {
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
    }
    if detected == "application/zip" and declared_mime in ZIP_MIMES:
        return
    if detected == "application/msword" and declared_mime in OLE2_MIMES:
        return
    if detected not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"파일 내용이 선언된 형식과 다릅니다. (감지: {detected})")

def _strip_image_metadata(content: bytes, mime: str) -> bytes:
    """이미지에서 EXIF 메타데이터를 제거하고 리인코딩.

    GPS 좌표, 기기 정보, 작성자 등 민감 정보를 제거한다.
    Pillow 미설치 시 원본 반환 (fail-open).
    """
    _STRIPPABLE = {"image/jpeg", "image/png", "image/webp"}
    if mime not in _STRIPPABLE:
        return content
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(content))
        # RGBA → RGB 변환 (JPEG는 알파채널 미지원)
        if mime == "image/jpeg" and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        out = _io.BytesIO()
        fmt = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[mime]
        img.save(out, format=fmt, quality=92, optimize=True)
        cleaned = out.getvalue()
        logger.info("EXIF stripped: %s (%d→%d bytes)", mime, len(content), len(cleaned))
        return cleaned
    except Exception as e:
        logger.warning("EXIF strip failed (fail-open): %s — %s", mime, e)
        return content


def _scan_with_clamav(content: bytes, filename: str) -> None:
    """ClamAV TCP 소켓으로 바이러스 스캔. 위협 탐지 시 400 raise.

    ClamAV 미설치/연결 실패 시 경고 로그만 남기고 통과(fail-open).
    CLAMAV_ENABLED=false 환경변수로 비활성화 가능.
    """
    settings = get_settings()
    if not getattr(settings, "CLAMAV_ENABLED", True):
        return
    host = getattr(settings, "CLAMAV_HOST", "clamav")
    port = int(getattr(settings, "CLAMAV_PORT", 3310))
    try:
        import socket as _sock
        import io
        # clamd TCP 프로토콜: INSTREAM 명령
        with _sock.create_connection((host, port), timeout=5) as s:
            s.sendall(b"nINSTREAM\n")
            # 4바이트 빅엔디안 청크 크기 + 데이터
            chunk_size = len(content)
            s.sendall(chunk_size.to_bytes(4, "big") + content)
            s.sendall(b"\x00\x00\x00\x00")  # 종료 청크
            response = s.recv(1024).decode("utf-8", errors="replace").strip()
        if "OK" not in response:
            logger.error("ClamAV threat detected in %s: %s", filename, response)
            raise HTTPException(status_code=400, detail=f"파일에서 악성코드가 감지됐습니다: {response}")
        logger.debug("ClamAV scan passed: %s", filename)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("ClamAV scan skipped (fail-open): %s — %s", filename, e)


router = APIRouter(prefix="/tickets", tags=["tickets"])

CATEGORY_MAP = {
    "hardware": "하드웨어",
    "software": "소프트웨어",
    "network": "네트워크",
    "account": "계정/권한",
    "other": "기타",
}

PRIORITY_MAP = {
    "low": "낮음",
    "medium": "보통",
    "high": "높음",
    "critical": "긴급",
}

STATUS_KO = {
    "open": "접수됨",
    "in_progress": "처리 중",
    "waiting": "추가정보 대기 중",
    "resolved": "처리 완료",
    "closed": "종료됨",
    "reopened": "재개됨",
}

# 허용된 워크플로우 전환 (from → set of valid to)
VALID_TRANSITIONS: dict[str, set[str]] = {
    "open":        {"in_progress", "waiting", "closed"},
    "in_progress": {"resolved", "waiting", "closed"},
    "waiting":     {"in_progress", "closed"},
    "resolved":    {"in_progress", "closed"},
    "closed":      {"reopened"},
}


def _parse_labels(labels: list[str]) -> dict:
    result = {"category": None, "priority": "medium", "status": "open"}
    for label in labels:
        if label.startswith("cat::"):
            result["category"] = label[5:]
        elif label.startswith("prio::"):
            raw = label[6:]
            # Python str Enum f-string 포맷팅 버그로 저장된 corrupt 라벨 정규화
            # 예: "PriorityEnum.MEDIUM" → "medium"
            if "." in raw and raw[0].isupper():
                raw = raw.split(".")[-1].lower()
            result["priority"] = raw
        elif label.startswith("status::"):
            raw = label[8:]
            # 예: "StatusEnum.IN_PROGRESS" → "in_progress"
            if "." in raw and raw[0].isupper():
                raw = raw.split(".")[-1].lower()
            result["status"] = raw
    return result


def _extract_meta(description: str) -> dict:
    """이슈 설명에서 신청자 정보 추출."""
    meta = {
        "employee_name": None,
        "employee_email": None,
        "department": None,
        "location": None,
        "created_by_username": None,
        "body": description,
    }
    lines = description.split("\n")
    body_lines = []
    in_meta = True
    for line in lines:
        if line.startswith("**신청자:**"):
            meta["employee_name"] = line.replace("**신청자:**", "").strip()
        elif line.startswith("**이메일:**"):
            meta["employee_email"] = line.replace("**이메일:**", "").strip()
        elif line.startswith("**부서:**"):
            meta["department"] = line.replace("**부서:**", "").strip()
        elif line.startswith("**위치:**"):
            meta["location"] = line.replace("**위치:**", "").strip()
        elif line.startswith("**작성자:**"):
            meta["created_by_username"] = line.replace("**작성자:**", "").strip()
        elif line.strip() == "---":
            in_meta = False
        elif not in_meta:
            body_lines.append(line)
    meta["body"] = "\n".join(body_lines).strip()
    return meta


def _issue_to_response(issue: dict) -> dict:
    import re as _re
    label_info = _parse_labels(issue.get("labels", []))
    meta = _extract_meta(issue.get("description") or "")
    author = issue.get("author") or {}
    author_username = author.get("username")
    status = label_info["status"] if issue["state"] == "opened" else "closed"

    assignees = issue.get("assignees", [])
    assignee = assignees[0] if assignees else None

    web_url = issue.get("web_url", "")
    project_path = ""
    m = _re.search(r"://[^/]+/(.+?)/-/issues/", web_url)
    if m:
        project_path = m.group(1)

    return {
        "iid": issue["iid"],
        "title": issue["title"],
        "description": meta["body"],
        "state": issue["state"],
        "labels": issue.get("labels", []),
        "created_at": issue["created_at"],
        "updated_at": issue["updated_at"],
        "web_url": issue["web_url"],
        "employee_name": meta["employee_name"],
        "employee_email": meta["employee_email"],
        "department": meta["department"],
        "location": meta["location"],
        "created_by_username": meta["created_by_username"] or author_username,
        "category": label_info["category"],
        "priority": label_info["priority"],
        "status": status,
        "project_id": str(issue.get("project_id", "")),
        "assignee_id": assignee["id"] if assignee else None,
        "assignee_name": assignee["name"] if assignee else None,
        "assignee_username": assignee["username"] if assignee else None,
        "project_path": project_path,
    }


def _attach_sla_deadlines(tickets: list[dict], db: Session) -> None:
    """tickets 리스트에 sla_deadline 값을 인-플레이스로 추가한다 (배치 조회)."""
    if not tickets:
        return
    # project_id별로 iid 목록을 모아 배치 조회
    from collections import defaultdict
    by_project: dict[str, list[int]] = defaultdict(list)
    for t in tickets:
        pid = t.get("project_id") or ""
        if pid:
            by_project[pid].append(t["iid"])

    # {(iid, project_id): sla_deadline_iso} 매핑
    sla_map: dict[tuple[int, str], str | None] = {}
    for pid, iids in by_project.items():
        rows = (
            db.query(SLARecord)
            .filter(SLARecord.project_id == pid, SLARecord.gitlab_issue_iid.in_(iids))
            .all()
        )
        for row in rows:
            sla_map[(row.gitlab_issue_iid, pid)] = (
                row.sla_deadline.isoformat() if row.sla_deadline else None
            )

    for t in tickets:
        key = (t["iid"], t.get("project_id") or "")
        t["sla_deadline"] = sla_map.get(key)


def _get_issue_requester(issue: dict) -> tuple[str, str]:
    """이슈에서 신청자 식별값(username)과 표시명(name)을 반환한다.

    모든 티켓이 admin 토큰으로 생성되므로 author.username은 항상 admin이다.
    실제 신청자는 description 메타데이터(**작성자:**)에 저장돼 있으므로 이를 우선한다.
    """
    meta = _extract_meta(issue.get("description") or "")
    author = issue.get("author") or {}
    username = meta.get("created_by_username") or author.get("username") or ""
    name = meta.get("employee_name") or author.get("name") or username
    return username, name


def _can_requester_modify(issue: dict, user: dict) -> bool:
    """티켓이 '접수됨(open)' 상태이고 현재 사용자가 작성자인지 확인한다."""
    label_info = _parse_labels(issue.get("labels", []))
    status = label_info["status"] if issue["state"] == "opened" else "closed"
    if status != "open":
        return False
    requester_username, _ = _get_issue_requester(issue)
    return bool(requester_username) and requester_username == user.get("username", "")


def _is_issue_assigned_to_user(issue: dict, user: dict) -> bool:
    """이슈가 현재 사용자에게 배정됐는지 확인한다 (id/username 모두 지원)."""
    assignees = issue.get("assignees") or []
    if not assignees:
        return False

    my_id = str(user.get("sub", "") or "")
    my_username = user.get("username", "") or ""

    for assignee in assignees:
        assignee_id = str(assignee.get("id", "") or "")
        assignee_username = assignee.get("username", "") or ""
        if my_id and assignee_id == my_id:
            return True
        if my_username and assignee_username == my_username:
            return True
    return False


@router.get("/search", response_model=list)
def search_tickets(
    q: str = Query(..., min_length=2, description="검색어 (제목+설명 대상)"),
    project_id: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None, description="opened | closed"),
    per_page: int = Query(default=20, le=50),
    user: dict = Depends(get_current_user),
):
    """티켓 전문검색 — GitLab 이슈 검색 API 활용."""
    results = gitlab_client.search_issues(
        query=q,
        project_id=project_id,
        state=state,
        per_page=per_page,
    )
    # 필요한 필드만 추출해 반환
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


@router.get("/stats", response_model=dict)
def get_ticket_stats(
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """티켓 상태별 통계 반환.

    user/developer 역할은 전체 이슈를 in-memory 필터링해 본인 관련 수만 반환한다.
    """
    role = _user.get("role", "user")
    needs_in_memory = role in ("user", "developer")

    # 개인별(user/developer) 또는 프로젝트별(agent/admin) Redis 캐시 (TTL 60초)
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

            _result = {
                "all": _count_in("all"),
                "open": _count_in("opened", not_label="status::in_progress,status::waiting,status::resolved"),
                "in_progress": _count_in("opened", label="status::in_progress"),
                "resolved": _count_in("opened", label="status::resolved"),
                "closed": _count_in("closed"),
            }
            if _r:
                _r.setex(_cache_key, 300, _json.dumps(_result))
            return _result

        from concurrent.futures import ThreadPoolExecutor

        def _count(state, labels=None, not_labels=None):
            _, total = gitlab_client.get_issues(
                state=state, labels=labels, not_labels=not_labels,
                per_page=1, page=1, project_id=project_id,
            )
            return total

        with ThreadPoolExecutor(max_workers=5) as pool:
            f_all         = pool.submit(_count, "all")
            f_open        = pool.submit(_count, "opened", None, "status::in_progress,status::waiting,status::resolved")
            f_in_progress = pool.submit(_count, "opened", "status::in_progress")
            f_resolved    = pool.submit(_count, "opened", "status::resolved")
            f_closed      = pool.submit(_count, "closed")
            _result = {
                "all":         f_all.result(),
                "open":        f_open.result(),
                "in_progress": f_in_progress.result(),
                "resolved":    f_resolved.result(),
                "closed":      f_closed.result(),
            }
            if _r:
                _r.setex(_cache_key, 300, _json.dumps(_result))
            return _result
    except Exception as e:
        logger.error("GitLab stats error: %s", e)
        raise HTTPException(status_code=502, detail="통계를 불러오는 중 오류가 발생했습니다.")


@router.get("/requesters", response_model=list)
def list_requesters(
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """신청자 목록 반환 (developer 이상 역할 전용)."""
    from ..rbac import ROLE_LEVELS
    role = _user.get("role", "user")
    if ROLE_LEVELS.get(role, 0) < ROLE_LEVELS["developer"]:
        raise HTTPException(status_code=403, detail="권한이 없습니다.")

    # Redis 캐시 (5분 TTL)
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

        # GitLab 실명으로 교체
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


@router.get("/", response_model=dict)
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
    _user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        gl_state = "all"
        status_label: Optional[str] = None
        not_labels: Optional[str] = None

        if state == "open":
            gl_state = "opened"
            not_labels = "status::in_progress,status::waiting,status::resolved"
        elif state == "in_progress":
            gl_state = "opened"
            status_label = "status::in_progress"
        elif state == "active":
            gl_state = "opened"
            not_labels = "status::resolved"
        elif state == "resolved":
            gl_state = "opened"
            status_label = "status::resolved"
        elif state == "closed":
            gl_state = "closed"

        label_parts: list[str] = []
        if status_label:
            label_parts.append(status_label)
        if category:
            if category == "other":
                # "기타" 카테고리: 명시적 cat:: 라벨이 없는 티켓 포함
                # → 알려진 다른 카테고리를 not_labels로 제외
                from ..database import SessionLocal as _SL
                from ..models import ServiceType as _ST
                with _SL() as _db:
                    _other_cats = [
                        f"cat::{t.description}"
                        for t in _db.query(_ST).filter(_ST.enabled == True).all()  # noqa: E712
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

        # Redis 캐시 (30초 TTL) — 버전 키로 즉시 무효화 가능
        _user_suffix = _user.get("sub", "") if role in ("user", "developer") else ""
        _r = _get_redis()
        _ver = int(_r.get(f"itsm:tickets:v:{project_id or 'all'}") or 0) if _r else 0
        _list_cache_key = (
            f"itsm:tickets:{project_id or ''}:v{_ver}:{role}:{_user_suffix}:"
            f"{state}:{category or ''}:{priority or ''}:{sla or ''}:"
            f"{search or ''}:{created_by_username or ''}:{page}:{per_page}:{sort_by}:{order}"
        )
        if _r:
            _cached = _r.get(_list_cache_key)
            if _cached:
                return _json.loads(_cached)

        # in-memory filter conditions
        needs_in_memory = False
        if role in ("user", "developer"):
            needs_in_memory = True
        if created_by_username:
            needs_in_memory = True
        if sla:
            needs_in_memory = True

        if needs_in_memory:
            issues = gitlab_client.get_all_issues(
                state=gl_state, labels=labels, not_labels=not_labels,
                search=search, project_id=project_id,
                order_by=sort_by, sort=order,
            )
            filtered_issues = issues
            if role == "user":
                my_username = _user.get("username", "")
                filtered_issues = [
                    i for i in filtered_issues
                    if _get_issue_requester(i)[0] == my_username
                ]
            elif role == "developer":
                filtered_issues = [
                    i for i in filtered_issues
                    if _is_issue_assigned_to_user(i, _user)
                ]
            if created_by_username:
                filtered_issues = [
                    i for i in filtered_issues
                    if _get_issue_requester(i)[0] == created_by_username
                ]

            all_tickets = [_issue_to_response(i) for i in filtered_issues]

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
        )
        tickets_page = [_issue_to_response(i) for i in issues]
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


@router.post("/upload", response_model=dict)
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
    # S-2: Magic bytes validation
    _validate_magic_bytes(content, mime)
    # S-8: 이미지 EXIF 메타데이터 제거 (개인정보 보호)
    content = _strip_image_metadata(content, mime)
    # S-7: ClamAV 바이러스 스캔
    _scan_with_clamav(content, file.filename or "file")
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
        }
    except Exception as e:
        logger.error("File upload failed: %s", e)
        raise HTTPException(status_code=502, detail="파일 업로드에 실패했습니다.")


@router.get("/uploads/proxy")
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
        # URL-decode filename once more to handle double-encoding
        # (frontend encodeURIComponent on already-encoded Korean paths → %25E1... → %E1... → 한글)
        from urllib.parse import unquote as _unquote
        decoded_filename = _unquote(filename)
        # Sanitize filename — strip any path components
        safe_filename = os.path.basename(decoded_filename)
        if not safe_filename or safe_filename != decoded_filename:
            raise HTTPException(status_code=400, detail="잘못된 파일명입니다.")

        sha256 = hashlib.sha256(project_id.encode()).hexdigest()
        base_dir = "/gitlab_data/gitlab-rails/uploads/@hashed"
        fs_path = os.path.normpath(
            os.path.join(base_dir, sha256[:2], sha256[2:4], sha256, upload_id, safe_filename)
        )
        # Prevent path traversal: ensure resolved path stays within base_dir
        if not fs_path.startswith(base_dir + os.sep):
            raise HTTPException(status_code=400, detail="잘못된 파일 경로입니다.")

        if os.path.isfile(fs_path):
            content_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
            safe_cd_name = safe_filename.replace('"', '_')
            # SVG는 브라우저에서 스크립트를 실행할 수 있으므로 항상 다운로드 강제 (C-1)
            force_download = download or content_type == "image/svg+xml"
            disposition = f'attachment; filename="{safe_cd_name}"' if force_download else "inline"
            with open(fs_path, "rb") as f:
                return Response(
                    content=f.read(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": disposition,
                        "Cache-Control": "private, max-age=3600",
                    },
                )

    raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")


@router.get("/export/csv")
def export_tickets_csv(
    state: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
):
    """현재 필터 기준 티켓 목록을 CSV로 내보낸다 (agent 이상)."""
    import csv
    import io
    from fastapi.responses import StreamingResponse as _StreamingResponse
    from datetime import date as _date

    labels = []
    if state and state != "all":
        if state == "closed":
            gl_state = "closed"
        else:
            labels.append(f"status::{state}")
            gl_state = "opened"
    else:
        gl_state = "all"
    if category:
        labels.append(f"cat::{category}")
    if priority:
        labels.append(f"prio::{priority}")

    label_str = ",".join(labels) if labels else None
    issues = gitlab_client.get_all_issues(
        state=gl_state, labels=label_str, search=search,
        project_id=project_id,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["번호", "제목", "상태", "우선순위", "카테고리", "신청자", "담당자", "생성일", "수정일"])

    for issue in issues:
        ticket = _issue_to_response(issue)
        writer.writerow([
            ticket.get("iid"),
            ticket.get("title"),
            ticket.get("status"),
            ticket.get("priority"),
            ticket.get("category"),
            ticket.get("employee_name"),
            ticket.get("assignee_name"),
            ticket.get("created_at", "")[:10] if ticket.get("created_at") else "",
            ticket.get("updated_at", "")[:10] if ticket.get("updated_at") else "",
        ])

    output.seek(0)
    filename = f"tickets_{_date.today().isoformat()}.csv"
    return _StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/", response_model=dict, status_code=201)
@(user_limiter.limit(LIMIT_TICKET_CREATE) if user_limiter else lambda f: f)
def create_ticket(
    request: Request,
    data: TicketCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # S-9: 비밀 스캐닝 — 제목·설명에서 민감 정보 탐지 (경고만, 차단 안 함)
    from ..secret_scanner import check_and_warn
    _scan_text = f"{data.title}\n{data.description or ''}"
    check_and_warn(_scan_text, context=f"ticket.create", actor=user.get("username", "?"))

    gitlab_client.ensure_labels(data.project_id)

    labels = [f"cat::{data.category}", f"prio::{data.priority}", "status::open"]

    meta_lines = [
        f"**신청자:** {data.employee_name}",
        f"**이메일:** {data.employee_email}",
        f"**작성자:** {user['username']}",
    ]
    if data.department:
        meta_lines.append(f"**부서:** {data.department}")
    if data.location:
        meta_lines.append(f"**위치:** {data.location}")
    meta_lines.extend(["", "---", "", data.description])
    description = "\n".join(meta_lines)

    # Auto-assign if no assignee specified
    assignee_id = data.assignee_id
    if not assignee_id:
        assignee_id = evaluate_rules(db, data.category, data.priority, data.title)

    try:
        issue = gitlab_client.create_issue(
            data.title, description, labels,
            project_id=data.project_id,
            assignee_id=assignee_id,
            confidential=data.confidential,
        )
    except Exception as e:
        logger.error("GitLab create_issue error: %s", e)
        raise HTTPException(status_code=502, detail="티켓 생성 중 오류가 발생했습니다.")

    ticket = _issue_to_response(issue)

    # SLA record
    pid = data.project_id or get_settings().GITLAB_PROJECT_ID
    try:
        sla_module.create_sla_record(db, ticket["iid"], pid, data.priority, custom_deadline=data.sla_due_date)
    except Exception as e:
        logger.warning("SLA record creation failed for ticket %d: %s", ticket["iid"], e)

    # Audit
    write_audit_log(
        db, user, "ticket.create", "ticket", str(ticket["iid"]),
        new_value={"title": data.title, "priority": data.priority, "category": data.category},
        request=request,
    )

    # Notifications (background)
    background_tasks.add_task(notify_ticket_created, ticket)

    # 캐시 무효화
    _invalidate_ticket_list_cache(data.project_id)

    return ticket


def _sla_to_dict(record) -> dict:
    return SLARecordResponse.model_validate(record).model_dump()



@router.get("/{iid}/linked-mrs")
def get_linked_mrs(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),  # G-2: agent 이상만 조회 가능
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


@router.get("/{iid}/sla")
def get_ticket_sla(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_developer),
):
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    record = sla_module.get_sla_record(db, iid, pid)
    if not record:
        raise HTTPException(status_code=404, detail="SLA 레코드를 찾을 수 없습니다.")
    return _sla_to_dict(record)


@router.patch("/{iid}/sla")
def update_ticket_sla(
    iid: int,
    body: dict,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
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
    record.breached = False  # 기한 변경 시 위반 상태 초기화
    db.commit()
    return _sla_to_dict(record)


@router.get("/{iid}", response_model=dict)
def get_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
        ticket = _issue_to_response(issue)
        # 신청자 이름을 GitLab 실명으로 교체
        creator = ticket.get("created_by_username")
        if creator:
            name_map = gitlab_client.get_users_by_usernames([creator])
            if creator in name_map:
                ticket["employee_name"] = name_map[creator]
        return ticket
    except Exception as e:
        logger.error("GitLab get_ticket %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 조회 중 오류가 발생했습니다.")


@router.post("/{iid}/clone", response_model=dict, status_code=201)
def clone_ticket(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """티켓 복제 — 제목·카테고리·우선순위·본문을 복사해 새 티켓을 생성한다.

    복제된 티켓은 원본과 'related' 링크로 자동 연결된다.
    """
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

    # 원본과 related 링크 자동 연결
    try:
        from ..models import TicketLink
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

    # 원본 티켓에 복제 알림 댓글
    try:
        gitlab_client.add_note(
            iid,
            f"🔁 이 티켓이 #{new_iid}로 복제됐습니다. (by {user.get('name', user.get('username', ''))})",
            project_id=pid,
        )
    except Exception:
        pass

    return _issue_to_response(new_issue)


@router.delete("/{iid}", status_code=204)
def delete_ticket(
    request: Request,
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..rbac import ROLE_LEVELS
    role = user.get("role", "user")
    is_admin = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["admin"]

    if not is_admin:
        # 관리자가 아닌 경우 작성자 + open 상태 체크
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
        gitlab_client.delete_issue(iid, project_id=project_id)
    except Exception as e:
        logger.error("GitLab delete_issue %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 삭제 중 오류가 발생했습니다.")

    write_audit_log(db, user, "ticket.delete", "ticket", str(iid), request=request)


@router.patch("/{iid}", response_model=dict)
def update_ticket(
    request: Request,
    iid: int,
    data: TicketUpdate,
    background_tasks: BackgroundTasks,
    project_id: Optional[str] = Query(default=None),
    if_match: Optional[str] = Header(default=None, alias="If-Match"),  # 낙관적 락 ETag
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..rbac import ROLE_LEVELS
    role = user.get("role", "user")
    is_developer = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["developer"]
    is_agent = ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["agent"]

    if not is_developer:
        # developer 미만 — 작성자 + open 상태인지 확인
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
        # 소유자는 상태/우선순위/담당자 변경 불가
        if data.status is not None or data.priority is not None or data.assignee_id is not None:
            raise HTTPException(
                status_code=403,
                detail="상태·우선순위·담당자 변경은 IT 담당자만 가능합니다.",
            )

    # 담당자 변경은 agent 이상만 가능
    if data.assignee_id is not None and not is_agent:
        raise HTTPException(status_code=403, detail="담당자 변경은 IT 관리자 이상만 가능합니다.")
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)

        # 낙관적 락 검증 — If-Match 헤더가 있으면 updated_at ETag 비교
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
            for label in current_labels:
                if label.startswith("status::"):
                    remove_labels.append(label)
            if data.status == "closed":
                state_event = "close"
                # GitLab closed 상태로 충분 — 별도 status:: 라벨 불필요
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
        )

        # 상태 변경 시 감사 코멘트 자동 추가
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

        # Audit
        changes: dict = {}
        if data.status is not None:
            changes["status"] = {"old": old_status, "new": data.status}
        if data.assignee_id is not None:
            changes["assignee_id"] = data.assignee_id
        # 상태 변경 이유를 감사 로그에 포함
        if data.change_reason:
            changes["change_reason"] = data.change_reason
        write_audit_log(db, user, "ticket.update", "ticket", str(iid),
                        old_value={"status": old_status}, new_value=changes, request=request)

        # SLA updates
        pid = project_id or get_settings().GITLAB_PROJECT_ID
        if data.status in ("resolved", "closed"):
            sla_module.mark_resolved(db, iid, pid)
        if data.status is not None and data.status != old_status:
            if data.status == "waiting":
                sla_module.pause_sla(db, iid, pid)
            elif old_status == "waiting":
                sla_module.resume_sla(db, iid, pid)

        # 해결 노트 저장 (resolved/closed 전환 시)
        if data.status in ("resolved", "closed") and data.resolution_note:
            try:
                from ..models import ResolutionNote
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
                # GitLab에도 해결 노트 댓글로 기록 (내부 메모)
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
                    confidential=True,  # 내부 메모
                )
            except Exception as e:
                logger.warning("Failed to save resolution note for ticket #%d: %s", iid, e)

        # Notifications
        if data.status is not None and data.status != old_status:
            employee_email = ticket.get("employee_email")
            background_tasks.add_task(
                notify_status_changed, ticket, old_status, data.status,
                user.get("name", user.get("username", "담당자"))
            )
            # In-app notification → assignee (if not the actor)
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

        _invalidate_ticket_list_cache(project_id)
        # ETag 응답 헤더로 최신 updated_at 반환 (다음 요청의 If-Match에 활용)
        etag = updated.get("updated_at", "")
        from fastapi.responses import JSONResponse
        return JSONResponse(content=ticket, headers={"ETag": f'"{etag}"'})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("GitLab update_ticket %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="티켓 수정 중 오류가 발생했습니다.")


@router.get("/{iid}/resolution", response_model=dict)
def get_resolution_note(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 해결 노트 조회."""
    from ..models import ResolutionNote
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    rn = (
        db.query(ResolutionNote)
        .filter(ResolutionNote.ticket_iid == iid, ResolutionNote.project_id == pid)
        .order_by(ResolutionNote.created_at.desc())
        .first()
    )
    if not rn:
        return {}
    return {
        "id": rn.id, "note": rn.note, "resolution_type": rn.resolution_type,
        "created_by_name": rn.created_by_name, "created_at": rn.created_at.isoformat() if rn.created_at else None,
        "kb_article_id": rn.kb_article_id,
    }


@router.post("/{iid}/resolution/convert-to-kb", response_model=dict, status_code=201)
def convert_resolution_to_kb(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    """해결 노트를 KB 아티클 초안으로 변환."""
    from ..models import ResolutionNote, KBArticle
    import re as _re
    pid = project_id or str(get_settings().GITLAB_PROJECT_ID)
    rn = (
        db.query(ResolutionNote)
        .filter(ResolutionNote.ticket_iid == iid, ResolutionNote.project_id == pid)
        .order_by(ResolutionNote.created_at.desc())
        .first()
    )
    if not rn:
        raise HTTPException(status_code=404, detail="해결 노트가 없습니다. 먼저 해결 노트를 작성하세요.")
    if rn.kb_article_id:
        raise HTTPException(status_code=409, detail=f"이미 KB 아티클(id={rn.kb_article_id})로 변환됐습니다.")

    # 이슈 제목으로 KB 슬러그 생성
    try:
        issue = gitlab_client.get_issue(iid, project_id=pid)
        original_title = issue.get("title", f"티켓 #{iid} 해결 방법")
    except Exception:
        original_title = f"티켓 #{iid} 해결 방법"

    base_slug = _re.sub(r"[^\w\s-]", "", original_title.lower())
    base_slug = _re.sub(r"[\s_-]+", "-", base_slug).strip("-")[:100] or f"ticket-{iid}-solution"

    # 슬러그 유일성 확보
    slug = base_slug
    counter = 1
    while db.query(KBArticle).filter(KBArticle.slug == slug).first():
        slug = f"{base_slug}-{counter}"; counter += 1

    article = KBArticle(
        title=f"[해결 사례] {original_title}",
        slug=slug,
        content=f"## 증상\n\n티켓 #{iid}에서 보고된 문제입니다.\n\n## 해결 방법\n\n{rn.note}",
        author_id=str(user.get("sub", "")),
        author_name=user.get("name", user.get("username", "")),
        published=False,  # 초안으로 생성
        tags=[],
    )
    db.add(article)
    db.flush()

    rn.kb_article_id = article.id
    db.commit()
    db.refresh(article)

    logger.info("Ticket #%d resolution note converted to KB article id=%d (draft)", iid, article.id)
    return {"kb_article_id": article.id, "slug": article.slug, "title": article.title}


@router.post("/{iid}/comments", response_model=dict, status_code=201)
def add_comment(
    iid: int,
    data: CommentCreate,
    background_tasks: BackgroundTasks,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # S-9: 비밀 스캐닝 — 댓글 내용 검사 (경고만)
    from ..secret_scanner import check_and_warn
    check_and_warn(data.body, context=f"ticket.comment.{iid}", actor=user.get("username", "?"))

    # Internal notes require developer role or above
    if data.internal:
        role = user.get("role", "user")
        from ..rbac import ROLE_LEVELS
        if ROLE_LEVELS.get(role, 0) < ROLE_LEVELS["developer"]:
            raise HTTPException(status_code=403, detail="내부 메모는 IT 개발자 이상만 작성할 수 있습니다.")

    gitlab_token = user.get("gitlab_token")
    if not gitlab_token:
        raise HTTPException(
            status_code=401,
            detail="GitLab 세션이 만료됐습니다. 다시 로그인해 주세요.",
        )

    try:
        note = gitlab_client.add_note(
            iid, data.body,
            project_id=project_id,
            confidential=data.internal,
            gitlab_token=gitlab_token,
        )
    except Exception as e:
        logger.error("GitLab add_note %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="댓글 추가 중 오류가 발생했습니다.")

    # SLA first-response tracking (developer or above)
    pid = project_id or get_settings().GITLAB_PROJECT_ID
    role = user.get("role", "user")
    from ..rbac import ROLE_LEVELS
    if ROLE_LEVELS.get(role, 0) >= ROLE_LEVELS["developer"]:
        sla_module.mark_first_response(db, iid, pid)

    # Notification
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
        ticket = _issue_to_response(issue)
        background_tasks.add_task(
            notify_comment_added, ticket, data.body,
            user.get("name", user.get("username", "")), data.internal
        )
    except Exception as e:
        logger.warning("Failed to fetch ticket for comment notification on ticket %d: %s", iid, e)

    return {
        "id": note["id"],
        "body": note["body"],
        "author_name": note["author"]["name"],
        "author_avatar": note["author"].get("avatar_url"),
        "created_at": note["created_at"],
        "internal": note.get("confidential", False),
    }


@router.get("/{iid}/comments", response_model=list[dict])
def get_comments(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    try:
        notes = gitlab_client.get_notes(iid, project_id=project_id)
        return [
            {
                "id": n["id"],
                "body": n["body"],
                "author_name": n["author"]["name"],
                "author_avatar": n["author"].get("avatar_url"),
                "created_at": n["created_at"],
                "internal": n.get("confidential", False),
            }
            for n in notes
            if not n.get("system", False)
        ]
    except Exception as e:
        logger.error("GitLab get_comments %d error: %s", iid, e)
        raise HTTPException(status_code=502, detail="댓글 조회 중 오류가 발생했습니다.")


@router.get("/{iid}/timeline", response_model=list[dict])
def get_timeline(
    iid: int,
    project_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """댓글 + 감사로그 + GitLab 시스템 노트를 시간순으로 병합한 타임라인."""
    import json as _json
    from ..config import get_settings as _gs

    _pid = project_id or str(_gs().GITLAB_PROJECT_ID)
    _cache_key = f"itsm:timeline:{_pid}:{iid}"
    _TTL = 60  # 60초 캐시

    # Redis 캐시 확인
    _r = None
    try:
        import redis as _redis
        _r = _redis.from_url(_gs().REDIS_URL, socket_connect_timeout=1, decode_responses=True)
        _cached = _r.get(_cache_key)
        if _cached:
            return _json.loads(_cached)
    except Exception as _re:
        logger.warning("Timeline #%d: Redis error: %s", iid, _re)
        _r = None

    events: list[dict] = []

    # 1) GitLab 노트 (댓글 + 시스템 메시지)
    try:
        notes = gitlab_client.get_notes(iid, project_id=project_id)
        for n in notes:
            if n.get("system", False):
                events.append({
                    "type": "system",
                    "id": f"gl-sys-{n['id']}",
                    "body": n["body"],
                    "author_name": n["author"]["name"],
                    "author_avatar": n["author"].get("avatar_url"),
                    "created_at": n["created_at"],
                })
            else:
                events.append({
                    "type": "comment",
                    "id": f"gl-{n['id']}",
                    "body": n["body"],
                    "author_name": n["author"]["name"],
                    "author_avatar": n["author"].get("avatar_url"),
                    "created_at": n["created_at"],
                    "internal": n.get("confidential", False),
                })
    except Exception as e:
        logger.warning("Timeline: GitLab notes error for #%d: %s", iid, e)

    # 2) 감사 로그
    try:
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.resource_type == "ticket", AuditLog.resource_id == str(iid))
            .order_by(AuditLog.created_at)
            .limit(200)
            .all()
        )
        for log in logs:
            events.append({
                "type": "audit",
                "id": f"audit-{log.id}",
                "action": log.action,
                "actor_name": log.actor_name or log.actor_username,
                "actor_username": log.actor_username,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            })
    except Exception as e:
        logger.warning("Timeline: audit log error for #%d: %s", iid, e)

    # 시간순 정렬
    def _sort_key(e: dict) -> str:
        return e.get("created_at") or ""

    events.sort(key=_sort_key)

    # Redis 캐시 저장
    try:
        if _r:
            _r.setex(_cache_key, _TTL, _json.dumps(events, default=str))
    except Exception as _ce:
        logger.warning("Timeline #%d: cache save failed: %s", iid, _ce)

    return events


@router.post("/bulk", response_model=dict)
def bulk_update_tickets(
    request: Request,
    data: BulkUpdate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_agent),
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

    # GitLab API 호출을 최대 8개 병렬 실행 (GitLab rate-limit 여유 고려)
    max_workers = min(8, len(data.iids))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_process_one, iid): iid for iid in data.iids}
        for future in as_completed(futures):
            iid, exc = future.result()
            if exc is None:
                results["success"].append(iid)
                write_audit_log(
                    db, user, f"ticket.bulk.{data.action}", "ticket", str(iid),
                    new_value={"action": data.action, "value": data.value},
                    request=request,
                )
            else:
                results["errors"].append({"iid": iid, "error": str(exc)})

    if results["success"]:
        _invalidate_ticket_list_cache(data.project_id)
    return results


@router.get("/{iid}/stream")
async def ticket_event_stream(
    request: Request,
    iid: int,
    project_id: Optional[str] = None,
    _user: dict = Depends(get_current_user),
):
    """티켓 실시간 이벤트 SSE 스트림.

    웹훅으로 티켓 상태가 바뀌면 Redis → SSE로 즉시 프론트엔드에 알린다.
    """
    settings = get_settings()
    pid = project_id or str(settings.GITLAB_PROJECT_ID)
    channel = f"ticket:events:{pid}:{iid}"

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            pubsub = r.pubsub()
            await pubsub.subscribe(channel)

            keepalive_interval = 30.0
            last_keepalive = asyncio.get_event_loop().time()

            while True:
                if await request.is_disconnected():
                    break

                # get_message()는 메시지 없으면 즉시 None 반환 → tight loop 방지
                # 1초 대기로 이벤트 루프 반환, 30초마다 keep-alive 전송
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )

                if message and message.get("type") == "message":
                    yield f"data: {message['data']}\n\n"
                    last_keepalive = asyncio.get_event_loop().time()
                else:
                    now = asyncio.get_event_loop().time()
                    if now - last_keepalive >= keepalive_interval:
                        yield ": keep-alive\n\n"
                        last_keepalive = now

            await pubsub.unsubscribe(channel)
            await r.aclose()
        except ImportError:
            while not await request.is_disconnected():
                yield ": keep-alive\n\n"
                await asyncio.sleep(30)
        except Exception as e:
            logger.error("Ticket SSE stream error (iid=%s): %s", iid, e)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
