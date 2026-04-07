import httpx
import logging
import threading
import time
from contextlib import contextmanager
from typing import Generator, Optional

from .config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 공유 httpx.Client — TCP 커넥션 풀 재사용 (병목 개선: 매 요청마다 3ms+ 신규 연결 제거)
# ---------------------------------------------------------------------------
_http_client: httpx.Client | None = None
_http_client_lock = threading.Lock()


def _get_shared_client() -> httpx.Client:
    """싱글톤 httpx.Client를 반환한다. 커넥션 풀을 재사용해 TCP 핸드쉐이크 비용을 제거."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        with _http_client_lock:
            if _http_client is None or _http_client.is_closed:
                _http_client = httpx.Client(
                    timeout=httpx.Timeout(30.0, connect=5.0),
                    limits=httpx.Limits(
                        max_connections=30,
                        max_keepalive_connections=15,
                        keepalive_expiry=60.0,
                    ),
                )
    return _http_client


@contextmanager
def _http_ctx(timeout: float | None = None) -> Generator[httpx.Client, None, None]:
    """공유 클라이언트를 컨텍스트 매니저로 반환 (커넥션 풀 닫지 않음).

    - timeout=None: 공유 클라이언트 반환 (커넥션 풀 재사용, 기본 30s 타임아웃)
    - timeout=N: 별도 클라이언트 사용 (공유 클라이언트의 타임아웃을 변경하면
      멀티스레드 경합 조건이 발생하므로 짧은 타임아웃은 독립 클라이언트 사용)
    """
    if timeout is not None:
        with httpx.Client(
            timeout=httpx.Timeout(timeout, connect=min(5.0, timeout)),
            limits=httpx.Limits(max_connections=5, max_keepalive_connections=2),
        ) as client:
            yield client
    else:
        yield _get_shared_client()

# ---------------------------------------------------------------------------
# Simple Circuit Breaker
# ---------------------------------------------------------------------------
_cb_failures = 0
_cb_opened_at: float = 0.0
_cb_lock = threading.Lock()
_CB_THRESHOLD = 5       # open after 5 consecutive failures
_CB_TIMEOUT = 30.0      # seconds before half-open retry


def _check_circuit():
    """Raise RuntimeError if circuit is open."""
    global _cb_failures, _cb_opened_at
    with _cb_lock:
        if _cb_failures >= _CB_THRESHOLD:
            elapsed = time.monotonic() - _cb_opened_at
            if elapsed < _CB_TIMEOUT:
                raise RuntimeError(
                    f"GitLab API circuit open — waiting {_CB_TIMEOUT - elapsed:.0f}s more"
                )
            # Half-open: allow one attempt through


def _record_success():
    global _cb_failures
    with _cb_lock:
        _cb_failures = 0


def _record_failure():
    global _cb_failures, _cb_opened_at
    with _cb_lock:
        _cb_failures += 1
        if _cb_failures == _CB_THRESHOLD:
            _cb_opened_at = time.monotonic()
            logger.error("GitLab API circuit breaker OPENED after %d failures", _CB_THRESHOLD)


def _base(project_id: Optional[str] = None) -> str:
    s = get_settings()
    pid = project_id or s.GITLAB_PROJECT_ID
    return f"{s.GITLAB_API_URL}/api/v4/projects/{pid}"


def _headers() -> dict:
    token = get_settings().GITLAB_PROJECT_TOKEN
    if not token:
        raise RuntimeError("GITLAB_PROJECT_TOKEN이 설정되지 않았습니다.")
    return {"PRIVATE-TOKEN": token, "Content-Type": "application/json"}


def _get_headers(gitlab_token: Optional[str] = None) -> dict:
    """사용자 토큰 또는 서비스 토큰 헤더를 반환한다.

    gitlab_token이 있으면 Bearer 인증, 없으면 서비스 토큰(_headers)을 사용한다.
    """
    if gitlab_token:
        return {"Authorization": f"Bearer {gitlab_token}", "Content-Type": "application/json"}
    return _headers()


_USER_CACHE_TTL = 3600   # 1 hour
_ISSUES_CACHE_TTL = 30   # 30초 — GitLab API rate-limit 방어용 (검색·필터 쿼리 공유)
_PROJECTS_CACHE_TTL = 300  # 5분 — 프로젝트 목록은 자주 변경되지 않음

def _redis_client():
    """공유 ConnectionPool 기반 Redis 클라이언트 반환. 연결 실패 시 None."""
    from .redis_client import get_redis
    return get_redis()


def get_users_by_usernames(usernames: list[str]) -> dict[str, str]:
    """username 목록을 받아 {username: display_name} 매핑을 반환한다.

    Redis 캐시 우선 조회 → 미스된 항목만 GitLab API 병렬 호출.
    캐시 TTL: 1시간.
    """
    if not usernames:
        return {}

    result: dict[str, str] = {}
    to_fetch: list[str] = list(usernames)

    # Redis 캐시 조회
    r = _redis_client()
    if r is not None:
        try:
            cache_keys = [f"gl:user_name:{u}" for u in usernames]
            cached_vals = r.mget(cache_keys)
            to_fetch = []
            for username, cached in zip(usernames, cached_vals):
                if cached:
                    result[username] = cached
                else:
                    to_fetch.append(username)
        except Exception:
            to_fetch = list(usernames)

    if not to_fetch:
        return result

    from concurrent.futures import ThreadPoolExecutor
    settings = get_settings()
    headers = _headers()

    def _fetch(username: str):
        try:
            with _http_ctx(timeout=10) as c:
                resp = c.get(
                    f"{settings.GITLAB_API_URL}/api/v4/users",
                    headers=headers,
                    params={"username": username},
                )
                if resp.is_success:
                    users = resp.json()
                    if users:
                        return username, users[0].get("name", username)
        except Exception:
            pass
        return username, None

    fetched: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(len(to_fetch), 5)) as pool:
        for uname, name in pool.map(_fetch, to_fetch):
            if name is not None:
                fetched[uname] = name

    # 결과 Redis 캐시 저장
    if r is not None and fetched:
        try:
            pipe = r.pipeline()
            for uname, name in fetched.items():
                pipe.setex(f"gl:user_name:{uname}", _USER_CACHE_TTL, name)
            pipe.execute()
        except Exception:
            pass

    result.update(fetched)
    return result


def get_user_accessible_projects(user_token: str) -> list[dict]:
    """사용자 본인의 OAuth 토큰으로 접근 가능한 프로젝트 목록 반환."""
    headers = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}
    with _http_ctx() as client:
        resp = client.get(
            f"{get_settings().GITLAB_API_URL}/api/v4/projects",
            headers=headers,
            params={"membership": True, "per_page": 100, "simple": True, "order_by": "name", "sort": "asc"},
        )
        resp.raise_for_status()
        return resp.json()


def get_user_projects(user_id: str) -> list[dict]:
    """사용자가 접근 가능한 GitLab 프로젝트 목록 반환.

    GitLab API의 membership=true 파라미터를 사용해 해당 사용자가 멤버인
    프로젝트만 직접 반환한다 (전체 조회 후 필터링 방식 대비 불필요한 API 호출 제거).
    Redis 캐시 TTL: 5분.
    """
    import json as _js
    _cache_key = f"gl:projects:{user_id}"
    _r = _redis_client()
    if _r:
        try:
            _cached = _r.get(_cache_key)
            if _cached:
                return _js.loads(_cached)
        except Exception:
            pass

    all_projects: list[dict] = []
    page = 1
    with _http_ctx() as client:
        while True:
            resp = client.get(
                f"{get_settings().GITLAB_API_URL}/api/v4/projects",
                headers=_headers(),
                params={
                    "membership": "true",
                    "per_page": 100,
                    "page": page,
                    "simple": True,
                    "order_by": "name",
                    "sort": "asc",
                },
            )
            resp.raise_for_status()
            batch = resp.json()
            all_projects.extend(batch)
            if len(batch) < 100:
                break
            page += 1

    if _r and all_projects:
        try:
            _r.setex(_cache_key, _PROJECTS_CACHE_TTL, _js.dumps(all_projects))
        except Exception:
            pass
    return all_projects


def get_project_members(project_id: str) -> list[dict]:
    """GitLab 프로젝트 멤버 목록 반환 (페이지네이션 처리)."""
    all_members: list[dict] = []
    page = 1
    with _http_ctx() as client:
        while True:
            resp = client.get(
                f"{_base(project_id)}/members/all",
                headers=_headers(),
                params={"per_page": 100, "page": page},
            )
            resp.raise_for_status()
            batch = resp.json()
            all_members.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    return all_members


def get_group_members(group_id: str) -> list[dict]:
    """GitLab 그룹 전체 멤버 목록 반환 (페이지네이션 처리).

    퇴사자 동기화에서 활성 멤버 ID 집합을 구성하는 데 사용.
    """
    s = get_settings()
    token = s.GITLAB_GROUP_TOKEN or s.GITLAB_PROJECT_TOKEN
    headers = {"PRIVATE-TOKEN": token}
    url = f"{s.GITLAB_API_URL}/api/v4/groups/{group_id}/members/all"
    members: list[dict] = []
    page = 1
    with _http_ctx() as client:
        while True:
            resp = client.get(url, headers=headers, params={"per_page": 100, "page": page})
            if not resp.is_success:
                logger.warning("get_group_members: status %d for group %s", resp.status_code, group_id)
                break
            batch = resp.json()
            if not batch:
                break
            members.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    return members


def create_issue(
    title: str,
    description: str,
    labels: list[str],
    project_id: Optional[str] = None,
    assignee_id: Optional[int] = None,
    gitlab_token: Optional[str] = None,
    confidential: bool = False,
    milestone_id: Optional[int] = None,
) -> dict:
    """이슈를 생성한다.

    gitlab_token: 사용자 Bearer 토큰. 외부 프로젝트(ITSM 전용 토큰이 접근 불가)에
    이슈를 생성할 때 필요하다. 없으면 서비스 토큰(_headers)을 사용한다.
    """
    _check_circuit()
    payload: dict = {
        "title": title,
        "description": description,
        "labels": ",".join(labels),
        "confidential": confidential,
    }
    if assignee_id:
        payload["assignee_ids"] = [assignee_id]
    if milestone_id:
        payload["milestone_id"] = milestone_id
    headers = _get_headers(gitlab_token)
    get_settings()
    base_url = _base(project_id)
    try:
        with _http_ctx() as client:
            resp = client.post(
                f"{base_url}/issues",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            _record_success()
            return resp.json()
    except Exception:
        _record_failure()
        raise


_ALLOWED_ORDER_BY = {"created_at", "updated_at", "priority", "due_date", "title"}
_ALLOWED_SORT = {"asc", "desc"}


def get_issues(
    state: str = "all",
    labels: Optional[str] = None,
    not_labels: Optional[str] = None,
    search: Optional[str] = None,
    project_id: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    order_by: str = "created_at",
    sort: str = "desc",
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    updated_after: Optional[str] = None,
    updated_before: Optional[str] = None,
    author_username: Optional[str] = None,
    assignee_username: Optional[str] = None,
    iids: Optional[list[int]] = None,
) -> tuple[list[dict], int]:
    """이슈 목록과 전체 개수를 반환한다. (issues, total)"""
    safe_order_by = order_by if order_by in _ALLOWED_ORDER_BY else "created_at"
    safe_sort = sort if sort in _ALLOWED_SORT else "desc"
    params: dict = {"page": page, "per_page": per_page, "order_by": safe_order_by, "sort": safe_sort}
    if state != "all":
        params["state"] = state
    if labels:
        params["labels"] = labels
    if not_labels:
        params["not[labels]"] = not_labels
    if search:
        params["search"] = search
    if created_after:
        params["created_after"] = created_after
    if created_before:
        params["created_before"] = created_before
    if updated_after:
        params["updated_after"] = updated_after
    if updated_before:
        params["updated_before"] = updated_before
    if author_username:
        params["author_username"] = author_username
    if assignee_username:
        params["assignee_username"] = assignee_username
    if iids:
        params["iids[]"] = iids  # GitLab: 특정 iid 목록만 조회

    # 검색어·업데이트 필터가 있으면 캐시 건너뜀 (실시간성 필요)
    _use_cache = not (search or updated_after or updated_before)
    _cache_key: Optional[str] = None
    if _use_cache:
        import hashlib as _hl, json as _js
        _raw = _js.dumps(params, sort_keys=True) + str(project_id)
        _cache_key = "gl:issues:" + _hl.md5(_raw.encode()).hexdigest()
        _r = _redis_client()
        if _r:
            try:
                _cached = _r.get(_cache_key)
                if _cached:
                    _data = _js.loads(_cached)
                    return _data["issues"], _data["total"]
            except Exception:
                pass

    _check_circuit()
    try:
        with _http_ctx() as client:
            resp = client.get(f"{_base(project_id)}/issues", headers=_headers(), params=params)
            resp.raise_for_status()
            _record_success()
            _json = resp.json()
            try:
                total = int(resp.headers.get("X-Total", len(_json)))
            except (ValueError, TypeError):
                total = len(_json)
            if _cache_key:
                _r = _redis_client()
                if _r:
                    try:
                        import json as _js2
                        _r.setex(_cache_key, _ISSUES_CACHE_TTL, _js2.dumps({"issues": _json, "total": total}))
                    except Exception:
                        pass
            return _json, total
    except Exception:
        _record_failure()
        raise


def get_all_issues(
    state: str = "all",
    labels: Optional[str] = None,
    not_labels: Optional[str] = None,
    search: Optional[str] = None,
    project_id: Optional[str] = None,
    order_by: str = "created_at",
    sort: str = "desc",
    max_results: int = 1000,
    created_after: Optional[str] = None,
    created_before: Optional[str] = None,
    author_username: Optional[str] = None,
    assignee_username: Optional[str] = None,
) -> list[dict]:
    """Fetch all matching issues across pages (max_results safety cap).

    GitLab caps per_page at 100, so this paginates through results automatically.
    """
    result: list[dict] = []
    page = 1
    per_page = 100  # GitLab maximum
    while len(result) < max_results:
        issues, total = get_issues(
            state=state, labels=labels, not_labels=not_labels,
            search=search, project_id=project_id,
            page=page, per_page=per_page,
            order_by=order_by, sort=sort,
            created_after=created_after, created_before=created_before,
            author_username=author_username, assignee_username=assignee_username,
        )
        if not issues:
            break
        result.extend(issues)
        if len(result) >= total or len(issues) < per_page:
            break
        page += 1
    return result[:max_results]


def get_issue(iid: int, project_id: Optional[str] = None, gitlab_token: Optional[str] = None) -> dict:
    with _http_ctx() as client:
        resp = client.get(f"{_base(project_id)}/issues/{iid}", headers=_get_headers(gitlab_token))
        resp.raise_for_status()
        return resp.json()


def get_notes(iid: int, project_id: Optional[str] = None) -> list[dict]:
    all_notes: list[dict] = []
    page = 1
    with _http_ctx() as client:
        while True:
            resp = client.get(
                f"{_base(project_id)}/issues/{iid}/notes",
                headers=_headers(),
                params={"per_page": 100, "page": page, "order_by": "created_at", "sort": "asc"},
            )
            resp.raise_for_status()
            notes = resp.json()
            all_notes.extend(notes)
            if len(notes) < 100:
                break  # last page
            page += 1
    return all_notes


def add_note(
    iid: int,
    body: str,
    project_id: Optional[str] = None,
    confidential: bool = False,
    gitlab_token: Optional[str] = None,
) -> dict:
    """이슈에 노트를 추가한다.

    gitlab_token: 사용자 본인의 OAuth/PAT 토큰 (Bearer).
      - 사용자 코멘트: 반드시 제공 (없으면 ValueError)
      - 시스템 자동 노트: _headers()의 서비스 토큰 사용
    """
    payload: dict = {"body": body}
    if confidential:
        payload["confidential"] = True
    headers = _get_headers(gitlab_token)  # 시스템 자동 노트는 서비스 토큰 사용
    with _http_ctx() as client:
        resp = client.post(
            f"{_base(project_id)}/issues/{iid}/notes",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def update_note(
    iid: int,
    note_id: int,
    body: str,
    project_id: Optional[str] = None,
    gitlab_token: Optional[str] = None,
) -> dict:
    """이슈 노트(댓글)를 수정한다. gitlab_token은 작성자 본인 토큰이어야 한다."""
    headers = _get_headers(gitlab_token)
    with _http_ctx() as client:
        resp = client.put(
            f"{_base(project_id)}/issues/{iid}/notes/{note_id}",
            headers=headers,
            json={"body": body},
        )
        resp.raise_for_status()
        return resp.json()


def delete_note(
    iid: int,
    note_id: int,
    project_id: Optional[str] = None,
    gitlab_token: Optional[str] = None,
) -> None:
    """이슈 노트(댓글)를 삭제한다."""
    headers = _get_headers(gitlab_token)
    with _http_ctx() as client:
        resp = client.delete(
            f"{_base(project_id)}/issues/{iid}/notes/{note_id}",
            headers=headers,
        )
        if resp.status_code not in (200, 204):
            resp.raise_for_status()


def delete_issue(iid: int, project_id: Optional[str] = None, gitlab_token: Optional[str] = None) -> None:
    with _http_ctx() as client:
        resp = client.delete(f"{_base(project_id)}/issues/{iid}", headers=_get_headers(gitlab_token))
        resp.raise_for_status()


def update_issue(
    iid: int,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
    labels: list[str] | None = None,
    state_event: str | None = None,
    project_id: Optional[str] = None,
    assignee_id: Optional[int] = None,
    title: Optional[str] = None,
    description: Optional[str] = None,
    milestone_id: Optional[int] = None,
    gitlab_token: Optional[str] = None,
) -> dict:
    payload: dict = {}
    if title:
        payload["title"] = title
    if description is not None:
        payload["description"] = description
    if labels is not None:
        # Send full labels list directly — more reliable than add/remove combo
        payload["labels"] = ",".join(labels)
    else:
        if add_labels:
            payload["add_labels"] = ",".join(add_labels)
        if remove_labels:
            payload["remove_labels"] = ",".join(remove_labels)
    if state_event:
        payload["state_event"] = state_event
    if assignee_id is not None:
        # -1 means unassign, otherwise set
        payload["assignee_ids"] = [] if assignee_id == -1 else [assignee_id]
    if milestone_id is not None:
        # 0 means remove milestone, otherwise set
        payload["milestone_id"] = None if milestone_id == 0 else milestone_id
    with _http_ctx() as client:
        resp = client.put(
            f"{_base(project_id)}/issues/{iid}",
            headers=_get_headers(gitlab_token),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def upload_file(
    project_id: str,
    filename: str,
    content: bytes,
    content_type: str,
    gitlab_token: str | None = None,
) -> dict:
    """GitLab 프로젝트에 파일을 업로드하고 결과(markdown, url 등)를 반환.

    gitlab_token을 지정하면 해당 사용자 토큰으로 업로드한다 (타 프로젝트 접근 시 필요).
    """
    token = gitlab_token or get_settings().GITLAB_PROJECT_TOKEN
    with _http_ctx(timeout=60) as client:
        resp = client.post(
            f"{_base(project_id)}/uploads",
            headers={"PRIVATE-TOKEN": token},
            files={"file": (filename, content, content_type)},
        )
        resp.raise_for_status()
        result = resp.json()
        # full_path: /-/project/{id}/uploads/{hash}/{filename} → 프록시에서 project_id 직접 추출 가능
        result["proxy_path"] = result.get("full_path", "")
        return result


_labels_initialized: set[str] = set()

# status:: / prio:: 는 워크플로우 고정값 — 코드에서 직접 참조하므로 변경 불가
REQUIRED_LABELS = [
    ("status::open",              "#5cb85c"),
    ("status::approved",          "#27ae60"),
    ("status::in_progress",       "#0275d8"),
    ("status::waiting",           "#f0ad4e"),
    ("status::resolved",          "#5bc0de"),
    ("status::testing",           "#8e44ad"),
    ("status::ready_for_release", "#e67e22"),
    ("status::released",          "#2980b9"),
    ("prio::low",                 "#bdc3c7"),
    ("prio::medium",        "#f39c12"),
    ("prio::high",          "#e67e22"),
    ("prio::critical",      "#e74c3c"),
]

# cat:: 라벨은 DB service_types 테이블에서 동적으로 관리
# (값: cat::{service_type.value}, 색상: service_type.color)


def get_category_labels_from_db() -> list[tuple[str, str]]:
    """DB service_types → GitLab cat:: 라벨 목록 반환 (label 기준)."""
    try:
        from .database import SessionLocal
        from .models import ServiceType
        with SessionLocal() as db:
            types = db.query(ServiceType).all()
            return [(f"cat::{t.label}", t.color or "#95a5a6") for t in types]
    except Exception:
        return []


def get_category_labels_with_meta() -> list[dict]:
    """DB service_types → cat:: 라벨 + 서비스 유형 메타데이터 반환."""
    try:
        from .database import SessionLocal
        from .models import ServiceType
        with SessionLocal() as db:
            types = db.query(ServiceType).order_by(ServiceType.sort_order, ServiceType.id).all()
            return [
                {
                    "name": f"cat::{t.label}",
                    "color": t.color or "#95a5a6",
                    "service_label": t.label,
                    "service_emoji": t.emoji or "📋",
                    "service_value": t.value,
                    "enabled": t.enabled,
                }
                for t in types
            ]
    except Exception:
        return []


def sync_label_to_gitlab(name: str, color: str, project_id: Optional[str] = None) -> bool:
    """GitLab 프로젝트 + 그룹 양쪽에 라벨이 없으면 생성한다. 이미 있으면 색상 업데이트."""
    s = get_settings()
    pid = project_id or s.GITLAB_PROJECT_ID
    success = True

    with _http_ctx() as client:
        # 프로젝트 레벨
        try:
            r = client.get(f"{_base(pid)}/labels/{name}", headers=_headers())
            if r.status_code == 404:
                client.post(f"{_base(pid)}/labels", headers=_headers(),
                            json={"name": name, "color": color})
            elif r.is_success:
                client.put(f"{_base(pid)}/labels/{name}", headers=_headers(),
                           json={"color": color})
        except Exception as e:
            logger.warning("sync_label project level error [%s]: %s", name, e)
            success = False

        # 그룹 레벨 (설정된 경우)
        if s.GITLAB_GROUP_ID and s.GITLAB_GROUP_TOKEN:
            g_headers = {"PRIVATE-TOKEN": s.GITLAB_GROUP_TOKEN, "Content-Type": "application/json"}
            url_base = f"{s.GITLAB_API_URL}/api/v4/groups/{s.GITLAB_GROUP_ID}"
            try:
                r = client.get(f"{url_base}/labels/{name}", headers=g_headers)
                if r.status_code == 404:
                    client.post(f"{url_base}/labels", headers=g_headers,
                                json={"name": name, "color": color})
                elif r.is_success:
                    client.put(f"{url_base}/labels/{name}", headers=g_headers,
                               json={"color": color})
            except Exception as e:
                logger.warning("sync_label group level error [%s]: %s", name, e)

    return success


def get_label_sync_status(project_id: Optional[str] = None) -> dict:
    """GitLab 프로젝트·그룹의 라벨 동기화 현황 반환."""
    s = get_settings()
    pid = project_id or s.GITLAB_PROJECT_ID

    project_labels: set[str] = set()
    group_labels: set[str] = set()

    with _http_ctx(timeout=10) as client:
        r = client.get(f"{_base(pid)}/labels", headers=_headers(),
                       params={"per_page": 100, "include_ancestor_groups": "false"})
        if r.is_success:
            project_labels = {lb["name"] for lb in r.json()}

        if s.GITLAB_GROUP_ID and s.GITLAB_GROUP_TOKEN:
            g_headers = {"PRIVATE-TOKEN": s.GITLAB_GROUP_TOKEN}
            rg = client.get(f"{s.GITLAB_API_URL}/api/v4/groups/{s.GITLAB_GROUP_ID}/labels",
                            headers=g_headers, params={"per_page": 100})
            if rg.is_success:
                group_labels = {lb["name"] for lb in rg.json()}

    # 고정 라벨 한글 표시명 매핑
    _LABEL_DISPLAY: dict[str, tuple[str, str]] = {
        "status::open":              ("📥", "접수됨"),
        "status::approved":          ("✅", "승인완료"),
        "status::in_progress":       ("⚙️", "처리중"),
        "status::waiting":           ("⏳", "대기중"),
        "status::resolved":          ("🔧", "처리완료"),
        "status::testing":           ("🧪", "테스트중"),
        "status::ready_for_release": ("📦", "운영배포전"),
        "status::released":          ("🚀", "운영반영완료"),
        "prio::low":           ("⚪", "낮음"),
        "prio::medium":        ("🟡", "보통"),
        "prio::high":          ("🟠", "높음"),
        "prio::critical":      ("🔴", "긴급"),
    }

    # status:: / prio:: (고정)
    result = []
    for name, color in REQUIRED_LABELS:
        emoji, kor = _LABEL_DISPLAY.get(name, ("", ""))
        result.append({
            "name": name,
            "color": color,
            "in_project": name in project_labels,
            "in_group": name in group_labels,
            "synced": (name in project_labels) and (not s.GITLAB_GROUP_ID or name in group_labels),
            "service_label": kor or None,
            "service_emoji": emoji or None,
            "service_value": None,
            "enabled": True,
        })

    # cat:: (서비스 유형 메타데이터 포함)
    for meta in get_category_labels_with_meta():
        name = meta["name"]
        result.append({
            "name": name,
            "color": meta["color"],
            "in_project": name in project_labels,
            "in_group": name in group_labels,
            "synced": (name in project_labels) and (not s.GITLAB_GROUP_ID or name in group_labels),
            "service_label": meta["service_label"],
            "service_emoji": meta["service_emoji"],
            "service_value": meta["service_value"],
            "enabled": meta["enabled"],
        })

    return {"labels": result, "project_label_count": len(project_labels),
            "group_label_count": len(group_labels)}


def _fetch_existing_labels() -> set[str]:
    """ITSM 메인 프로젝트(또는 그룹)의 현재 레이블 이름 집합을 반환한다.

    - 프로젝트 레이블을 include_ancestor_groups=true 로 조회해
      그룹 레이블도 함께 가져온다 (권한 문제로 그룹 API 직접 조회 실패 시 대비).
    """
    s = get_settings()
    names: set[str] = set()
    # 프로젝트 레이블 + 상위 그룹 레이블 포함 조회 (단일 API 호출로 충분)
    try:
        with _http_ctx(timeout=15) as client:
            resp = client.get(
                f"{_base()}/labels",
                headers=_headers(),
                params={"per_page": 100, "include_ancestor_groups": "true"},
            )
            if resp.is_success:
                names.update(lb["name"] for lb in resp.json())
    except Exception:
        pass
    # 그룹 레이블 직접 조회 (보완용 — 실패 시 무시)
    if s.GITLAB_GROUP_ID and s.GITLAB_GROUP_TOKEN and not names:
        try:
            with _http_ctx(timeout=15) as client:
                resp = client.get(
                    f"{s.GITLAB_API_URL}/api/v4/groups/{s.GITLAB_GROUP_ID}/labels",
                    headers={"PRIVATE-TOKEN": s.GITLAB_GROUP_TOKEN},
                    params={"per_page": 100},
                )
                if resp.is_success:
                    names.update(lb["name"] for lb in resp.json())
        except Exception:
            pass
    return names


def ensure_project_labels(
    project_id: str,
    label_names: list[str],
    gitlab_token: str,
) -> None:
    """지정한 프로젝트에 없는 라벨을 생성한다.

    전달 이슈 생성 전 호출해 대상 프로젝트에 라벨을 보장한다.
    gitlab_token은 해당 프로젝트에 Maintainer 이상 권한이 있어야 한다.
    실패는 무시한다(라벨 없이도 이슈는 생성 가능).
    """
    if not label_names:
        return
    s = get_settings()
    headers = {"PRIVATE-TOKEN": gitlab_token, "Content-Type": "application/json"}
    base = f"{s.GITLAB_API_URL}/api/v4/projects/{project_id}"

    with _http_ctx() as client:
        # 기존 라벨 수집 (프로젝트 + 상속 포함)
        existing: set[str] = set()
        try:
            resp = client.get(f"{base}/labels", headers=headers, params={"per_page": 100})
            if resp.is_success:
                existing = {lb["name"] for lb in resp.json()}
        except Exception:
            pass

        label_color_map = {name: color for name, color in REQUIRED_LABELS}
        for name in label_names:
            if name in existing:
                continue
            color = label_color_map.get(name, "#6699cc")
            try:
                client.post(
                    f"{base}/labels",
                    headers=headers,
                    json={"name": name, "color": color},
                )
            except Exception:
                pass


def register_project_webhook(
    project_id: str,
    url: str,
    secret: str = "",
    gitlab_token: Optional[str] = None,
) -> dict:
    """개발 프로젝트에 웹훅을 등록하고 hook id를 반환한다.

    gitlab_token: 해당 프로젝트에 접근 가능한 사용자 Bearer 토큰.
    없으면 서비스 토큰(_headers)으로 시도한다.
    SSRF 방지: 내부망 URL 등록 차단 (ITSM 내부 URL은 예외 허용).
    """
    from .security import is_safe_external_url
    s_check = get_settings()
    # ITSM 자체 웹훅 URL(내부 통신)은 SSRF 검사 면제
    itsm_webhook = getattr(s_check, "ITSM_WEBHOOK_URL", "")
    if url != itsm_webhook:
        ok, reason = is_safe_external_url(
            url,
            allow_internal=(getattr(s_check, "ENVIRONMENT", "production") == "development"),
        )
        if not ok:
            raise ValueError(f"웹훅 URL SSRF 차단: {reason}")
    headers = _get_headers(gitlab_token)
    payload: dict = {
        "url": url,
        "issues_events": True,
        "merge_requests_events": True,
        "push_events": True,
        "pipeline_events": True,
        "confidential_issues_events": False,
        "note_events": True,
    }
    if secret:
        payload["token"] = secret
    s = get_settings()
    with _http_ctx() as client:
        resp = client.post(
            f"{s.GITLAB_API_URL}/api/v4/projects/{project_id}/hooks",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def get_issue_linked_mrs(iid: int, project_id: Optional[str] = None) -> list[dict]:
    """G-2: Return Merge Requests related to the given issue."""
    try:
        with _http_ctx() as client:
            resp = client.get(
                f"{_base(project_id)}/issues/{iid}/related_merge_requests",
                headers=_headers(),
                params={"per_page": 50},
            )
            if resp.is_success:
                return resp.json()
    except Exception as e:
        logger.warning("Failed to fetch linked MRs for issue #%s: %s", iid, e)
    return []


def get_issue_links(iid: int, project_id: Optional[str] = None) -> list[dict]:
    """이슈 관계(Linked Issues) 목록 반환 — link_type: relates_to | blocks | is_blocked_by."""
    try:
        with _http_ctx() as client:
            resp = client.get(
                f"{_base(project_id)}/issues/{iid}/links",
                headers=_headers(),
                params={"per_page": 50},
            )
            if resp.is_success:
                return resp.json()
    except Exception as e:
        logger.warning("Failed to fetch issue links for #%s: %s", iid, e)
    return []


def create_issue_link(
    iid: int,
    target_iid: int,
    link_type: str = "relates_to",
    project_id: Optional[str] = None,
    target_project_id: Optional[str] = None,
) -> dict | None:
    """두 이슈 사이에 관계를 생성한다. link_type: relates_to | blocks | is_blocked_by."""
    s = get_settings()
    target_pid = target_project_id or project_id or str(s.GITLAB_PROJECT_ID)
    try:
        with _http_ctx() as client:
            resp = client.post(
                f"{_base(project_id)}/issues/{iid}/links",
                headers=_headers(),
                json={"target_project_id": int(target_pid), "target_issue_iid": target_iid, "link_type": link_type},
            )
            if resp.is_success:
                return resp.json()
            logger.warning("create_issue_link failed: %s %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("Failed to create issue link #%s→#%s: %s", iid, target_iid, e)
    return None


def delete_issue_link(iid: int, link_id: int, project_id: Optional[str] = None) -> bool:
    """이슈 관계 삭제."""
    try:
        with _http_ctx() as client:
            resp = client.delete(
                f"{_base(project_id)}/issues/{iid}/links/{link_id}",
                headers=_headers(),
            )
            return resp.is_success
    except Exception as e:
        logger.warning("Failed to delete issue link %s for #%s: %s", link_id, iid, e)
    return False


def search_issues(
    query: str,
    project_id: Optional[str] = None,
    state: Optional[str] = None,
    per_page: int = 20,
) -> list[dict]:
    """GitLab 이슈 전문검색 (제목+설명 대상).

    GitLab의 /projects/{id}/search?scope=issues&search={query} API를 사용한다.
    """
    s = get_settings()
    pid = project_id or str(s.GITLAB_PROJECT_ID)
    params: dict = {
        "scope": "issues",
        "search": query,
        "per_page": min(per_page, 50),
    }
    if state:
        params["state"] = state  # "opened" | "closed"
    try:
        with _http_ctx(timeout=15) as client:
            resp = client.get(
                f"{s.GITLAB_API_URL}/api/v4/projects/{pid}/search",
                headers=_headers(),
                params=params,
            )
            if resp.is_success:
                return resp.json()
            logger.warning("search_issues: status %d (query_len=%d)", resp.status_code, len(query))
    except Exception as e:
        logger.warning("search_issues failed: %s", e)
    return []


def get_milestones(project_id: Optional[str] = None, state: str = "active") -> list[dict]:
    """프로젝트 마일스톤 목록 반환.

    state: 'active' | 'closed' | 'all'
    반환: [{id, iid, title, due_date, state, description}, ...]
    """
    try:
        with _http_ctx() as client:
            resp = client.get(
                f"{_base(project_id)}/milestones",
                headers=_headers(),
                params={"state": state, "per_page": 100, "include_parent_milestones": True},
            )
            if resp.is_success:
                return resp.json()
            logger.warning("get_milestones: status %d for project %s", resp.status_code, project_id)
    except Exception as e:
        logger.warning("get_milestones failed: %s", e)
    return []


_GROUP_LABELS_INITIALIZED = False


def cleanup_duplicate_project_labels(project_id: Optional[str] = None) -> dict:
    """프로젝트 레벨 라벨 중 그룹 라벨과 이름이 겹치는 것을 삭제한다.

    그룹 라벨이 우선 사용되도록 하위 프로젝트의 중복 라벨을 정리한다.
    GITLAB_GROUP_ID + GITLAB_GROUP_TOKEN이 설정되지 않으면 스킵한다.
    반환: {"project_id": str, "deleted": [name, ...], "errors": [...]}
    """
    s = get_settings()
    pid = project_id or str(s.GITLAB_PROJECT_ID)
    group_id = s.GITLAB_GROUP_ID
    group_token = s.GITLAB_GROUP_TOKEN

    if not group_id or not group_token:
        return {"skipped": True, "reason": "group not configured"}

    group_headers = {"PRIVATE-TOKEN": group_token, "Content-Type": "application/json"}
    _headers()

    with _http_ctx() as client:
        # 1. 그룹 라벨 이름 목록 수집
        group_label_names: set[str] = set()
        try:
            resp = client.get(
                f"{s.GITLAB_API_URL}/api/v4/groups/{group_id}/labels",
                headers=group_headers,
                params={"per_page": 100},
            )
            if resp.is_success:
                group_label_names = {lb["name"] for lb in resp.json()}
        except Exception as e:
            logger.warning("Failed to fetch group labels: %s", e)
            return {"skipped": True, "reason": str(e)}

        if not group_label_names:
            return {"project_id": pid, "deleted": [], "errors": [], "skipped": True, "reason": "no group labels found"}

        # 2. 프로젝트 전용 라벨만 조회 (그룹 상속 라벨 제외)
        # 조회는 서비스 토큰으로, 삭제는 그룹 토큰으로 (Maintainer 권한 필요)
        try:
            resp = client.get(
                f"{s.GITLAB_API_URL}/api/v4/projects/{pid}/labels",
                headers=group_headers,
                params={"per_page": 100, "include_ancestor_groups": "false"},
            )
            resp.raise_for_status()
            project_labels = resp.json()
        except Exception as e:
            logger.warning("Failed to fetch project labels for %s: %s", pid, e)
            return {"skipped": True, "reason": str(e)}

        # 3. 그룹 라벨과 이름이 겹치는 프로젝트 라벨 삭제 (그룹 토큰 사용)
        deleted: list[str] = []
        errors: list[dict] = []
        for lb in project_labels:
            if lb["name"] not in group_label_names:
                continue
            try:
                del_resp = client.delete(
                    f"{s.GITLAB_API_URL}/api/v4/projects/{pid}/labels/{lb['id']}",
                    headers=group_headers,
                )
                del_resp.raise_for_status()
                deleted.append(lb["name"])
                logger.info("Deleted duplicate project label '%s' from project %s", lb["name"], pid)
            except Exception as e:
                errors.append({"name": lb["name"], "error": str(e)})
                logger.warning("Failed to delete label '%s' from project %s: %s", lb["name"], pid, e)

    return {"project_id": pid, "deleted": deleted, "errors": errors}


def ensure_labels(project_id: Optional[str] = None) -> None:
    """ITSM 필수 라벨을 그룹 + 프로젝트 양쪽에 생성한다.

    두 레벨 모두 생성해야 하는 이유:
    - 그룹 레벨: 개발 프로젝트 전달 시 해당 프로젝트에서도 status::/prio:: 라벨 사용 가능
    - 프로젝트 레벨: ITSM 이슈가 프로젝트 레벨 라벨을 직접 참조 — 이를 삭제하면
      GitLab이 이슈의 라벨을 자동 제거하므로 반드시 유지
    - 두 레벨 라벨은 절대 삭제하지 않는다 (기존 이슈 라벨 참조 보호)
    - 이미 존재하는 라벨은 무시하며, 프로세스당 1회만 실행한다.
    """
    global _GROUP_LABELS_INITIALIZED
    s = get_settings()
    pid = project_id or s.GITLAB_PROJECT_ID
    group_id = s.GITLAB_GROUP_ID
    group_token = s.GITLAB_GROUP_TOKEN

    # ── 1) 그룹 레벨 라벨 생성 (설정된 경우) ──────────────────────────────
    # 개발 프로젝트 전달 시 전달 대상 프로젝트에서도 공통 라벨 사용 가능
    if group_id and group_token and not _GROUP_LABELS_INITIALIZED:
        url_base = f"{s.GITLAB_API_URL}/api/v4/groups/{group_id}"
        g_headers = {"PRIVATE-TOKEN": group_token, "Content-Type": "application/json"}
        with _http_ctx() as client:
            existing_group: set[str] = set()
            try:
                resp = client.get(f"{url_base}/labels", headers=g_headers, params={"per_page": 100})
                if resp.is_success:
                    existing_group = {lb["name"] for lb in resp.json()}
            except Exception:
                pass
            all_labels = list(REQUIRED_LABELS) + get_category_labels_from_db()
            for name, color in all_labels:
                if name in existing_group:
                    continue
                try:
                    client.post(f"{url_base}/labels", headers=g_headers,
                                json={"name": name, "color": color})
                except Exception:
                    pass
        _GROUP_LABELS_INITIALIZED = True
        logger.info("Group labels ensured for group %s", group_id)

    # ── 2) 프로젝트 레벨 라벨 생성 ──────────────────────────────────────
    # ITSM 이슈는 프로젝트 레벨 라벨을 직접 참조하므로 별도 유지 필수
    # (그룹 레벨 라벨이 있어도 삭제하지 않음 — 삭제 시 이슈 라벨 자동 제거됨)
    if pid in _labels_initialized:
        return
    with _http_ctx() as client:
        existing_proj: set[str] = set()
        try:
            resp = client.get(f"{_base(pid)}/labels", headers=_headers(), params={"per_page": 100})
            if resp.is_success:
                existing_proj = {lb["name"] for lb in resp.json()}
        except Exception:
            pass
        all_labels = list(REQUIRED_LABELS) + get_category_labels_from_db()
        for name, color in all_labels:
            if name in existing_proj:
                continue
            try:
                client.post(f"{_base(pid)}/labels", headers=_headers(),
                            json={"name": name, "color": color})
            except Exception:
                pass
    _labels_initialized.add(pid)
    logger.info("Project labels ensured for project %s", pid)


def trigger_pipeline(
    ref: str,
    variables: dict[str, str] | None = None,
    project_id: Optional[str] = None,
) -> dict:
    """GitLab CI/CD 파이프라인 트리거.

    Args:
        ref: 브랜치 또는 태그 이름
        variables: 파이프라인 변수 딕셔너리
        project_id: 대상 프로젝트 ID (기본: 설정값)

    Returns:
        GitLab API pipeline 응답 dict
    """
    payload: dict = {"ref": ref}
    if variables:
        payload["variables"] = [
            {"key": k, "value": v} for k, v in variables.items()
        ]
    with _http_ctx() as client:
        resp = client.post(
            f"{_base(project_id)}/pipeline",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def get_user_email(user_id: int) -> Optional[str]:
    """GitLab 사용자 이메일 조회.

    관리자 토큰이 있을 때만 email 필드가 반환된다.
    접근 불가 시 None 반환.
    """
    try:
        s = get_settings()
        with _http_ctx() as client:
            resp = client.get(f"{s.GITLAB_API_URL}/api/v4/users/{user_id}", headers=_headers())
            if resp.is_success:
                return resp.json().get("email") or None
    except Exception:
        pass
    return None


def list_pipelines(
    ref: Optional[str] = None,
    per_page: int = 10,
    project_id: Optional[str] = None,
) -> list[dict]:
    """최근 파이프라인 목록 조회."""
    params: dict = {"per_page": per_page, "order_by": "id", "sort": "desc"}
    if ref:
        params["ref"] = ref
    with _http_ctx() as client:
        resp = client.get(
            f"{_base(project_id)}/pipelines",
            headers=_headers(),
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
