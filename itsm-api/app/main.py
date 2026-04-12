import asyncio
import contextvars
import json
import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .database import engine, Base, SessionLocal
from .routers import auth, tickets, ratings, projects
from .routers import admin, webhooks, kb, reports
from .routers.portal import router as portal_router
from .routers.notifications_router import router as notifications_router
from .routers.templates import router as templates_router, link_router, time_router
from .routers.forwards import router as forwards_router, admin_router as forwards_admin_router
from .routers.filters import router as filters_router
from .routers.quick_replies import router as quick_replies_router
from .routers.watchers import router as watchers_router, my_router as watchers_my_router
from .routers.automation import router as automation_router
from .routers.approvals import router as approvals_router
from .routers.ticket_types import router as ticket_types_router
from .routers.service_catalog import router as service_catalog_router
from .routers.dashboard import router as dashboard_router
from .routers.ip_allowlist import router as ip_allowlist_router
from .routers.faq import router as faq_router
from .routers.custom_fields import admin_router as custom_fields_admin_router, ticket_router as custom_fields_ticket_router
from .routers.users import router as users_router
from .routers.admin.recurring_tickets import router as recurring_tickets_router
from .routers.changes import router as changes_router
from .routers.push import router as push_router
from .routers.problems import router as problems_router
from .routers.notification_rules import router as notification_rules_router
from .routers.admin.ai_settings import router as ai_settings_router
from . import gitlab_client
from . import sla as sla_module
from .routers.reports import take_snapshot

# Request-scoped context variable — 각 비동기 태스크(요청)마다 독립적으로 관리됨
_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _JsonFormatter(logging.Formatter):
    """표준 라이브러리만으로 구현한 JSON 구조화 로그 포매터.

    ELK / Loki 파이프라인에서 별도 정규식 파싱 없이 바로 인덱싱 가능.
    """

    # LogRecord 기본 필드 — payload에 이미 포함됐거나 불필요한 필드 제외
    _SKIP = frozenset({
        "msg", "args", "created", "relativeCreated", "msecs",
        "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "filename", "module", "pathname", "process", "processName",
        "thread", "threadName", "taskName", "levelname", "levelno", "name",
    })

    def format(self, record: logging.LogRecord) -> str:
        # extra={"req_id": ...} 로 명시된 경우 우선 사용, 없으면 ContextVar에서 읽음
        req_id = getattr(record, "req_id", None) or _request_id_var.get()
        payload: dict = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),   # args가 format string에 주입된 완성 메시지
            "req_id": req_id,
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # extra 키 추가 (기본 필드 덮어쓰기 방지)
        for key, val in record.__dict__.items():
            if key in self._SKIP or key.startswith("_"):
                continue
            if key in payload:
                continue
            try:
                json.dumps(val)
                payload[key] = val
            except (TypeError, ValueError):
                payload[key] = str(val)
        return json.dumps(payload, ensure_ascii=False)


_json_handler = logging.StreamHandler()
_json_handler.setFormatter(_JsonFormatter())
logging.root.setLevel(logging.INFO)
logging.root.handlers = [_json_handler]
# 외부 라이브러리 로그 레벨 조정 (과도한 DEBUG 로그 차단)
for _noisy in ("httpx", "httpcore", "uvicorn.access"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

_sla_thread_stop = threading.Event()
_snapshot_thread_stop = threading.Event()
_email_ingest_stop = threading.Event()
_user_sync_stop = threading.Event()

# 첫 접속 시 스냅샷 생성용 — 오늘 날짜와 비교해 하루 1회만 트리거
_last_snapshot_check: date | None = None
_snapshot_check_lock: asyncio.Lock | None = None


def _get_snapshot_check_lock() -> asyncio.Lock:
    global _snapshot_check_lock
    if _snapshot_check_lock is None:
        _snapshot_check_lock = asyncio.Lock()
    return _snapshot_check_lock


def _sla_checker_loop():
    """Background thread: check SLA breaches and warnings every 5 minutes.

    기동 후 60초 대기 후 첫 실행 — 스타트업 부하 분산.
    """
    _sla_thread_stop.wait(timeout=60)  # 기동 직후 60초 대기
    while not _sla_thread_stop.is_set():
        try:
            with SessionLocal() as db:
                breached = sla_module.check_and_flag_breaches(db)
                if breached:
                    logger.info("SLA checker flagged %d new breaches", len(breached))
                warned = sla_module.check_and_send_warnings(db)
                if warned:
                    logger.info("SLA checker sent %d warning notifications", len(warned))
                escalated = sla_module.check_and_escalate(db)
                if escalated:
                    logger.info("SLA escalation executed %d action(s)", len(escalated))
        except Exception as e:
            logger.error("SLA checker error: %s", e)
        _sla_thread_stop.wait(timeout=300)  # 5 minutes


def _seconds_until_midnight() -> float:
    """다음 KST 자정 00:05까지 남은 초를 반환.

    컨테이너는 UTC로 동작할 수 있으므로 KST를 명시해 의도한 한국 시간 기준 스냅샷 생성을 보장.
    """
    from zoneinfo import ZoneInfo
    kst = ZoneInfo("Asia/Seoul")
    now = datetime.now(tz=kst)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return (midnight - now).total_seconds()


def _snapshot_scheduler_loop():
    """Background thread: 매일 자정 00:05에 모든 프로젝트 스냅샷 생성."""
    # 기동 시 오늘치 스냅샷 즉시 생성
    _run_daily_snapshots(reason="startup")

    while not _snapshot_thread_stop.is_set():
        wait_secs = _seconds_until_midnight()
        logger.info("Snapshot scheduler: next run in %.0f seconds", wait_secs)
        _snapshot_thread_stop.wait(timeout=wait_secs)
        if _snapshot_thread_stop.is_set():
            break
        _run_daily_snapshots(reason="scheduled")


def _run_daily_snapshots(reason: str = "scheduled"):
    """등록된 모든 프로젝트에 대해 스냅샷을 병렬 생성."""
    import concurrent.futures
    settings = get_settings()
    try:
        all_projects = gitlab_client.get_user_projects("0") or []
        project_ids = [str(p["id"]) for p in all_projects] if all_projects else []
    except Exception:
        project_ids = []

    if not project_ids:
        project_ids = [str(settings.GITLAB_PROJECT_ID)]

    def _snap(pid: str) -> None:
        try:
            with SessionLocal() as db:
                result = take_snapshot(pid, db)
                logger.info("Daily snapshot [%s] project=%s → %s", reason, pid, result["message"])
        except Exception as e:
            logger.error("Daily snapshot failed for project %s: %s", pid, e)

    # 프로젝트가 1개면 직접 실행, 여러 개면 병렬 처리
    if len(project_ids) <= 1:
        for pid in project_ids:
            _snap(pid)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(project_ids), 4)) as pool:
            pool.map(_snap, project_ids)

    # 만료된 SudoToken 정리 (매일 자정)
    try:
        from .models import SudoToken
        with SessionLocal() as db:
            cutoff = datetime.now(timezone.utc).replace(tzinfo=None)
            deleted = db.query(SudoToken).filter(SudoToken.expires_at <= cutoff).delete()
            db.commit()
            if deleted:
                logger.info("Cleaned up %d expired sudo tokens", deleted)
    except Exception as e:
        logger.warning("SudoToken cleanup failed: %s", e)


