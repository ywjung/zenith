"""보안 유틸리티 단위 테스트."""
import pytest


# ── is_safe_external_url ───────────────────────────────────────────────────

def test_safe_url_passes():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("https://example.com/hook")
    assert ok is True
    assert reason == ""


def test_http_scheme_passes():
    from app.security import is_safe_external_url
    ok, _ = is_safe_external_url("http://example.com/hook")
    assert ok is True


def test_ftp_scheme_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("ftp://example.com/file")
    assert ok is False
    assert "스킴" in reason


def test_file_scheme_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("file:///etc/passwd")
    assert ok is False


def test_localhost_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://localhost/admin")
    assert ok is False


def test_loopback_ip_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://127.0.0.1/admin")
    assert ok is False
    assert "IP" in reason or "내부" in reason


def test_private_ip_10_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://10.0.0.1/hook")
    assert ok is False


def test_private_ip_192_168_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://192.168.1.100/hook")
    assert ok is False


def test_private_ip_172_16_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://172.16.0.1/hook")
    assert ok is False


def test_allow_internal_bypasses_check():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://192.168.1.100/hook", allow_internal=True)
    assert ok is True


def test_empty_url_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("")
    assert ok is False


def test_no_host_blocked():
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("https:///path")
    assert ok is False


# ── check_ip_whitelist ────────────────────────────────────────────────────

def test_empty_allowlist_permits_all():
    from app.security import check_ip_whitelist
    assert check_ip_whitelist("1.2.3.4", "") is True
    assert check_ip_whitelist("192.168.1.1", "") is True


def test_ip_in_cidr_permitted():
    from app.security import check_ip_whitelist
    assert check_ip_whitelist("10.0.0.5", "10.0.0.0/8") is True


def test_ip_outside_cidr_blocked():
    from app.security import check_ip_whitelist
    assert check_ip_whitelist("192.168.1.1", "10.0.0.0/8") is False


def test_multiple_cidrs():
    from app.security import check_ip_whitelist
    assert check_ip_whitelist("192.168.1.1", "10.0.0.0/8,192.168.1.0/24") is True


def test_exact_ip_cidr():
    from app.security import check_ip_whitelist
    assert check_ip_whitelist("1.2.3.4", "1.2.3.4/32") is True
    assert check_ip_whitelist("1.2.3.5", "1.2.3.4/32") is False


def test_invalid_ip_does_not_crash():
    from app.security import check_ip_whitelist
    # 잘못된 IP 주소는 False 반환 (예외 없이)
    result = check_ip_whitelist("not-an-ip", "10.0.0.0/8")
    assert result is False


# ── DNS resolution paths ──────────────────────────────────────────────────────

def test_hostname_dns_failure_blocked():
    from app.security import is_safe_external_url
    from unittest.mock import patch
    import socket
    with patch("socket.gethostbyname", side_effect=socket.gaierror("DNS fail")):
        ok, reason = is_safe_external_url("https://nonexistent.invalid.example/path")
    assert ok is False
    assert "DNS" in reason


def test_hostname_resolves_to_internal_blocked():
    from app.security import is_safe_external_url
    from unittest.mock import patch
    with patch("socket.gethostbyname", return_value="10.0.0.1"):
        ok, reason = is_safe_external_url("https://metadata.internal.example.com/")
    assert ok is False
    assert "내부망" in reason


def test_hostname_resolves_to_loopback_blocked():
    from app.security import is_safe_external_url
    from unittest.mock import patch
    with patch("socket.gethostbyname", return_value="127.0.0.1"):
        ok, reason = is_safe_external_url("https://sneaky.example.com/")
    assert ok is False


def test_hostname_resolves_to_public_ip_allowed():
    from app.security import is_safe_external_url
    from unittest.mock import patch
    with patch("socket.gethostbyname", return_value="93.184.216.34"):
        ok, reason = is_safe_external_url("https://example.com/webhook")
    assert ok is True


# ── validate_external_url ─────────────────────────────────────────────────────

def test_validate_external_url_raises_on_ssrf():
    from app.security import validate_external_url
    from fastapi import HTTPException
    from unittest.mock import patch
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.ENVIRONMENT = "production"
        with pytest.raises(HTTPException) as exc:
            validate_external_url("http://127.0.0.1/admin", "URL")
    assert exc.value.status_code == 400


def test_validate_external_url_passes_safe_url():
    from app.security import validate_external_url
    from unittest.mock import patch
    with (
        patch("app.config.get_settings") as mock_cfg,
        patch("socket.gethostbyname", return_value="93.184.216.34"),
    ):
        mock_cfg.return_value.ENVIRONMENT = "production"
        # Should not raise
        validate_external_url("https://example.com/hook", "URL")


def test_validate_external_url_dev_env_allows_internal():
    from app.security import validate_external_url
    from unittest.mock import patch
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.ENVIRONMENT = "development"
        # Should not raise (allow_internal=True in dev)
        validate_external_url("http://127.0.0.1/admin", "URL")


# ── additional coverage paths ─────────────────────────────────────────────────

def test_public_ip_direct_allowed():
    """Direct public IP address (not private) → returns True (line 55)."""
    from app.security import is_safe_external_url
    # 93.184.216.34 is a well-known public IP (example.com)
    ok, reason = is_safe_external_url("http://93.184.216.34/hook")
    assert ok is True
    assert reason == ""


def test_ipv6_loopback_direct_blocked():
    """IPv6 loopback address ::1 passed directly → blocked (line 54)."""
    from app.security import is_safe_external_url
    ok, reason = is_safe_external_url("http://[::1]/admin")
    assert ok is False


def test_hostname_resolves_to_ipv6_private():
    """Hostname resolving to IPv6 private (not in _BLOCKED_PREFIXES) → blocked (line 71)."""
    from app.security import is_safe_external_url
    from unittest.mock import patch
    # "::1" is loopback but NOT in _BLOCKED_PREFIXES (which only has IPv4 prefixes)
    with patch("socket.gethostbyname", return_value="::1"):
        ok, reason = is_safe_external_url("https://ipv6host.example.com/hook")
    assert ok is False


def test_hostname_resolves_to_invalid_string_passes():
    """socket.gethostbyname returns non-IP string → ValueError caught, passes (lines 72-73)."""
    from app.security import is_safe_external_url
    from unittest.mock import patch
    # "not-an-ip" is not a valid IP, not in _BLOCKED_PREFIXES → ipaddress raises ValueError
    with patch("socket.gethostbyname", return_value="not-an-ip-address"):
        ok, reason = is_safe_external_url("https://somehost.example.com/hook")
    # ValueError is caught, function returns True (safe)
    assert ok is True
