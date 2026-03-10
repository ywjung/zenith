import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

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
from . import gitlab_client
from . import sla as sla_module
from .routers.reports import take_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

_sla_thread_stop = threading.Event()
_snapshot_thread_stop = threading.Event()
_email_ingest_stop = threading.Event()
_user_sync_stop = threading.Event()

# 첫 접속 시 스냅샷 생성용 — 오늘 날짜와 비교해 하루 1회만 트리거
_last_snapshot_check: date | None = None
_snapshot_check_lock = threading.Lock()


def _sla_checker_loop():
    """Background thread: check SLA breaches and warnings every 5 minutes."""
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
    """다음 자정까지 남은 초를 반환."""
    now = datetime.now()
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
    """등록된 모든 프로젝트에 대해 스냅샷을 생성."""
    settings = get_settings()
    try:
        all_projects = gitlab_client.get_user_projects("0") or []
        project_ids = [str(p["id"]) for p in all_projects] if all_projects else []
    except Exception:
        project_ids = []

    if not project_ids:
        project_ids = [str(settings.GITLAB_PROJECT_ID)]

    for pid in project_ids:
        try:
            with SessionLocal() as db:
                result = take_snapshot(pid, db)
                logger.info("Daily snapshot [%s] project=%s → %s", reason, pid, result["message"])
        except Exception as e:
            logger.error("Daily snapshot failed for project %s: %s", pid, e)


def _user_sync_loop():
    """Background thread: 매 시간 GitLab 그룹 멤버와 ITSM 사용자 역할 동기화.

    퇴사/그룹 제거된 사용자를 is_active=False로 비활성화한다.
    """
    settings = get_settings()
    interval = getattr(settings, "USER_SYNC_INTERVAL", 3600)  # 기본 1시간
    while not _user_sync_stop.is_set():
        try:
            _run_user_sync()
        except Exception as e:
            logger.error("User sync error: %s", e)
        _user_sync_stop.wait(timeout=interval)


def _run_user_sync():
    """GitLab 그룹/프로젝트 멤버 목록과 user_roles 테이블을 비교해 비활성 처리.

    그룹 멤버 OR ITSM 프로젝트 멤버 중 하나라도 해당하면 활성으로 유지한다.
    둘 다 아닌 경우에만 is_active=False 처리한다.
    """
    from .models import UserRole
    from datetime import datetime, timezone

    settings = get_settings()

    active_ids: set[int] = set()

    # 1. 그룹 멤버 수집 (설정된 경우)
    if settings.GITLAB_GROUP_ID:
        try:
            group_members = gitlab_client.get_group_members(settings.GITLAB_GROUP_ID)
            group_ids = {int(m["id"]) for m in group_members}
            active_ids.update(group_ids)
            logger.info("User sync: GitLab group has %d members", len(group_ids))
        except Exception as e:
            logger.warning("User sync: failed to fetch GitLab group members: %s", e)

    # 2. ITSM 메인 프로젝트 멤버 수집 (그룹 멤버가 아닌 프로젝트 직접 멤버 포함)
    try:
        project_members = gitlab_client.get_project_members(str(settings.GITLAB_PROJECT_ID))
        proj_ids = {int(m["id"]) for m in project_members}
        active_ids.update(proj_ids)
        logger.info("User sync: ITSM project has %d members", len(proj_ids))
    except Exception as e:
        logger.warning("User sync: failed to fetch project members: %s", e)

    if not active_ids:
        logger.warning("User sync: no active members found — skipping to avoid mass deactivation")
        return

    logger.info("User sync: total %d active GitLab members (group + project)", len(active_ids))

    with SessionLocal() as db:
        all_users = db.query(UserRole).all()
        changed = 0
        for user in all_users:
            was_active = user.is_active
            should_be_active = user.gitlab_user_id in active_ids
            if was_active != should_be_active:
                user.is_active = should_be_active
                changed += 1
                action = "activated" if should_be_active else "deactivated"
                logger.info("User sync: %s user %s (id=%d)", action, user.username, user.gitlab_user_id)
        if changed:
            db.commit()
            logger.info("User sync: updated %d user(s)", changed)
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

    # Start email ingest if enabled
    email_thread = None
    if settings.IMAP_ENABLED:
        email_thread = threading.Thread(target=_email_ingest_loop, daemon=True, name="email-ingest")
        email_thread.start()
        logger.info("Email ingest thread started (poll interval=%ds)", settings.IMAP_POLL_INTERVAL)

    yield

    _sla_thread_stop.set()
    _snapshot_thread_stop.set()
    _email_ingest_stop.set()
    _user_sync_stop.set()
    logger.info("Shutting down — waiting for background threads")
    sla_thread.join(timeout=10)
    snap_thread.join(timeout=10)
    user_sync_thread.join(timeout=10)
    if email_thread:
        email_thread.join(timeout=10)
    logger.info("Background threads stopped")


