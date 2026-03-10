"""비밀 스캐닝 (Secret Detection).

티켓·댓글·KB 본문에 API 키, 비밀번호 등 민감 정보가 포함됐을 때 경고한다.
탐지 시 즉시 차단하지 않고 경고 + 감사 로그 기록 방식으로 동작한다 (fail-soft).
탐지된 내용을 마스킹하여 저장하는 옵션도 지원한다.
"""
import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# (패턴, 레이블, 심각도)
_SECRET_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"AKIA[0-9A-Z]{16}", re.ASCII), "AWS Access Key ID", "critical"),
    (re.compile(r"(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])", re.ASCII), "AWS Secret Access Key (가능성)", "warning"),
    (re.compile(r"sk-[a-zA-Z0-9]{48}", re.ASCII), "OpenAI API Key", "critical"),
    (re.compile(r"ghp_[a-zA-Z0-9]{36}", re.ASCII), "GitHub Personal Access Token", "critical"),
    (re.compile(r"glpat-[a-zA-Z0-9\-_]{20,}", re.ASCII), "GitLab Personal Access Token", "critical"),
    (re.compile(r"xoxb-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{24}", re.ASCII), "Slack Bot Token", "critical"),
    (re.compile(r"xoxp-[0-9]{10,12}-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{32}", re.ASCII), "Slack User Token", "critical"),
    (re.compile(r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", re.ASCII), "Private Key", "critical"),
    (re.compile(r"(?i)(?:password|passwd|pwd|secret|api[_\-]?key|access[_\-]?token)\s*[:=]\s*['\"]?\S{8,}['\"]?"), "패스워드/시크릿 (가능성)", "warning"),
    (re.compile(r"(?i)(?:db|database)[_\-]?(?:password|pass|pwd)\s*[:=]\s*['\"]?\S{6,}"), "DB 비밀번호 (가능성)", "warning"),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"), "이메일 주소", "info"),
]

# 마스킹 치환 패턴 — 일부만 보이고 나머지 마스킹
_MASK_CHAR = "●"


@dataclass
class SecretMatch:
    label: str
    matched: str
    severity: str  # critical | warning | info
    start: int
    end: int


def scan_text(text: str) -> list[SecretMatch]:
    """텍스트에서 비밀 패턴을 찾아 SecretMatch 목록을 반환한다."""
    if not text:
        return []
    matches: list[SecretMatch] = []
    for pattern, label, severity in _SECRET_PATTERNS:
        for m in pattern.finditer(text):
            matches.append(SecretMatch(
                label=label,
                matched=m.group(),
                severity=severity,
                start=m.start(),
                end=m.end(),
            ))
    # 중복·포함 관계 제거 (겹치는 범위는 첫 번째 우선)
    matches.sort(key=lambda x: (x.start, -(x.end - x.start)))
    deduped: list[SecretMatch] = []
    last_end = -1
    for m in matches:
        if m.start >= last_end:
            deduped.append(m)
            last_end = m.end
    return deduped


def mask_text(text: str, matches: list[SecretMatch]) -> str:
    """탐지된 범위를 마스킹한 텍스트를 반환한다.

    앞 3자·뒤 3자는 남기고 중간을 ●●● 으로 치환한다.
    """
    if not matches:
        return text
    result = []
    prev = 0
    for m in sorted(matches, key=lambda x: x.start):
        result.append(text[prev:m.start])
        raw = m.matched
        if len(raw) <= 6:
            result.append(_MASK_CHAR * len(raw))
        else:
            result.append(raw[:3] + _MASK_CHAR * (len(raw) - 6) + raw[-3:])
        prev = m.end
    result.append(text[prev:])
    return "".join(result)


def check_and_warn(text: str, context: str, actor: str = "unknown") -> list[SecretMatch]:
    """스캔 후 경고 로그를 기록하고 matches를 반환한다.

    critical 탐지: ERROR 로그
    warning 탐지: WARNING 로그
    info 탐지: DEBUG 로그 (이메일 등)
    """
    matches = scan_text(text)
    for m in matches:
        msg = "Secret detected: label=%r severity=%s context=%s actor=%s value_prefix=%r"
        args = (m.label, m.severity, context, actor, m.matched[:6] + "...")
        if m.severity == "critical":
            logger.error(msg, *args)
        elif m.severity == "warning":
            logger.warning(msg, *args)
        else:
            logger.debug(msg, *args)
    return matches
