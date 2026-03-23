"""ClamAV 바이러스 스캔 모듈.

clamd 패키지를 사용해 ClamAV TCP 소켓으로 파일 내용을 메모리에서 직접 스캔한다.
ClamAV 연결 불가 시에도 업로드를 차단하지 않는다 (fail-open).
"""
import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prometheus 메트릭 — 모듈 임포트 시 한 번만 등록
# ---------------------------------------------------------------------------
try:
    from prometheus_client import Counter as _PrometheusCounter

    clamav_scans_total = _PrometheusCounter(
        "clamav_scans_total",
        "ClamAV 스캔 결과 카운터",
        ["result"],
    )
    clamav_infected_files_total = _PrometheusCounter(
        "clamav_infected_files_total",
        "ClamAV 악성코드 탐지 파일 카운터",
        ["file_type"],
    )
except Exception:
    # 프로메테우스 미설치 환경에서도 동작하도록 더미 제공
    class _DummyCounter:
        def labels(self, **_kwargs):
            return self

        def inc(self, _amount=1):
            pass

    clamav_scans_total = _DummyCounter()          # type: ignore[assignment]
    clamav_infected_files_total = _DummyCounter()  # type: ignore[assignment]


def scan_bytes(content: bytes, filename: str) -> tuple[bool, str]:
    """파일 내용을 ClamAV로 스캔한다.

    Args:
        content: 스캔할 파일의 바이트 내용.
        filename: 로깅용 파일명.

    Returns:
        (is_safe, detail) 튜플.
        - (True, "clean"): 위협 없음.
        - (False, "<virus_name>"): 악성코드 탐지.
        - (True, "unavailable"): ClamAV 연결 실패 — fail-open으로 업로드 허용.
    """
    try:
        from .config import get_settings as _get_settings
        _s = _get_settings()
        host = getattr(_s, "CLAMAV_HOST", "itsm-clamav-1")
        port = int(getattr(_s, "CLAMAV_PORT", 3310))
    except Exception:
        host = os.environ.get("CLAMAV_HOST", "itsm-clamav-1")
        port = int(os.environ.get("CLAMAV_PORT", "3310"))

    try:
        import clamd as _clamd

        cd = _clamd.ClamdNetworkSocket(host=host, port=port)
        import io
        result = cd.instream(io.BytesIO(content))
        # result 형식: {'stream': ('OK', None)} 또는 {'stream': ('FOUND', 'Eicar-Test-Signature')}
        status, virus_name = result.get("stream", ("OK", None))
        if status == "OK":
            clamav_scans_total.labels(result="clean").inc()
            logger.debug("ClamAV scan clean: %s", filename)
            return True, "clean"
        else:
            vname = virus_name or "UNKNOWN"
            clamav_scans_total.labels(result="infected").inc()
            # 파일 확장자 추출 (Prometheus label)
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "unknown"
            clamav_infected_files_total.labels(file_type=ext).inc()
            logger.error("ClamAV INFECTED: file=%s virus=%s", filename, vname)
            return False, vname
    except ImportError:
        logger.warning(
            "clamd 패키지가 설치되지 않았습니다. ClamAV 스캔을 건너뜁니다: %s", filename
        )
        clamav_scans_total.labels(result="unavailable").inc()
        return True, "unavailable"
    except Exception as exc:
        logger.warning(
            "ClamAV 연결 실패 (fail-open) — 스캔 건너뜀: file=%s host=%s:%d error=%s",
            filename, host, port, exc,
        )
        clamav_scans_total.labels(result="unavailable").inc()
        return True, "unavailable"