_is_production = get_settings().ENVIRONMENT == "production"

app = FastAPI(
    title="ITSM Portal API",
    version="2.0.0",
    description="GitLab CE 기반 ITSM 포털 API",
    lifespan=lifespan,
    # H-1: production 환경에서 API 문서 비공개
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)

settings = get_settings()

# Rate limiting
try:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from .rate_limit import limiter as _limiter

    if _limiter is not None:
        # Re-create with Redis backend now that settings are available
        from slowapi import Limiter
        from slowapi.util import get_remote_address
        _limiter = Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL)
        # Patch the shared module so routers see the same instance
        import app.rate_limit as _rl_mod
        _rl_mod.limiter = _limiter

        app.state.limiter = _limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        logger.info("Rate limiting enabled with Redis backend (%s)", settings.REDIS_URL)
except Exception as e:
    logger.warning("Rate limiting not available: %s", e)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)


@app.middleware("http")
async def ensure_daily_snapshot_on_access(request: Request, call_next):
    """자정에 서버가 꺼져 스냅샷이 누락됐을 때 첫 API 요청 시 백그라운드로 생성."""
    global _last_snapshot_check
    today = date.today()
    with _snapshot_check_lock:
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
    response: Response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    request_id = response.headers.get("X-Request-ID", "-")
    logger.info(
        "%s %s %d %.1fms req=%s",
        request.method, request.url.path, response.status_code, elapsed, request_id,
    )
    return response


# Core routers
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(ratings.router)
app.include_router(projects.router)

# Enterprise routers
app.include_router(admin.router)
app.include_router(webhooks.router)
app.include_router(kb.router)
app.include_router(reports.router)
app.include_router(notifications_router)
app.include_router(templates_router)
app.include_router(link_router)
app.include_router(time_router)
app.include_router(forwards_router)
app.include_router(forwards_admin_router)
app.include_router(filters_router)
app.include_router(portal_router)
app.include_router(quick_replies_router)
app.include_router(watchers_router)
app.include_router(watchers_my_router)

# I-2: Prometheus metrics
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator().instrument(app).expose(app)
    logger.info("Prometheus metrics enabled at /metrics")
except ImportError:
    logger.warning("prometheus-fastapi-instrumentator not installed, metrics disabled")

# 비즈니스 KPI 메트릭 — 5분 주기 DB 집계
try:
    from .business_metrics import start_background_refresh
    from .database import SessionLocal
    start_background_refresh(SessionLocal, interval=300)
except Exception as _bm_err:
    logger.warning("Business metrics init failed: %s", _bm_err)


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
        checks["db"] = f"error: {e}"

    # Redis
    try:
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    # GitLab (lightweight)
    try:
        import httpx as _httpx
        with _httpx.Client(timeout=3) as c:
            resp = c.get(
                f"{settings.GITLAB_API_URL}/api/v4/version",
                headers={"PRIVATE-TOKEN": settings.GITLAB_PROJECT_TOKEN},
            )
            checks["gitlab"] = "ok" if resp.is_success else f"status {resp.status_code}"
    except Exception as e:
        checks["gitlab"] = f"error: {e}"

    # GitLab 레이블 드리프트 감지 — 필수 레이블 누락 시 경고
    try:
        checks["label_sync"] = _check_label_drift()
    except Exception as e:
        checks["label_sync"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        content={"status": "ok" if all_ok else "degraded", "checks": checks},
        status_code=200 if all_ok else 503,
    )


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
        _label_drift_last_result = f"check_failed:{e}"
        return _label_drift_last_result