def _user_sync_loop():
    """Background thread: 매 시간 GitLab 그룹 멤버와 ITSM 사용자 역할 동기화.

    퇴사/그룹 제거된 사용자를 is_active=False로 비활성화한다.
    기동 후 90초 대기 후 첫 실행 — 스타트업 부하 분산.
    """
    settings = get_settings()
    interval = getattr(settings, "USER_SYNC_INTERVAL", 3600)  # 기본 1시간
    _user_sync_stop.wait(timeout=90)  # 기동 직후 90초 대기
    while not _user_sync_stop.is_set():
        try:
            _run_user_sync()
        except Exception as e:
            logger.error("User sync error: %s", e)
        _user_sync_stop.wait(timeout=interval)


def _run_user_sync():
    """GitLab 그룹/프로젝트 멤버 목록과 user_roles 테이블을 비교해 비활성 처리.

    USER_SYNC_REQUIRE_GROUP=true (기본값): 그룹 멤버에서 제거되면 비활성 처리.
      프로젝트에만 남아있어도 그룹에 없으면 is_active=False.
    USER_SYNC_REQUIRE_GROUP=false: 그룹 OR 프로젝트 멤버 중 하나라도 해당하면 활성 유지.
    """
    from .models import UserRole

    settings = get_settings()
    require_group = getattr(settings, "USER_SYNC_REQUIRE_GROUP", True)

    group_ids: set[int] = set()
    project_ids_set: set[int] = set()
    gitlab_admin_ids: set[int] = set()

    # 0. GitLab 인스턴스 관리자(is_admin=true) 수집 — 그룹/프로젝트 멤버 여부와 무관하게 항상 활성
    try:
        import httpx as _httpx
        _headers = {"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN}
        _resp = _httpx.get(
            f"{settings.GITLAB_API_URL}/api/v4/users",
            headers=_headers,
            params={"admins": "true", "per_page": 100},
            timeout=10,
        )
        if _resp.is_success:
            gitlab_admin_ids = {int(u["id"]) for u in _resp.json()}
            logger.info("User sync: %d GitLab instance admin(s) found — always active", len(gitlab_admin_ids))
    except Exception as e:
        logger.warning("User sync: failed to fetch GitLab admins: %s", e)

    # 1. 그룹 멤버 수집 (설정된 경우)
    if settings.GITLAB_GROUP_ID:
        try:
            group_members = gitlab_client.get_group_members(settings.GITLAB_GROUP_ID)
            group_ids = {int(m["id"]) for m in group_members}
            logger.info("User sync: GitLab group has %d members", len(group_ids))
        except Exception as e:
            logger.warning("User sync: failed to fetch GitLab group members: %s", e)

    # 2. ITSM 메인 프로젝트 멤버 수집
    try:
        project_members = gitlab_client.get_project_members(str(settings.GITLAB_PROJECT_ID))
        project_ids_set = {int(m["id"]) for m in project_members}
        logger.info("User sync: ITSM project has %d members", len(project_ids_set))
    except Exception as e:
        logger.warning("User sync: failed to fetch project members: %s", e)

    # 활성 멤버 결정 기준
    if require_group and settings.GITLAB_GROUP_ID:
        # 그룹 멤버십 필수: 그룹에 없으면 프로젝트 멤버여도 비활성
        # 단, GitLab 인스턴스 관리자는 항상 활성
        if not group_ids:
            logger.warning("User sync: group member fetch returned empty (require_group=true) — skipping to avoid mass deactivation")
            return
        active_ids = group_ids | gitlab_admin_ids
        logger.info("User sync: require_group=true, group+admins (%d members)", len(active_ids))
    else:
        # 그룹 OR 프로젝트 멤버 중 하나라도 해당하면 활성 (관리자 포함)
        active_ids = group_ids | project_ids_set | gitlab_admin_ids
        logger.info("User sync: require_group=false, group+project+admins union (%d members)", len(active_ids))

    if not active_ids:
        logger.warning("User sync: no active members found — skipping to avoid mass deactivation")
        return

    logger.info("User sync: total %d active GitLab members", len(active_ids))

    with SessionLocal() as db:
        from .models import ApiKey
        all_users = db.query(UserRole).all()
        changed = 0
        revoked_keys = 0
        for user in all_users:
            was_active = user.is_active
            should_be_active = user.gitlab_user_id in active_ids
            if was_active != should_be_active:
                user.is_active = should_be_active
                changed += 1
                action = "activated" if should_be_active else "deactivated"
                logger.info("User sync: %s user %s (id=%d)", action, user.username, user.gitlab_user_id)
                # 비활성화 시 해당 사용자가 생성한 API 키 자동 폐기 (orphan 방지)
                if not should_be_active:
                    n = (
                        db.query(ApiKey)
                        .filter(ApiKey.created_by == user.username, ApiKey.revoked == False)  # noqa: E712
                        .update({"revoked": True})
                    )
                    if n:
                        revoked_keys += n
                        logger.info("User sync: revoked %d API key(s) owned by deactivated user %s", n, user.username)
        if changed:
            db.commit()
            logger.info("User sync: updated %d user(s), revoked %d api_key(s)", changed, revoked_keys)
        else:
            logger.debug("User sync: no changes")


def _email_ingest_loop():
    """Background thread: poll IMAP inbox for new emails and create tickets."""
    from .email_ingest import process_inbox
    settings = get_settings()
    while not _email_ingest_stop.is_set():
        try:
            count = process_inbox()
            if count:
                logger.info("Email ingest created %d tickets", count)
        except Exception as e:
            logger.error("Email ingest error: %s", e)
        _email_ingest_stop.wait(timeout=settings.IMAP_POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):

    settings = get_settings()

    # M-1: 기본 SECRET_KEY로 기동 금지 (운영 사고 방지)
    _insecure_keys = {"change_me_to_random_32char_string", "secret", "changeme", ""}
    if settings.SECRET_KEY in _insecure_keys or len(settings.SECRET_KEY) < 32:
        raise RuntimeError(
            "SECRET_KEY is insecure or too short (min 32 chars). "
            "Set a strong random value in .env before starting."
        )

    # M-1b: VULN-02 — TOKEN_ENCRYPTION_KEY 미설정 시 운영 환경 기동 차단
    if settings.ENVIRONMENT != "development" and not settings.TOKEN_ENCRYPTION_KEY:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not set. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "and set in .env. Set ENVIRONMENT=development to bypass in dev."
        )

    # M-2: 필수 외부 연동 설정 경고 (기동 차단은 하지 않음 — 개발 환경 고려)
    if not getattr(settings, "GITLAB_PROJECT_TOKEN", None):
        logger.warning("GITLAB_PROJECT_TOKEN is not set — GitLab integration will not work")
    if settings.NOTIFICATION_ENABLED and not getattr(settings, "SMTP_HOST", None):
        logger.warning("NOTIFICATION_ENABLED=true but SMTP_HOST is not set — email notifications will be skipped")

    if settings.ENVIRONMENT == "development":
        logger.info("Development mode: auto-creating tables")
        Base.metadata.create_all(bind=engine)

    try:
        gitlab_client.ensure_labels()
        logger.info("GitLab labels initialized for project %s", settings.GITLAB_PROJECT_ID)
    except Exception as e:
        logger.warning("Failed to initialize GitLab labels: %s", e)

    # Start SLA background checker
    sla_thread = threading.Thread(target=_sla_checker_loop, daemon=True, name="sla-checker")
    sla_thread.start()
    logger.info("SLA checker thread started")

    # Start daily snapshot scheduler
    snap_thread = threading.Thread(target=_snapshot_scheduler_loop, daemon=True, name="snapshot-scheduler")
    snap_thread.start()
    logger.info("Snapshot scheduler thread started")

    # Start user sync thread (hourly GitLab group member sync)
    user_sync_thread = threading.Thread(target=_user_sync_loop, daemon=True, name="user-sync")
    user_sync_thread.start()
    logger.info("User sync thread started")

    # Email ingest는 Celery Beat(periodic_email_ingest)로 처리 — 스레드 방식 제거

    yield

    _sla_thread_stop.set()
    _snapshot_thread_stop.set()
    _user_sync_stop.set()
    logger.info("Shutting down — waiting for background threads (max 55s each)")
    # gunicorn graceful-timeout=60s 기준 — 스레드에 최대 55s 허용
    _THREAD_SHUTDOWN_TIMEOUT = 55
    sla_thread.join(timeout=_THREAD_SHUTDOWN_TIMEOUT)
    snap_thread.join(timeout=_THREAD_SHUTDOWN_TIMEOUT)
    user_sync_thread.join(timeout=_THREAD_SHUTDOWN_TIMEOUT)
    for t, name in [(sla_thread, "sla"), (snap_thread, "snapshot"), (user_sync_thread, "user_sync")]:
        if t.is_alive():
            logger.warning("Background thread '%s' did not stop within %ss — forcing shutdown", name, _THREAD_SHUTDOWN_TIMEOUT)
    logger.info("Background threads stopped")


