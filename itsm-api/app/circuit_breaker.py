"""재사용 가능한 Circuit Breaker.

외부 의존성(GitLab/ClamAV/SMTP 등)의 연속 실패를 감지해 일정 시간 fail-fast하여
스레드 고갈/요청 블로킹을 방지한다.

gitlab_client.py의 기존 CB 로직을 일반화. 각 호출부에서 공유 인스턴스를 가져와 사용.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

try:
    from prometheus_client import Gauge as _Gauge, Counter as _Counter

    _cb_open_gauge = _Gauge(
        "circuit_breaker_open",
        "외부 의존성 CB 상태 (1=open, 0=closed)",
        ["name"],
    )
    _cb_failures_gauge = _Gauge(
        "circuit_breaker_consecutive_failures",
        "연속 실패 수",
        ["name"],
    )
    _cb_transitions = _Counter(
        "circuit_breaker_transitions_total",
        "CB 상태 전이",
        ["name", "to"],
    )
except Exception:
    class _Dummy:
        def set(self, *_a: Any, **_k: Any) -> None: pass
        def inc(self, *_a: Any, **_k: Any) -> None: pass
        def labels(self, *_a: Any, **_k: Any) -> "_Dummy": return self

    _cb_open_gauge = _Dummy()      # type: ignore[assignment]
    _cb_failures_gauge = _Dummy()  # type: ignore[assignment]
    _cb_transitions = _Dummy()     # type: ignore[assignment]


class CircuitOpenError(RuntimeError):
    """CB가 열려 있어 호출이 거부되었음을 나타낸다."""


class CircuitBreaker:
    """스레드 안전한 Circuit Breaker.

    - 연속 ``threshold``회 실패 시 ``timeout``초 동안 open (fail-fast).
    - timeout 경과 후 다음 호출은 half-open — 성공하면 close, 실패하면 다시 open.
    """

    def __init__(self, name: str, threshold: int = 5, timeout: float = 30.0):
        self.name = name
        self.threshold = threshold
        self.timeout = timeout
        self._failures = 0
        self._opened_at = 0.0
        self._lock = threading.Lock()

    def check(self) -> None:
        """CB가 open이면 ``CircuitOpenError`` 발생."""
        with self._lock:
            if self._failures >= self.threshold:
                elapsed = time.monotonic() - self._opened_at
                if elapsed < self.timeout:
                    raise CircuitOpenError(
                        f"{self.name} CB open — retry after {self.timeout - elapsed:.0f}s"
                    )

    def record_success(self) -> None:
        with self._lock:
            was_open = self._failures >= self.threshold
            self._failures = 0
            _cb_failures_gauge.labels(name=self.name).set(0)
            if was_open:
                _cb_open_gauge.labels(name=self.name).set(0)
                _cb_transitions.labels(name=self.name, to="closed").inc()
                logger.info("%s circuit breaker CLOSED (recovery)", self.name)

    def record_failure(self) -> None:
        with self._lock:
            was_open = self._failures >= self.threshold
            self._failures += 1
            _cb_failures_gauge.labels(name=self.name).set(self._failures)
            # 새로 열리거나(threshold 도달), 이미 열린 상태에서 half-open probe가 실패했을 때
            # _opened_at을 갱신해 타이머를 다시 시작해야 한다. 이전에는 엄격 등호(==)였다.
            if self._failures >= self.threshold:
                self._opened_at = time.monotonic()
                if not was_open:
                    _cb_open_gauge.labels(name=self.name).set(1)
                    _cb_transitions.labels(name=self.name, to="open").inc()
                    logger.error(
                        "%s circuit breaker OPENED after %d failures",
                        self.name, self.threshold,
                    )
                else:
                    logger.warning(
                        "%s circuit breaker RE-OPENED after half-open probe failed",
                        self.name,
                    )

    @property
    def is_open(self) -> bool:
        with self._lock:
            if self._failures < self.threshold:
                return False
            return (time.monotonic() - self._opened_at) < self.timeout


# 공유 인스턴스 — 호출부에서 직접 import해서 사용.
clamav_cb = CircuitBreaker("clamav", threshold=5, timeout=60.0)
smtp_cb = CircuitBreaker("smtp", threshold=5, timeout=120.0)
