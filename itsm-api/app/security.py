"""보안 유틸리티 모음.

SSRF 방지, URL 검증 등 횡단 관심사(cross-cutting security concern)를 담당한다.
"""
import ipaddress
import logging
import socket
import urllib.parse
from typing import Optional

logger = logging.getLogger(__name__)

# 내부망 CIDR 목록 — SSRF 차단 대상
_BLOCKED_PREFIXES = (
    "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.",
    "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.",
    "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
    "192.168.", "127.", "169.254.", "0.",
)
_ALLOWED_SCHEMES = {"http", "https"}


def is_safe_external_url(url: str, *, allow_internal: bool = False) -> tuple[bool, str]:
    """URL이 외부 공개망을 가리키는지 검증한다.

    Returns:
        (True, "") — 안전
        (False, reason) — 차단 이유 포함

    Args:
        url: 검증할 URL
        allow_internal: True면 내부 IP도 허용 (개발 환경용)
    """
    if allow_internal:
        return True, ""

    try:
        parsed = urllib.parse.urlparse(url)
    except Exception as e:
        return False, f"URL 파싱 실패: {e}"

    # 스킴 검증
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        return False, f"허용되지 않는 스킴: {parsed.scheme}"

    host = parsed.hostname
    if not host:
        return False, "호스트명 없음"

    # IP 주소 직접 입력 차단 (내부 IP)
    try:
        addr = ipaddress.ip_address(host)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False, f"내부 IP 주소 차단: {addr}"
        return True, ""
    except ValueError:
        pass  # 호스트명 → DNS 해석 필요

    # DNS 해석 후 IP 검증
    try:
        resolved_ip = socket.gethostbyname(host)
    except socket.gaierror as e:
        return False, f"DNS 해석 실패: {e}"

    if any(resolved_ip.startswith(prefix) for prefix in _BLOCKED_PREFIXES):
        return False, f"내부망 IP로 해석됨: {resolved_ip} ({host})"

    try:
        addr = ipaddress.ip_address(resolved_ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False, f"내부망 IP 차단: {resolved_ip}"
    except ValueError:
        pass

    return True, ""


def check_ip_whitelist(request_ip: str, allowed_cidrs: str) -> bool:
    """요청 IP가 허용된 CIDR 범위에 속하는지 확인한다.

    allowed_cidrs가 빈 문자열이면 항상 True(제한 없음).
    """
    if not allowed_cidrs.strip():
        return True
    try:
        import ipaddress
        ip = ipaddress.ip_address(request_ip.split(",")[0].strip())
        for cidr in allowed_cidrs.split(","):
            cidr = cidr.strip()
            if cidr and ip in ipaddress.ip_network(cidr, strict=False):
                return True
    except Exception:
        pass
    return False


def validate_external_url(url: str, field_name: str = "URL") -> None:
    """SSRF 위험 URL이면 HTTPException을 raise한다.

    FastAPI 엔드포인트에서 직접 사용하는 헬퍼.
    """
    from fastapi import HTTPException
    from .config import get_settings

    allow_internal = getattr(get_settings(), "ENVIRONMENT", "production") == "development"
    ok, reason = is_safe_external_url(url, allow_internal=allow_internal)
    if not ok:
        logger.warning("SSRF attempt blocked: %s=%r reason=%s", field_name, url, reason)
        raise HTTPException(status_code=400, detail=f"{field_name}: {reason}")
