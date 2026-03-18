import asyncio
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
from .routers.automation import router as automation_router
from .routers.approvals import router as approvals_router
from .routers.ticket_types import router as ticket_types_router
from .routers.service_catalog import router as service_catalog_router
from .routers.dashboard import router as dashboard_router
from .routers.ip_allowlist import router as ip_allowlist_router
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


def _is_production() -> bool:
    return get_settings().ENVIRONMENT.lower() == "production"


app = FastAPI(
    title="ITSM Portal API",
    version="2.0.0",
    description="GitLab CE 기반 ITSM 포털 API",
    lifespan=lifespan,
    # H-1: production 환경에서 API 문서 비공개
    docs_url=None if _is_production() else "/docs",
    redoc_url=None if _is_production() else "/redoc",
    openapi_url=None if _is_production() else "/openapi.json",
)

settings = get_settings()

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
    allow_headers=["Content-Type", "Authorization", "Cookie"],
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
_ip_cache: dict = {"nets": [], "loaded_at": 0.0}
_IP_CACHE_TTL = 5.0  # seconds
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
    X-Forwarded-For 에는 Docker 브리지 게이트웨이(Nginx 컨테이너 /24 의 .1)가
    나타나므로, request.client.host(=Nginx 컨테이너 IP) 기준으로 계산한다.
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
            from jose import jwt as _jwt, JWTError as _JWTError
            from .auth import ALGORITHM as _ALGORITHM, _is_token_blacklisted
            _settings = get_settings()
            payload = _jwt.decode(token, _settings.SECRET_KEY, algorithms=[_ALGORITHM])
            # Check Redis blacklist — treat blacklisted tokens as unauthenticated
            _jti = payload.get("jti")
            if _jti and _is_token_blacklisted(_jti):
                payload = None
        except Exception:
            payload = None

    is_admin_path = request.url.path.startswith("/admin")
    should_check = is_admin_path

    if not should_check and payload is not None:
        role = payload.get("role", "")
        if role in ("admin", "superadmin", "agent", "pl"):
            should_check = True

    if not should_check:
        return await call_next(request)

    # VULN-05: trusted proxy 환경(사설 IP)에서만 X-Forwarded-For 신뢰
    forwarded = request.headers.get("X-Forwarded-For", "")
    client_ip_str = request.client.host if request.client else "0.0.0.0"
    if forwarded and request.client:
        try:
            proxy_addr = _ipmod.ip_address(request.client.host)
            if proxy_addr.is_private:
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
app.include_router(automation_router)
app.include_router(approvals_router)
app.include_router(ticket_types_router)
app.include_router(service_catalog_router)
app.include_router(dashboard_router)
app.include_router(ip_allowlist_router)

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
    start_background_refresh(SessionLocal, interval=900)
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
