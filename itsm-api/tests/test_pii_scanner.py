"""Unit tests for PII masking and secret scanning utilities."""


# ── pii_masker ────────────────────────────────────────────────────────────────

def test_contains_pii_resident_number():
    from app.pii_masker import contains_pii
    assert contains_pii("주민번호: 900101-1234567") is True


def test_contains_pii_mobile_phone():
    from app.pii_masker import contains_pii
    assert contains_pii("연락처: 010-1234-5678") is True


def test_contains_pii_landline():
    from app.pii_masker import contains_pii
    assert contains_pii("회사 번호: 02-3456-7890") is True


def test_contains_pii_passport():
    from app.pii_masker import contains_pii
    assert contains_pii("여권번호 M12345678") is True


def test_contains_pii_credit_card():
    from app.pii_masker import contains_pii
    assert contains_pii("카드: 1234-5678-9012-3456") is True


def test_contains_pii_clean_text():
    from app.pii_masker import contains_pii
    assert contains_pii("네트워크 연결이 안됩니다.") is False


def test_contains_pii_empty_string():
    from app.pii_masker import contains_pii
    assert contains_pii("") is False


def test_mask_pii_resident_number():
    from app.pii_masker import mask_pii
    result = mask_pii("900101-1234567")
    assert "1234567" not in result
    assert "900101" in result


def test_mask_pii_mobile():
    from app.pii_masker import mask_pii
    result = mask_pii("010-1234-5678")
    assert "1234" not in result
    assert "010" in result


def test_mask_pii_empty():
    from app.pii_masker import mask_pii
    assert mask_pii("") == ""


def test_mask_pii_clean_text_unchanged():
    from app.pii_masker import mask_pii
    text = "일반 텍스트입니다."
    assert mask_pii(text) == text


def test_check_and_warn_no_exception():
    from app.pii_masker import check_and_warn
    # Should not raise, just log
    check_and_warn("900101-1234567", context="test")
    check_and_warn("일반 텍스트", context="test")


# ── secret_scanner ────────────────────────────────────────────────────────────

def test_scan_aws_key():
    from app.secret_scanner import scan_text
    text = "AKIAIOSFODNN7EXAMPLE is the access key"
    matches = scan_text(text)
    assert any(m.label == "AWS Access Key ID" for m in matches)
    assert any(m.severity == "critical" for m in matches)


def test_scan_github_token():
    from app.secret_scanner import scan_text
    text = "token: ghp_" + "a" * 36
    matches = scan_text(text)
    assert any(m.label == "GitHub Personal Access Token" for m in matches)


def test_scan_gitlab_token():
    from app.secret_scanner import scan_text
    text = "glpat-abcdefghij12345678901"
    matches = scan_text(text)
    assert any("GitLab" in m.label for m in matches)


def test_scan_private_key():
    from app.secret_scanner import scan_text
    text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."
    matches = scan_text(text)
    assert any("Private Key" in m.label for m in matches)


def test_scan_password_pattern():
    from app.secret_scanner import scan_text
    text = "password=supersecret123"
    matches = scan_text(text)
    assert len(matches) > 0


def test_scan_clean_text():
    from app.secret_scanner import scan_text
    text = "프린터가 작동하지 않습니다. 도움이 필요합니다."
    matches = scan_text(text)
    # May match email-like patterns but not critical secrets
    critical = [m for m in matches if m.severity == "critical"]
    assert len(critical) == 0


def test_scan_empty():
    from app.secret_scanner import scan_text
    assert scan_text("") == []


def test_mask_text_aws_key():
    from app.secret_scanner import scan_text, mask_text
    text = "key: AKIAIOSFODNN7EXAMPLE"
    matches = scan_text(text)
    masked = mask_text(text, matches)
    assert "AKIAIOSFODNN7EXAMPLE" not in masked


def test_mask_text_no_matches():
    from app.secret_scanner import mask_text
    text = "일반 텍스트"
    assert mask_text(text, []) == text


def test_check_and_warn_returns_matches():
    from app.secret_scanner import check_and_warn
    matches = check_and_warn("AKIAIOSFODNN7EXAMPLE", context="test.ticket", actor="user")
    assert len(matches) > 0
    assert matches[0].severity == "critical"


def test_check_and_warn_clean_returns_empty_or_info():
    from app.secret_scanner import check_and_warn
    matches = check_and_warn("일반 텍스트입니다", context="test", actor="user")
    # May have info-level email matches, but no critical
    critical = [m for m in matches if m.severity == "critical"]
    assert len(critical) == 0


def test_mask_text_short_secret():
    """Secret with len <= 6 → fully masked with * (line 79)."""
    from app.secret_scanner import mask_text, SecretMatch
    match = SecretMatch(label="test", matched="abc", severity="warning", start=0, end=3)
    result = mask_text("abc", [match])
    assert "abc" not in result
    assert len(result) == 3


def test_check_and_warn_warning_severity():
    """Password pattern has 'warning' severity → covers lines 100-101."""
    from app.secret_scanner import check_and_warn
    matches = check_and_warn("password=supersecret123", context="test", actor="user")
    warning_matches = [m for m in matches if m.severity == "warning"]
    assert len(warning_matches) >= 1


def test_check_and_warn_info_severity():
    """Email address has 'info' severity → covers lines 102-103."""
    from app.secret_scanner import check_and_warn
    matches = check_and_warn("contact: user@example.com", context="test", actor="user")
    info_matches = [m for m in matches if m.severity == "info"]
    assert len(info_matches) >= 1