def _is_production() -> bool:
    return get_settings().ENVIRONMENT.lower() == "production"


app = FastAPI(
    title="ITSM Portal API",
    version="2.0.0",
    description="GitLab CE 기반 ITSM 포털 API",
    lifespan=lifespan,
    # AIRGAP: Swagger/ReDoc 항상 활성화 (내부망 전용 — nginx IP 제한으로 보호)
    # CDN 의존 제거를 위해 기본 docs를 비활성화하고 커스텀 엔드포인트로 대체
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    # nginx /api/ → FastAPI / 로 proxy할 때 redirect URL에 /api prefix 유지
    root_path="/api",
    # trailing slash 없이 접근 시 307 redirect 방지
    redirect_slashes=False,
)

settings = get_settings()

# ── AIRGAP: Swagger UI / ReDoc — CDN 없이 로컬 번들로 서빙 ────────────────────
# pip install 없이 unpkg/jsdelivr 번들을 직접 참조하지 않고,
# FastAPI가 기본 제공하는 get_swagger_ui_html/get_redoc_html에
# 로컬 static URL을 주입.
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
import pathlib as _pathlib

_static_dir = _pathlib.Path(__file__).parent / "static"

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.root_path + "/openapi.json",
        title=app.title + " — Swagger UI",
        # AIRGAP: 로컬 파일 사용 — CDN 불필요
        swagger_js_url="/api/docs-static/swagger-ui-bundle.js",
        swagger_css_url="/api/docs-static/swagger-ui.css",
    )

