"""PII (개인식별정보) 탐지 및 마스킹 유틸리티.

탐지 대상:
  - 주민등록번호 / 외국인등록번호
  - 국내 전화번호 (유선·휴대폰)
  - 여권번호
  - 신용카드번호

fail-soft 설계: 탐지 시 경고 로그만 기록하고 처리를 막지 않는다.
mask_pii()는 텍스트에서 PII를 *** 형태로 치환해 반환한다.
"""
import logging
import re
from typing import NamedTuple

logger = logging.getLogger(__name__)


class _Pattern(NamedTuple):
    name: str
    pattern: re.Pattern
    replacement: str


# ── 탐지 패턴 ──────────────────────────────────────────────────────────────

_PATTERNS: list[_Pattern] = [
    # 주민등록번호 / 외국인등록번호: 000000-1000000 형태
    _Pattern(
        name="주민등록번호",
        pattern=re.compile(r"\b(\d{6})-([1-4]\d{6})\b"),
        replacement=r"\1-*******",
    ),
    # 국내 휴대폰: 010-XXXX-XXXX, 011-XXX-XXXX 등
    _Pattern(
        name="휴대폰번호",
        pattern=re.compile(r"\b(01[016789])[- .](\d{3,4})[- .](\d{4})\b"),
        replacement=r"\1-****-\3",
    ),
    # 국내 유선전화: 02-XXXX-XXXX, 031-XXX-XXXX 등
    _Pattern(
        name="유선전화번호",
        pattern=re.compile(r"\b(0(?:2|[3-9]\d))[- .](\d{3,4})[- .](\d{4})\b"),
        replacement=r"\1-****-\3",
    ),
    # 국제전화 형식: +82-10-XXXX-XXXX
    _Pattern(
        name="국제전화번호",
        pattern=re.compile(r"\+82[- .](\d{1,2})[- .](\d{3,4})[- .](\d{4})\b"),
        replacement=r"+82-\1-****-\3",
    ),
    # 여권번호: M12345678 (알파벳 1자 + 숫자 8자)
    _Pattern(
        name="여권번호",
        pattern=re.compile(r"\b([A-Z])(\d{8})\b"),
        replacement=r"\1********",
    ),
    # 신용카드번호: 4자리-4자리-4자리-4자리
    _Pattern(
        name="신용카드번호",
        pattern=re.compile(r"\b(\d{4})[- ](\d{4})[- ](\d{4})[- ](\d{4})\b"),
        replacement=r"\1-****-****-\4",
    ),
]


def contains_pii(text: str) -> bool:
    """PII 포함 여부를 반환한다. 탐지 시 WARNING 로그를 기록한다."""
    if not text:
        return False
    for p in _PATTERNS:
        if p.pattern.search(text):
            logger.warning("PII 탐지됨 [%s] — 내용 마스킹 권장", p.name)
            return True
    return False


def mask_pii(text: str) -> str:
    """텍스트에서 PII 패턴을 마스킹해 반환한다. 원본 텍스트는 변경하지 않는다."""
    if not text:
        return text
    result = text
    for p in _PATTERNS:
        result = p.pattern.sub(p.replacement, result)
    return result


def check_and_warn(text: str, context: str = "") -> None:
    """제출 시 PII 포함 여부를 검사하고 경고 로그를 남긴다 (비차단)."""
    if contains_pii(text):
        logger.warning("PII 탐지 — 제출 컨텍스트: %s", context or "unknown")
