"""Non-endpoint helper functions shared across ticket sub-modules."""
import concurrent.futures
import hashlib as _hashlib
import logging
from html.parser import HTMLParser as _HTMLParser
from typing import Optional

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from ...auth import get_current_user  # noqa: F401 (re-exported for convenience)
from ...config import get_settings
from ... import gitlab_client
from ...models import SLARecord
from ..automation import evaluate_automation_rules  # noqa: F401
from ...rate_limit import user_limiter, LIMIT_TICKET_CREATE, LIMIT_UPLOAD, LIMIT_COMMENT, LIMIT_SEARCH  # noqa: F401
from ...redis_client import get_redis as _get_redis, scan_delete as _scan_delete


# ---------------------------------------------------------------------------
# 자동화 규칙 액션 실행 헬퍼
# ---------------------------------------------------------------------------

def _apply_automation_actions(
    actions: list[dict],
    iid: int,
    project_id: Optional[str],
    db,
    current_labels: list[str] | None = None,
) -> None:
    """evaluate_automation_rules()가 반환한 액션 목록을 GitLab에 실제로 적용한다."""
    if not actions:
        return
    project_id or get_settings().GITLAB_PROJECT_ID
    add_labels: list[str] = []
    remove_labels: list[str] = []
    assignee_id: Optional[int] = None
    state_event: Optional[str] = None

    for action in actions:
        action_type = action.get("type", "")
        value = action.get("value", "")
        try:
            if action_type == "assign":
                try:
                    assignee_id = int(value)
                except (ValueError, TypeError):
                    logger.warning("Automation assign: invalid user id '%s'", value)
            elif action_type == "set_status":
                if current_labels is None:
                    try:
                        issue = gitlab_client.get_issue(iid, project_id=project_id)
                        current_labels = issue.get("labels", [])
                    except Exception:
                        current_labels = []
                for lbl in current_labels:
                    if lbl.startswith("status::"):
                        remove_labels.append(lbl)
                if value == "closed":
                    state_event = "close"
                elif value == "reopened":
                    state_event = "reopen"
                    add_labels.append("status::open")
                else:
                    add_labels.append(f"status::{value}")
            elif action_type == "add_label":
                add_labels.append(str(value))
            elif action_type == "send_slack":
                try:
                    from ...notifications import send_slack as _send_slack
                    # value: "#channel" or free-form message (prefixed with "#ch: msg")
                    if value and value.startswith("#"):
                        parts = value.split(":", 1)
                        ch = parts[0].strip()
                        msg = parts[1].strip() if len(parts) > 1 else f"자동화 알림 — 티켓 #{iid}"
                        _send_slack(msg, channel=ch)
                    else:
                        _send_slack(value or f"자동화 알림 — 티켓 #{iid}")
                except Exception as e:
                    logger.warning("Automation send_slack failed for ticket #%d: %s", iid, e)
            elif action_type == "notify":
                logger.info("Automation notify: ticket #%d → %s", iid, value)
            else:
                logger.warning("Automation unknown action type: %s", action_type)
        except Exception as e:
            logger.warning("Automation action '%s' failed for ticket #%d: %s", action_type, iid, e)

    if add_labels or remove_labels or assignee_id is not None or state_event:
        try:
            gitlab_client.update_issue(
                iid,
                add_labels=add_labels or None,
                remove_labels=remove_labels or None,
                state_event=state_event,
                project_id=project_id,
                assignee_id=assignee_id,
            )
            logger.info(
                "Automation applied to ticket #%d: labels_add=%s labels_rm=%s assignee=%s state=%s",
                iid, add_labels, remove_labels, assignee_id, state_event,
            )
        except Exception as e:
            logger.warning("Automation GitLab update failed for ticket #%d: %s", iid, e)


# ---------------------------------------------------------------------------
# Celery 태스크 디스패처
# ---------------------------------------------------------------------------

def _dispatch_notification(background_tasks: BackgroundTasks, celery_task, fallback_fn, *args):
    """Celery가 사용 가능하면 .delay()로 큐에 넣고, 아니면 BackgroundTasks 폴백."""
    try:
        from ...config import get_settings as _gs
        settings = _gs()
        broker = getattr(settings, "CELERY_BROKER_URL", None) or settings.REDIS_URL
        if broker and broker != "memory://":
            celery_task.delay(*args)
            return
    except Exception:
        pass
    background_tasks.add_task(fallback_fn, *args)