@app.get("/redoc", include_in_schema=False)
async def custom_redoc_html():
    return get_redoc_html(
        openapi_url=app.root_path + "/openapi.json",
        title=app.title + " — ReDoc",
        redoc_js_url="/api/docs-static/redoc.standalone.js",
    )

# AIRGAP: docs 정적 파일을 명시적 라우트로 서빙 (mount 방식은 미들웨어에 의해 가려짐)
from fastapi.responses import FileResponse as _FileResponse

@app.get("/docs-static/{filename}", include_in_schema=False)
async def serve_docs_static(filename: str):
    safe_name = _pathlib.Path(filename).name  # path traversal 방지
    file_path = _static_dir / safe_name
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media_types = {".js": "application/javascript", ".css": "text/css"}
    mt = media_types.get(file_path.suffix, "application/octet-stream")
    return _FileResponse(str(file_path), media_type=mt, headers={"Cache-Control": "public, max-age=604800"})


# OpenTelemetry 분산 추적
from .telemetry import setup_telemetry
setup_telemetry(app)

# DB 쿼리 프로파일러 (개발 환경에서 per-request 추적 활성화)
from .db_profiler import setup_db_profiler
setup_db_profiler(app, enabled=not _is_production())

# ---------------------------------------------------------------------------
# 표준화된 에러 응답 핸들러
# 모든 HTTP 오류를 { "error": { "code", "message", "detail" } } 구조로 통일
# ---------------------------------------------------------------------------
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": str(exc.status_code), "message": exc.detail}},
        headers=getattr(exc, "headers", None) or {},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    settings = get_settings()
    # 프로덕션 환경에서는 필드명·타입 정보 등 스키마 지문을 숨김
    if settings.ENVIRONMENT == "production":
        detail: object = [
            {"field": ".".join(str(loc) for loc in e.get("loc", [])), "msg": e.get("msg", "")}
            for e in exc.errors()
        ]
    else:
        detail = exc.errors()
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "입력 값이 올바르지 않습니다.",
                "detail": detail,
            }
        },
    )


# Rate limiting — limiter already configured with Redis in rate_limit.py
try:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from .rate_limit import limiter as _limiter

    if _limiter is not None:
        app.state.limiter = _limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        logger.info("Rate limiting enabled")
except Exception as e:
    logger.warning("Rate limiting not available: %s", e)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------
# IP 접근 제한 미들웨어 — DB 기반 실시간 반영 (TTL 캐시 5초)
# localhost(127.0.0.1, ::1) 및 Docker 호스트 머신 IP는 항상 허용
# DB에 활성 항목이 없으면 모든 IP 허용 (비활성화 상태)
#
# [Docker NAT 주의]
# localhost:8111 → Docker NAT → Nginx → FastAPI 경로로 오면
# X-Forwarded-For 에 127.0.0.1 이 아닌 Docker 브리지 게이트웨이 IP
# (예: 192.168.16.1) 가 들어온다. Nginx 컨테이너 IP(request.client.host)와
# 같은 /24 서브넷의 첫 번째 주소(.1) = 호스트 머신 → 항상 허용.
# ---------------------------------------------------------------------------
import ipaddress as _ipmod

_LOOPBACK_NETS = [
    _ipmod.ip_network("127.0.0.0/8"),
    _ipmod.ip_network("::1/128"),
]
# Docker 기본 브리지 네트워크(172.17.0.0/16) 및 Compose 커스텀 네트워크(172.16.0.0/12)
# 포트 바인딩(host→container)을 통해 접속하는 로컬 브라우저 트래픽도 허용
_DOCKER_BRIDGE_NETS = [
    _ipmod.ip_network("172.16.0.0/12"),  # Docker 사설 네트워크 전체 범위
]
_ip_cache: dict = {"nets": [], "loaded_at": 0.0}
_IP_CACHE_TTL = 1.0  # seconds — 긴급 차단 응답성 개선 (5초 → 1초)
_ip_cache_lock: asyncio.Lock | None = None


def _get_ip_cache_lock() -> asyncio.Lock:
    global _ip_cache_lock
    if _ip_cache_lock is None:
        _ip_cache_lock = asyncio.Lock()
    return _ip_cache_lock


