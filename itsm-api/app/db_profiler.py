"""DB 쿼리 프로파일러.

개발/스테이징 환경에서 느린 쿼리와 잠재적 N+1 패턴을 감지합니다.
SLOW_QUERY_THRESHOLD_MS 환경 변수로 임계값 조정 (기본: 200ms).
500ms 이상 쿼리는 Prometheus db_slow_queries_total 카운터도 증가시킵니다.
"""
import logging
import time
from collections import defaultdict
from contextlib import contextmanager
from threading import local

from prometheus_client import Counter as _PrometheusCounter
from sqlalchemy import event
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Prometheus: 슬로우 쿼리 카운터 (500ms 이상)
db_slow_queries_total = _PrometheusCounter(
    "db_slow_queries_total",
    "Total number of slow DB queries exceeding 500ms",
)

_PROMETHEUS_THRESHOLD_MS = 500  # Prometheus 카운터용 임계값 (로그 임계값과 별개)

_local = local()
_SLOW_THRESHOLD_MS = 200


def _get_threshold_ms() -> float:
    try:
        from .config import get_settings
        return float(getattr(get_settings(), "SLOW_QUERY_THRESHOLD_MS", _SLOW_THRESHOLD_MS))
    except Exception:
        return _SLOW_THRESHOLD_MS


@event.listens_for(Engine, "before_cursor_execute")
def _before_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault("query_start_time", []).append(time.perf_counter())


@event.listens_for(Engine, "after_cursor_execute")
def _after_execute(conn, cursor, statement, parameters, context, executemany):
    elapsed_ms = (time.perf_counter() - conn.info["query_start_time"].pop()) * 1000

    # 느린 쿼리 로그 (SLOW_QUERY_THRESHOLD_MS 기준)
    threshold = _get_threshold_ms()
    if elapsed_ms > threshold:
        snippet = statement.strip()[:120].replace("\n", " ")
        logger.warning("SLOW QUERY %.1f ms: %s", elapsed_ms, snippet)

    # Prometheus 카운터 (500ms 이상만 계산)
    if elapsed_ms > _PROMETHEUS_THRESHOLD_MS:
        try:
            db_slow_queries_total.inc()
        except Exception:
            pass

    # N+1 감지: 같은 요청 내에서 동일 테이블을 반복 쿼리
    counter = getattr(_local, "query_counter", None)
    if counter is not None:
        # 테이블 이름 추출 (단순 패턴)
        import re
        tables = re.findall(r"FROM\s+(\w+)", statement, re.IGNORECASE)
        for table in tables:
            counter[table] += 1
            if counter[table] == 10:  # 10번째에 경고
                logger.warning(
                    "POSSIBLE N+1: table '%s' queried %d times in one request",
                    table, counter[table],
                )


@contextmanager
def track_queries():
    """요청 범위 내 쿼리 횟수를 추적하는 컨텍스트 매니저."""
    _local.query_counter = defaultdict(int)
    try:
        yield _local.query_counter
    finally:
        _local.query_counter = None


def setup_db_profiler(app, enabled: bool = False) -> None:
    """FastAPI 앱에 쿼리 프로파일러 미들웨어를 등록합니다.

    Args:
        app: FastAPI 인스턴스
        enabled: True일 때만 요청별 N+1 추적 활성화 (개발 환경)
    """
    if not enabled:
        # 느린 쿼리 감지는 항상 활성화 (임계값 넘을 때만 로그)
        logger.debug("DB profiler: slow query detection active, per-request tracking disabled")
        return

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.requests import Request

    class QueryProfilerMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            with track_queries() as counter:
                response = await call_next(request)
                total = sum(counter.values())
                if total > 20:
                    logger.info(
                        "HIGH QUERY COUNT %d for %s %s — top tables: %s",
                        total,
                        request.method,
                        request.url.path,
                        sorted(counter.items(), key=lambda x: -x[1])[:5],
                    )
            return response

    app.add_middleware(QueryProfilerMiddleware)
    logger.info("DB profiler: per-request query tracking enabled")