# ---------------------------------------------------------------------------
# 캐시 무효화
# ---------------------------------------------------------------------------

def _make_list_cache_key(project_id: Optional[str], ver: int, **params: object) -> str:
    """파라미터를 SHA-256으로 해시해 짧은 Redis 키를 반환한다.
    Redis 권장 키 길이(≤1 KB)를 초과하는 검색어 등을 안전하게 처리."""
    raw = f"{project_id or ''}:{ver}:" + ":".join(f"{k}={v}" for k, v in sorted(params.items()))
    digest = _hashlib.sha256(raw.encode()).hexdigest()[:32]
    return f"itsm:tl:{project_id or 'all'}:v{ver}:{digest}"


def _invalidate_ticket_list_cache(project_id: Optional[str] = None) -> None:
    """티켓 목록 캐시 버전을 증가 + 구 버전 캐시 키를 즉시 삭제한다."""
    _r = _get_redis()
    if _r:
        pid_part = project_id or ''
        # 구형 키(itsm:tickets:) 와 신형 키(itsm:tl:) 동시 삭제
        _scan_delete(_r, f"itsm:tickets:{pid_part}:v*")
        _scan_delete(_r, f"itsm:tl:{pid_part or 'all'}:v*")
        if pid_part:
            _scan_delete(_r, "itsm:tickets::v*")
            _scan_delete(_r, "itsm:tl:all:v*")
        _r.incr(f"itsm:tickets:v:{pid_part or 'all'}")
        _r.expire(f"itsm:tickets:v:{pid_part or 'all'}", 3600)
        if pid_part:
            _r.incr("itsm:tickets:v:all")
            _r.expire("itsm:tickets:v:all", 3600)
        _scan_delete(_r, f"itsm:stats:{pid_part}*")


# ---------------------------------------------------------------------------
# 파일 업로드 검증 헬퍼
# ---------------------------------------------------------------------------

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
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

_MAGIC_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),
    (b"%PDF-", "application/pdf"),
    (b"PK\x03\x04", "application/zip"),
    (b"\xd0\xcf\x11\xe0", "application/msword"),
]


def _detect_mime_from_bytes(data: bytes) -> str | None:
    """Detect MIME type from magic bytes. Returns None if unknown."""
    for sig, mime in _MAGIC_SIGNATURES:
        if data[:len(sig)] == sig:
            if sig == b"RIFF":
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return mime
                return None
            return mime
    try:
        import magic as _magic
        return _magic.from_buffer(data[:2048], mime=True)
    except ImportError:
        logger.error("python-magic 패키지가 설치되지 않았습니다. 파일 MIME 탐지 불가.")
        raise HTTPException(
            status_code=503,
            detail="파일 검증 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.",
        )
    except Exception:
        pass
    return None