def _reload_ip_cache() -> list:
    """DB에서 활성 CIDR 목록을 읽어 네트워크 객체 리스트로 반환."""
    try:
        from .models import IpAllowlistEntry
        with SessionLocal() as db:
            entries = db.query(IpAllowlistEntry).filter_by(is_active=True).all()
            nets = []
            for e in entries:
                try:
                    nets.append(_ipmod.ip_network(e.cidr, strict=False))
                except ValueError:
                    logger.warning("IP allowlist: invalid CIDR in DB: %s", e.cidr)
            return nets
    except Exception as exc:
        logger.error("IP allowlist: cache reload failed: %s", exc)
        return _ip_cache["nets"]  # keep previous on error


def _is_local_ip(client_ip: _ipmod.IPv4Address | _ipmod.IPv6Address, request: Request) -> bool:
    """로컬호스트 또는 Docker 호스트 머신 IP인지 판별.

    Docker Compose 환경에서 localhost 브라우저 접속 시
    X-Forwarded-For 에는 Docker 브리지 게이트웨이(172.17.0.1 등)가 나타난다.
    nginx 컨테이너 서브넷(.1)과 Docker 기본 브리지(172.16/12) 모두 허용한다.
    """
    # 1) 일반 loopback
    if any(client_ip in net for net in _LOOPBACK_NETS):
        return True
    # 2) Docker 호스트 게이트웨이: Nginx 컨테이너와 같은 /24 의 첫 주소(.1)
    if request.client:
        try:
            proxy_net = _ipmod.ip_network(f"{request.client.host}/24", strict=False)
            docker_host_ip = next(proxy_net.hosts())  # .1
            if client_ip == docker_host_ip:
                return True
        except (ValueError, StopIteration):
            pass
    # 3) Docker 기본 브리지(172.16.0.0/12): 포트 바인딩 NAT 경유 로컬 트래픽
    #    proxy(nginx) 자신도 같은 사설 대역일 때만 적용 — 외부 사설망과 혼동 방지
    if request.client:
        try:
            proxy_ip = _ipmod.ip_address(request.client.host)
            if (any(client_ip in net for net in _DOCKER_BRIDGE_NETS)
                    and any(proxy_ip in net for net in _DOCKER_BRIDGE_NETS)):
                return True
        except ValueError:
            pass
    return False


