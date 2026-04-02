"""Admin Celery 모니터링 엔드포인트 — Flower API 프록시."""
import logging
import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ...rbac import require_admin

logger = logging.getLogger(__name__)

celery_monitor_router = APIRouter()

FLOWER_URL = os.environ.get("FLOWER_URL", "http://itsm-flower-1:5555/flower")
FLOWER_USER = os.environ.get("FLOWER_USER", "")
FLOWER_PASSWORD = os.environ.get("FLOWER_PASSWORD", "")

# Flower 장애 시 반환할 캐시 (최대 60초 유효)
_flower_cache: dict[str, tuple[float, Any]] = {}
_FLOWER_CACHE_TTL = 60


def _get_flower(path: str, *, use_cache: bool = True) -> dict | list:
    """Flower REST API를 호출하고 JSON을 반환한다.
    Flower 장애 시 캐시된 값을 반환 (graceful degradation).
    캐시도 없으면 503.
    """
    url = FLOWER_URL.rstrip("/") + "/" + path.lstrip("/")
    cache_key = path
    auth = (FLOWER_USER, FLOWER_PASSWORD) if FLOWER_USER and FLOWER_PASSWORD else None

    try:
        with httpx.Client(timeout=5, auth=auth) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
            # 성공 시 캐시 갱신
            if use_cache:
                _flower_cache[cache_key] = (time.monotonic(), data)
            return data
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError, Exception) as exc:
        logger.warning("Flower API 호출 실패 (%s): %s", path, exc)
        # 캐시 확인
        if use_cache and cache_key in _flower_cache:
            ts, cached = _flower_cache[cache_key]
            if time.monotonic() - ts < _FLOWER_CACHE_TTL:
                logger.info("Flower 캐시 반환 (age=%.0fs): %s", time.monotonic() - ts, path)
                return cached
        # 캐시도 만료/없음 — 503
        if isinstance(exc, httpx.ConnectError):
            raise HTTPException(status_code=503, detail="Flower 서비스에 연결할 수 없습니다.")
        if isinstance(exc, httpx.TimeoutException):
            raise HTTPException(status_code=503, detail="Flower 응답 시간 초과.")
        raise HTTPException(status_code=503, detail=f"Flower 오류: {exc}")


# ---------------------------------------------------------------------------
# GET /admin/celery/flower/stats
# ---------------------------------------------------------------------------

@celery_monitor_router.get("/celery/flower/stats")
def get_flower_stats(_user: dict = Depends(require_admin)) -> dict:
    """Flower API에서 워커·큐·태스크 요약 통계를 반환한다."""
    workers_raw = _get_flower("/api/workers")

    workers = []
    total_active = 0
    total_processed = 0
    total_failed = 0

    if isinstance(workers_raw, dict):
        for name, info in workers_raw.items():
            active_tasks = info.get("active", [])
            active_count = len(active_tasks) if isinstance(active_tasks, list) else 0
            stats = info.get("stats", {}) or {}
            total_tasks = stats.get("total", {}) or {}
            processed = sum(total_tasks.values()) if isinstance(total_tasks, dict) else 0
            # worker 상태
            status = info.get("status", False)
            workers.append({
                "name": name,
                "status": "online" if status else "offline",
                "active_tasks": active_count,
                "processed": processed,
            })
            if status:
                total_active += active_count
                total_processed += processed

    # 큐 정보 — Flower /api/queues/length
    queues: dict[str, int] = {}
    try:
        queues_raw = _get_flower("/api/queues/length")
        if isinstance(queues_raw, dict):
            active_queues = queues_raw.get("active_queues", []) or []
            for q in active_queues:
                queues[q.get("name", "unknown")] = q.get("messages", 0)
    except HTTPException:
        pass

    # 오늘 기준 태스크 통계 — Flower /api/tasks/succeeded, failed 개수는
    # workerstats에서 추출
    try:
        failed_raw = _get_flower("/api/tasks?state=FAILURE&limit=10")
        if isinstance(failed_raw, dict):
            total_failed = len(failed_raw)
        elif isinstance(failed_raw, list):
            total_failed = len(failed_raw)
    except HTTPException:
        pass

    return {
        "workers": workers,
        "queues": queues,
        "total_active": total_active,
        "total_processed": total_processed,
        "total_failed_recent": total_failed,
    }


# ---------------------------------------------------------------------------
# GET /admin/celery/flower/workers
# ---------------------------------------------------------------------------

@celery_monitor_router.get("/celery/flower/workers")
def get_flower_workers(_user: dict = Depends(require_admin)) -> list:
    """Flower API에서 워커별 상세 정보를 반환한다."""
    workers_raw = _get_flower("/api/workers")
    result = []

    if not isinstance(workers_raw, dict):
        return result

    for name, info in workers_raw.items():
        active_tasks = info.get("active", []) or []
        active_count = len(active_tasks) if isinstance(active_tasks, list) else 0
        reserved_tasks = info.get("reserved", []) or []
        reserved_count = len(reserved_tasks) if isinstance(reserved_tasks, list) else 0

        stats = info.get("stats", {}) or {}
        total_tasks = stats.get("total", {}) or {}
        processed = sum(total_tasks.values()) if isinstance(total_tasks, dict) else 0

        pool_info = stats.get("pool", {}) or {}

        result.append({
            "name": name,
            "status": "online" if info.get("status", False) else "offline",
            "active_tasks": active_count,
            "reserved_tasks": reserved_count,
            "processed": processed,
            "concurrency": pool_info.get("max-concurrency", 0),
            "prefetch_count": info.get("prefetch_count", 0),
            "heartbeat_expires": info.get("heartbeat_expires", 0),
        })

    return result


# ---------------------------------------------------------------------------
# GET /admin/celery/flower/tasks
# ---------------------------------------------------------------------------

@celery_monitor_router.get("/celery/flower/tasks")
def get_flower_tasks(
    state: str = "ALL",
    limit: int = 20,
    _user: dict = Depends(require_admin),
) -> list:
    """Flower API에서 최근 태스크 목록을 반환한다.

    state: ALL | SUCCESS | FAILURE | STARTED | PENDING | RETRY
    """
    allowed_states = {"ALL", "SUCCESS", "FAILURE", "STARTED", "PENDING", "RETRY"}
    if state not in allowed_states:
        raise HTTPException(status_code=400, detail=f"state는 {allowed_states} 중 하나여야 합니다.")

    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit은 1~100 사이여야 합니다.")

    path = f"/api/tasks?limit={limit}"
    if state != "ALL":
        path += f"&state={state}"

    tasks_raw = _get_flower(path)

    result = []
    if isinstance(tasks_raw, dict):
        for task_id, info in tasks_raw.items():
            result.append({
                "uuid": task_id,
                "name": info.get("name", ""),
                "state": info.get("state", ""),
                "received": info.get("received"),
                "started": info.get("started"),
                "succeeded": info.get("succeeded"),
                "failed": info.get("failed"),
                "retried": info.get("retried"),
                "runtime": info.get("runtime"),
                "worker": info.get("worker", ""),
                "exception": info.get("exception", ""),
                "traceback": info.get("traceback", ""),
                "args": str(info.get("args", ""))[:200],
                "kwargs": str(info.get("kwargs", ""))[:200],
            })

    # 최신순 정렬
    result.sort(key=lambda t: t.get("received") or 0, reverse=True)
    return result[:limit]