def _validate_magic_bytes(content: bytes, declared_mime: str) -> None:
    """Raise 400 if magic bytes don't match an allowed type. S-2."""
    # 실행 파일 시그니처 우선 차단 — python-magic 없이도 동작
    for pat in (b"MZ", b"\x7fELF", b"#!/"):
        if content[:len(pat)] == pat:
            raise HTTPException(status_code=400, detail="허용되지 않는 파일 형식입니다. (실행 파일)")

    detected = _detect_mime_from_bytes(content)
    if detected is None:
        return
    ZIP_MIMES = {
        "application/zip", "application/x-zip-compressed",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
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
    """이미지에서 EXIF 메타데이터를 제거하고 리인코딩."""
    _STRIPPABLE = {"image/jpeg", "image/png", "image/webp"}
    if mime not in _STRIPPABLE:
        return content
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(content))
        if mime == "image/jpeg" and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        out = _io.BytesIO()
        fmt = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[mime]
        img.save(out, format=fmt, quality=92, optimize=True)
        cleaned = out.getvalue()
        logger.info("EXIF stripped: %s (%d→%d bytes)", mime, len(content), len(cleaned))
        return cleaned
    except ImportError:
        logger.error("Pillow 패키지가 설치되지 않았습니다. 이미지 EXIF 제거 불가.")
        raise HTTPException(
            status_code=503,
            detail="이미지 처리 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("EXIF strip failed (fail-open): %s — %s", mime, e)
        return content


def _scan_with_clamav(content: bytes, filename: str) -> None:
    """ClamAV 바이러스 스캔. 위협 탐지 시 422 raise.

    app.clamav.scan_bytes()에 위임한다. ClamAV 연결 불가 시 업로드를 허용한다 (fail-open).
    """
    settings = get_settings()
    if not getattr(settings, "CLAMAV_ENABLED", True):
        return
    from ...clamav import scan_bytes as _clam_scan
    is_safe, detail = _clam_scan(content, filename)
    if not is_safe:
        raise HTTPException(
            status_code=422,
            detail=f"파일에서 악성코드가 감지되었습니다: {detail}",
        )


# ---------------------------------------------------------------------------
# 댓글 sanitizer
# ---------------------------------------------------------------------------

# TipTap 에서 생성되는 안전한 HTML 태그/속성 허용 목록
_ALLOWED_TAGS: frozenset[str] = frozenset({
    "p", "br", "hr", "blockquote", "pre",
    "strong", "b", "em", "i", "u", "s", "code",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "a", "span", "div",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
})
# 태그별 허용 속성 (없는 태그는 속성 없이 재생성)
_ALLOWED_ATTRS: dict[str, frozenset[str]] = {
    "a":   frozenset({"href", "title", "target", "rel"}),
    "img": frozenset({"src", "alt", "width", "height"}),
    "th":  frozenset({"colspan", "rowspan"}),
    "td":  frozenset({"colspan", "rowspan"}),
    "span": frozenset({"class"}),
    "div":  frozenset({"class"}),
    "p":    frozenset({"class"}),
}
_SAFE_HREF_SCHEMES = ("http://", "https://", "mailto:", "#")


class _AllowlistSanitizer(_HTMLParser):
    """TipTap HTML 를 허용된 태그/속성만 남기고 재조립한다.

    - 허용 목록에 없는 태그: 열기/닫기 태그 제거, 텍스트 내용은 유지
    - script / style / iframe 등 위험 태그: 내용까지 삭제
    - href 속성: http/https/mailto/# 로 시작하는 경우만 유지
    """
    _STRIP_CONTENT_TAGS: frozenset[str] = frozenset({"script", "style", "iframe", "object", "embed", "frame"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._out: list[str] = []
        self._strip_depth: int = 0  # strip-content 태그 depth

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._STRIP_CONTENT_TAGS:
            self._strip_depth += 1
            return
        if self._strip_depth:
            return
        if tag not in _ALLOWED_TAGS:
            return
        allowed_a = _ALLOWED_ATTRS.get(tag, frozenset())
        attr_str = ""
        for name, value in attrs:
            if name not in allowed_a:
                continue
            value = value or ""
            if name == "href" and not any(value.startswith(s) for s in _SAFE_HREF_SCHEMES):
                continue
            if name == "src" and not any(value.startswith(s) for s in ("http://", "https://", "data:image/")):
                continue
            attr_str += f' {name}="{value}"'
        self._out.append(f"<{tag}{attr_str}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._STRIP_CONTENT_TAGS:
            if self._strip_depth > 0:
                self._strip_depth -= 1
            return
        if self._strip_depth:
            return
        if tag in _ALLOWED_TAGS:
            self._out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self._strip_depth:
            self._out.append(data)

    def get_result(self) -> str:
        return "".join(self._out)


def _sanitize_comment(text: str) -> str:
    """TipTap HTML 댓글을 허용 목록 기반으로 sanitize 한다.

    허용 태그의 구조(bold, italic, 리스트 등)는 보존하고
    script/iframe 등 위험 요소는 내용까지 제거.
    HTMLParser 사용으로 regex bypass 공격 방지.
    """
    if not text:
        return ""
    sanitizer = _AllowlistSanitizer()
    try:
        sanitizer.feed(text[:50000])
        sanitizer.close()
    except Exception:
        pass
    return sanitizer.get_result()[:50000]


# ---------------------------------------------------------------------------
# 라벨 / 메타 파싱 상수 및 헬퍼
# ---------------------------------------------------------------------------

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
    "open":              "접수됨",
    "approved":          "승인완료",
    "in_progress":       "처리 중",
    "waiting":           "추가정보 대기 중",
    "resolved":          "처리 완료",
    "testing":           "테스트 중",
    "ready_for_release": "운영배포전",
    "released":          "운영반영완료",
    "closed":            "종료됨",
    "reopened":          "재개됨",
}

# 이 상태로 전환 시 change_reason 필수 입력
REASON_REQUIRED_TRANSITIONS: set[str] = {"waiting", "reopened"}

VALID_TRANSITIONS: dict[str, set[str]] = {
    "open":              {"approved", "in_progress", "waiting", "closed"},
    "approved":          {"in_progress", "waiting", "closed"},
    "in_progress":       {"resolved", "waiting", "closed"},
    "waiting":           {"in_progress", "approved", "closed"},
    "resolved":          {"testing", "in_progress", "ready_for_release", "closed"},
    "testing":           {"ready_for_release", "in_progress", "closed"},
    "ready_for_release": {"released", "in_progress", "closed"},
    "released":          {"closed"},
    "closed":            {"reopened"},
}


def _parse_labels(labels: list[str]) -> dict:
    result = {"category": None, "priority": "medium", "status": "open"}
    for label in labels:
        if label.startswith("cat::"):
            result["category"] = label[5:]
        elif label.startswith("prio::"):
            raw = label[6:]
            if "." in raw and raw[0].isupper():
                raw = raw.split(".")[-1].lower()
            result["priority"] = raw
        elif label.startswith("status::"):
            raw = label[8:]
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
        elif line.startswith("신청자:"):
            meta["employee_name"] = meta["employee_name"] or line.replace("신청자:", "").strip()
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


def _issue_to_response(issue: dict, mask_pii: bool = False) -> dict:
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

    title = issue["title"]
    description = meta["body"]
    if mask_pii:
        from ...pii_masker import mask_pii as _mask
        title = _mask(title)
        description = _mask(description)

    return {
        "iid": issue["iid"],
        "title": title,
        "description": description,
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
        "milestone_id": issue["milestone"]["id"] if issue.get("milestone") else None,
        "milestone_title": issue["milestone"]["title"] if issue.get("milestone") else None,
    }


def _attach_sla_deadlines(tickets: list[dict], db: Session) -> None:
    """tickets 리스트에 sla_deadline / sla_breached 값을 인-플레이스로 추가한다."""
    if not tickets:
        return

    from sqlalchemy import tuple_ as _tuple

    pairs = [
        (t["iid"], t.get("project_id") or "")
        for t in tickets
        if t.get("project_id")
    ]
    if not pairs:
        return

    rows = (
        db.query(SLARecord)
        .filter(_tuple(SLARecord.gitlab_issue_iid, SLARecord.project_id).in_(pairs))
        .all()
    )

    sla_map: dict[tuple[int, str], SLARecord] = {
        (r.gitlab_issue_iid, r.project_id): r for r in rows
    }

    for t in tickets:
        rec = sla_map.get((t["iid"], t.get("project_id") or ""))
        t["sla_deadline"] = rec.sla_deadline.isoformat() if rec and rec.sla_deadline else None
        t["sla_breached"] = rec.breached if rec else False


def _get_issue_requester(issue: dict) -> tuple[str, str]:
    """이슈에서 신청자 식별값(username)과 표시명(name)을 반환한다."""
    meta = _extract_meta(issue.get("description") or "")
    author = issue.get("author") or {}
    author_username = author.get("username") or ""
    employee_name = meta.get("employee_name")
    created_by = meta.get("created_by_username")
    if created_by:
        username = created_by
    elif employee_name and ("bot" in author_username.lower() or not author_username):
        username = employee_name
    else:
        username = author_username
    name = employee_name or author.get("name") or username
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


def _sla_to_dict(record) -> dict:
    from ...schemas import SLARecordResponse
    return SLARecordResponse.model_validate(record).model_dump()


# ---------------------------------------------------------------------------
# Module-level executor — avoids creating a new thread pool per request.
# ---------------------------------------------------------------------------
_stats_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="stats"
)