@app.middleware("http")
async def ip_allowlist_middleware(request: Request, call_next):
    """DB 기반 IP 접근 제한. localhost/Docker 호스트 항상 허용, DB 항목 없으면 전체 허용.

    /admin 경로는 항상 검사. 그 외 경로는 admin/superadmin/agent/pl 역할 토큰 소지 시 검사.
    """
    # Decode JWT payload lazily to determine role for non-/admin paths.
    payload: dict | None = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        try:
            import jwt as _jwt
            _JWTError = _jwt.exceptions.InvalidTokenError
            from .auth import ALGORITHM as _ALGORITHM, _is_token_blacklisted
            _settings = get_settings()
            payload = _jwt.decode(token, _settings.SECRET_KEY, algorithms=[_ALGORITHM])
            # Check Redis blacklist — treat blacklisted tokens as unauthenticated
            _jti = payload.get("jti")
            if _jti and _is_token_blacklisted(_jti):
                payload = None
        except Exception:
            payload = None

    # UI에서 모든 인증 사용자에게 필요한 읽기 전용 메타데이터 엔드포인트 — IP 제한 제외
    _IP_ALLOWLIST_BYPASS = frozenset({
        "/admin/filter-options",
        "/admin/service-types",
        "/admin/role-labels",
        "/admin/custom-fields",
    })
    is_admin_path = (
        request.url.path.startswith("/admin")
        and request.url.path not in _IP_ALLOWLIST_BYPASS
    )
    should_check = is_admin_path

    if not should_check and payload is not None:
        role = payload.get("role", "")
        if role in ("admin", "superadmin", "agent", "pl"):
            should_check = True

    if not should_check:
        return await call_next(request)

    # VULN-05: TRUSTED_PROXIES에 명시된 프록시에서만 X-Forwarded-For 신뢰
    # TRUSTED_PROXIES 미설정 시 사설 IP 전체 신뢰 (하위 호환)
    forwarded = request.headers.get("X-Forwarded-For", "")
    client_ip_str = request.client.host if request.client else "0.0.0.0"
    if forwarded and request.client:
        try:
            proxy_addr = _ipmod.ip_address(request.client.host)
            _trusted_proxies_str = getattr(get_settings(), "TRUSTED_PROXIES", "")
            if _trusted_proxies_str:
                # 명시적 TRUSTED_PROXIES CIDR 목록과 비교
                _trusted_nets = []
                for _cidr in _trusted_proxies_str.split(","):
                    _cidr = _cidr.strip()
                    if _cidr:
                        try:
                            _trusted_nets.append(_ipmod.ip_network(_cidr, strict=False))
                        except ValueError:
                            pass
                if any(proxy_addr in net for net in _trusted_nets):
                    client_ip_str = forwarded.split(",")[0].strip()
            elif proxy_addr.is_private:
                # TRUSTED_PROXIES 미설정: 사설 IP 전체 신뢰 (하위 호환)
                client_ip_str = forwarded.split(",")[0].strip()
        except ValueError:
            pass

    try:
        client_ip = _ipmod.ip_address(client_ip_str)
    except ValueError:
        client_ip = _ipmod.ip_address("0.0.0.0")

    # localhost / Docker 호스트 머신 항상 허용
    if _is_local_ip(client_ip, request):
        return await call_next(request)

    # TTL 캐시 갱신 — 락으로 직렬화해 동시 요청 시 중복 DB 조회 방지
    now = time.monotonic()
    if now - _ip_cache["loaded_at"] > _IP_CACHE_TTL:
        async with _get_ip_cache_lock():
            if time.monotonic() - _ip_cache["loaded_at"] > _IP_CACHE_TTL:
                _ip_cache["nets"] = _reload_ip_cache()
                _ip_cache["loaded_at"] = time.monotonic()

    active_nets: list = _ip_cache["nets"]

    # DB에 활성 항목이 없으면 → 기능 비활성 상태, 모두 허용
    if not active_nets:
        return await call_next(request)

    # IP 검사
    if not any(client_ip in net for net in active_nets):
        from fastapi.responses import JSONResponse
        logger.warning("IP allowlist: blocked %s → %s", client_ip_str, request.url.path)
        return JSONResponse(
            status_code=403,
            content={"detail": "접근이 허용되지 않은 IP입니다."},
        )

    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """S-H: API 응답에 보안 헤더 추가."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


@app.middleware("http")
async def ensure_daily_snapshot_on_access(request: Request, call_next):
    """자정에 서버가 꺼져 스냅샷이 누락됐을 때 첫 API 요청 시 백그라운드로 생성."""
    global _last_snapshot_check
    today = date.today()
    async with _get_snapshot_check_lock():
        if _last_snapshot_check != today:
            _last_snapshot_check = today
            threading.Thread(
                target=_run_daily_snapshots,
                kwargs={"reason": "on-access"},
                daemon=True,
                name="snapshot-on-access",
            ).start()
    return await call_next(request)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    # contextvars에 저장 → 이 요청 처리 중 모든 log 레코드에 req_id 자동 포함
    token = _request_id_var.set(request_id)
    try:
        response: Response = await call_next(request)
    finally:
        _request_id_var.reset(token)
    response.headers["X-Request-ID"] = request_id
    return response


# OPT: 자주 변경되지 않는 GET endpoint에 stale-while-revalidate 캐시 헤더 적용
# 브라우저가 max-age 동안은 네트워크 요청 없이 캐시 사용, 이후 백그라운드 revalidation
_CACHEABLE_PATHS = frozenset({
    "/admin/filter-options",    # 상태/우선순위/카테고리 — 거의 안 변함
    "/admin/service-types",     # 서비스 유형 목록
    "/admin/quick-replies",     # 빠른 답변 — 가끔 변경
    "/admin/faq",               # FAQ 목록
})
_SHORT_CACHE_PATHS = frozenset({
    "/tickets/stats",           # 통계 — 30초 캐시
    "/notifications/announcements",  # 공지 — 60초 캐시
})


@app.middleware("http")
async def cache_control_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200:
        path = request.url.path
        if path in _CACHEABLE_PATHS:
            response.headers["Cache-Control"] = "private, max-age=60, stale-while-revalidate=300"
        elif path in _SHORT_CACHE_PATHS:
            response.headers["Cache-Control"] = "private, max-age=10, stale-while-revalidate=30"
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    # add_request_id 미들웨어(inner)가 헤더에 이미 설정한 값을 읽음
    request_id = response.headers.get("X-Request-ID", "-")
    logger.info(
        "%s %s %d %.1fms",
        request.method, request.url.path, response.status_code, elapsed,
        extra={"req_id": request_id},
    )
    return response


# ── API 라우터 등록 ───────────────────────────────────────────────────────────
# 모든 라우터를 APIRouter v1에 집약한 뒤 두 경로로 마운트:
#   /api/v1/...  — 버전 명시 (신규 클라이언트 권장)
#   /...         — 레거시 경로 (하위 호환, 추후 deprecated 예정)
from fastapi import APIRouter as _APIRouter

_v1 = _APIRouter()

# Core routers
_v1.include_router(auth.router)
_v1.include_router(tickets.router)
_v1.include_router(ratings.router)
_v1.include_router(projects.router)

# Enterprise routers
_v1.include_router(admin.router)
_v1.include_router(webhooks.router)
_v1.include_router(kb.router)
_v1.include_router(reports.router)
_v1.include_router(notifications_router)
_v1.include_router(templates_router)
_v1.include_router(link_router)
_v1.include_router(time_router)
_v1.include_router(forwards_router)
_v1.include_router(forwards_admin_router)
_v1.include_router(filters_router)
_v1.include_router(portal_router)
_v1.include_router(quick_replies_router)
_v1.include_router(watchers_router)
_v1.include_router(watchers_my_router)
_v1.include_router(automation_router)
_v1.include_router(approvals_router)
_v1.include_router(ticket_types_router)
_v1.include_router(service_catalog_router)
_v1.include_router(dashboard_router)
_v1.include_router(ip_allowlist_router)
_v1.include_router(faq_router)
_v1.include_router(custom_fields_admin_router)
_v1.include_router(custom_fields_ticket_router)
_v1.include_router(users_router)
_v1.include_router(recurring_tickets_router)
_v1.include_router(changes_router)
_v1.include_router(push_router)
_v1.include_router(problems_router)
_v1.include_router(notification_rules_router)
_v1.include_router(ai_settings_router)

# MinIO 오브젝트 스토리지 프록시 (인증 필요)
from fastapi import Depends as _Depends
from fastapi.responses import Response as _Response
from .auth import get_current_user as _get_current_user
from . import storage as _storage_mod
from fastapi import APIRouter as _APIRouter

_storage_router = _APIRouter(prefix="/storage", tags=["storage"])

@_storage_router.get("/{bucket}/{object_name:path}")
def serve_storage_object(
    bucket: str,
    object_name: str,
    _user: dict = _Depends(_get_current_user),
):
    """MinIO에 저장된 첨부파일을 인증된 사용자에게 스트리밍."""
    data, content_type = _storage_mod.stream_object(object_name)
    if data is None:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return _Response(content=data, media_type=content_type)

_v1.include_router(_storage_router)

# /api/v1/... (버전 명시 경로)
app.include_router(_v1, prefix="/api/v1")
# /...         (레거시 경로 — 하위 호환)
app.include_router(_v1)

# I-2: Prometheus metrics
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator().instrument(app).expose(app)
    logger.info("Prometheus metrics enabled at /metrics")
except ImportError:
    logger.warning("prometheus-fastapi-instrumentator not installed, metrics disabled")

# Rate Limit 429 카운터 미들웨어
try:
    from prometheus_client import Counter as _PrometheusCounter
    from starlette.middleware.base import BaseHTTPMiddleware as _BaseHTTPMiddleware
    from starlette.requests import Request as _Request

    _rate_limited_counter = _PrometheusCounter(
        "http_rate_limited_requests_total",
        "Total number of HTTP requests rejected due to rate limiting (429)",
        ["method", "path"],
    )

    class _RateLimitMetricsMiddleware(_BaseHTTPMiddleware):
        async def dispatch(self, request: _Request, call_next):
            response = await call_next(request)
            if response.status_code == 429:
                # 라우트 템플릿("/api/tickets/{iid}")으로 정규화 — 고카디널리티(실제 iid) 방지
                route = request.scope.get("route")
                path_label = getattr(route, "path", None) or "unmatched"
                _rate_limited_counter.labels(
                    method=request.method,
                    path=path_label,
                ).inc()
            return response

    app.add_middleware(_RateLimitMetricsMiddleware)
    logger.info("Rate limit metrics middleware enabled")
except Exception as _rl_err:
    logger.warning("Rate limit metrics middleware not available: %s", _rl_err)

# 비즈니스 KPI 메트릭 — 5분 주기 DB 집계
try:
    from .business_metrics import start_background_refresh
    from .database import SessionLocal
    start_background_refresh(SessionLocal, interval=900)
except Exception as _bm_err:
    logger.warning("Business metrics init failed: %s", _bm_err)


# ── Web Vitals 수신 엔드포인트 ────────────────────────────────────────────────
try:
    from prometheus_client import Gauge as _VitalsGauge
    _web_vitals_gauge = _VitalsGauge(
        "web_vitals_value",
        "Latest Web Vitals metric value reported by frontend",
        ["metric_name", "rating"],
    )

    from fastapi import Request as _VitalsRequest
    from fastapi.responses import Response as _VitalsResponse

    # H3: 허용 metric_name / rating allowlist — cardinality 폭발 및 메트릭 오염 방지
    _VITALS_ALLOWED_NAMES = frozenset({"CLS", "FID", "FCP", "LCP", "TTFB", "INP"})
    _VITALS_ALLOWED_RATINGS = frozenset({"good", "needs-improvement", "poor"})

    # nginx: /api/vitals → itsm-api:8000/vitals (prefix stripped)
    @app.post("/vitals", include_in_schema=False)
    async def receive_web_vitals(request: _VitalsRequest) -> _VitalsResponse:
        try:
            data = await request.json()
            name = str(data.get("name", ""))
            rating = str(data.get("rating", ""))
            # allowlist 검증으로 cardinality 폭발 방지
            if name not in _VITALS_ALLOWED_NAMES or rating not in _VITALS_ALLOWED_RATINGS:
                return _VitalsResponse(status_code=204)
            value = float(data.get("value", 0))
            _web_vitals_gauge.labels(metric_name=name, rating=rating).set(value)
        except Exception:
            pass
        return _VitalsResponse(status_code=204)

    logger.info("Web Vitals endpoint enabled at POST /vitals (public: /api/vitals)")
except Exception as _wv_err:
    logger.warning("Web Vitals endpoint init failed: %s", _wv_err)


@app.get("/health", tags=["system"])
def health():
    from fastapi.responses import JSONResponse
    from .database import SessionLocal
    checks: dict = {}

    # DB
    try:
        with SessionLocal() as db:
            db.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as e:
        logger.error("Health check DB error: %s", e)
        checks["db"] = "error"

    # Redis
    try:
        from .routers.tickets import _get_redis as _get_ticket_redis
        _r = _get_ticket_redis()
        if _r is None:
            raise RuntimeError("connection failed")
        checks["redis"] = "ok"
    except Exception as e:
        logger.error("Health check Redis error: %s", e)
        checks["redis"] = "error"

    # GitLab (lightweight) — 30초 캐시로 Prometheus/nginx 헬스체크 부하 방지
    global _gitlab_health_cache
    now_mono = time.monotonic()
    if now_mono - _gitlab_health_cache[1] < _GITLAB_HEALTH_COOLDOWN:
        checks["gitlab"] = _gitlab_health_cache[0]
    else:
        try:
            import httpx as _httpx
            with _httpx.Client(timeout=3) as c:
                resp = c.get(
                    f"{settings.GITLAB_API_URL}/api/v4/version",
                    headers={"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN},
                )
                result = "ok" if resp.is_success else f"status {resp.status_code}"
        except Exception as e:
            logger.error("Health check GitLab error: %s", e)
            result = "error"
        _gitlab_health_cache = (result, now_mono)
        checks["gitlab"] = result

    # Celery broker (Redis ping)
    try:
        import redis as _redis_mod
        from .config import get_settings as _get_settings
        _br = _redis_mod.Redis.from_url(_get_settings().REDIS_URL, socket_connect_timeout=2)
        _br.ping()
        checks["celery_broker"] = "ok"
    except Exception as e:
        logger.error("Health check celery_broker error: %s", e)
        checks["celery_broker"] = "error"

    # GitLab 레이블 드리프트 감지 — 필수 레이블 누락 시 경고
    try:
        checks["label_sync"] = _check_label_drift()
    except Exception as e:
        logger.error("Health check label_sync error: %s", e)
        checks["label_sync"] = "error"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
        status_code=200 if all_ok else 503,
    )


@app.get("/ready", tags=["system"], include_in_schema=False)
def ready():
    """Readiness probe — DB와 Redis만 확인 (외부 GitLab 제외).

    배포 시 롤링 업데이트 또는 k8s readiness probe에 사용.
    /health 와 달리 GitLab 다운이 503을 유발하지 않는다.
    """
    from fastapi.responses import JSONResponse
    from .database import SessionLocal
    checks: dict = {}

    try:
        with SessionLocal() as db:
            db.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as e:
        logger.error("Readiness DB error: %s", e)
        checks["db"] = "error"

    try:
        import redis as _redis_mod
        _br = _redis_mod.Redis.from_url(get_settings().REDIS_URL, socket_connect_timeout=2)
        _br.ping()
        checks["redis"] = "ok"
    except Exception as e:
        logger.error("Readiness Redis error: %s", e)
        checks["redis"] = "error"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        content={"status": "ok" if all_ok else "not_ready", "checks": checks},
        status_code=200 if all_ok else 503,
    )


_gitlab_health_cache: tuple[str, float] = ("ok", 0.0)
_GITLAB_HEALTH_COOLDOWN = 60.0  # GitLab /version 호출 60초 캐시 (Docker healthcheck 30s보다 길게)

_label_drift_last_check: float = 0.0
_label_drift_last_result: str = "ok"
_LABEL_DRIFT_COOLDOWN = 300.0  # 5분 쿨다운 (30초마다 GitLab API 호출 방지)


def _check_label_drift() -> str:
    """GitLab 레이블 드리프트 감지.

    5분 쿨다운을 적용해 Prometheus scrape(30초 주기)마다 GitLab API를 호출하지 않는다.
    """
    global _label_drift_last_check, _label_drift_last_result
    now = time.monotonic()
    if now - _label_drift_last_check < _LABEL_DRIFT_COOLDOWN:
        return _label_drift_last_result  # 캐시된 결과 반환

    _label_drift_last_check = now
    from . import gitlab_client as _gc
    try:
        required = {name for name, _ in _gc.REQUIRED_LABELS}
        existing = _gc._fetch_existing_labels()
        missing = required - existing
        if not missing:
            _label_drift_last_result = "ok"
            return "ok"
        logger.warning("Label drift detected — missing: %s. Attempting recovery.", missing)
        _gc.ensure_labels()
        logger.info("Label drift recovered: %s", missing)
        _label_drift_last_result = "ok"
        return "ok"
    except Exception as e:
        logger.warning("Label drift check error: %s", e)
        _label_drift_last_result = "check_failed"
        return _label_drift_last_result


# ── WebSocket: 티켓 실시간 협업 ───────────────────────────────────────────────
from fastapi import WebSocket, WebSocketDisconnect, Query as _WSQuery
from .ws_manager import manager as _ws_manager


@app.websocket("/ws/tickets/{ticket_iid}")
async def ticket_ws(
    websocket: WebSocket,
    ticket_iid: str,
    token: str = _WSQuery(default="", description="JWT access token (deprecated, use cookie)"),
):
    """티켓 실시간 협업 WebSocket.

    인증: httponly 쿠키(itsm_token) 우선, 쿼리 파라미터 폴백(하위호환).
    접속자 목록(viewers)과 타이핑 인디케이터(typing)를 브로드캐스트한다.
    """
    import jwt as _jose_jwt
    _JoseJWTError = _jose_jwt.exceptions.InvalidTokenError
    from .config import get_settings as _ws_get_settings
    from .auth import ALGORITHM as _JWT_ALGORITHM

    _ws_settings = _ws_get_settings()

    # 쿠키 우선, 쿼리 파라미터 폴백 (URL에 토큰 노출 방지)
    ws_token = websocket.cookies.get("itsm_token") or token
    if not ws_token:
        await websocket.close(code=1008)
        return

    # JWT 검증
    try:
        payload = _jose_jwt.decode(ws_token, _ws_settings.SECRET_KEY, algorithms=[_JWT_ALGORITHM])
    except _JoseJWTError:
        await websocket.close(code=1008)
        return

    user_id_raw = payload.get("sub", "")
    username: str = payload.get("name") or payload.get("username") or user_id_raw
    try:
        user_id = int(user_id_raw)
    except (ValueError, TypeError):
        await websocket.close(code=1008)
        return

    await _ws_manager.connect(websocket, ticket_iid, user_id, username)
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception:
                break

            msg_type = data.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "typing":
                is_typing: bool = bool(data.get("is_typing", False))
                await _ws_manager.broadcast_to_room(
                    ticket_iid,
                    {"type": "typing", "user": username, "is_typing": is_typing},
                    exclude_ws=websocket,
                )

    except WebSocketDisconnect:
        pass
    finally:
        await _ws_manager.disconnect(websocket, ticket_iid)
