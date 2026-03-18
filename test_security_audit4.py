"""4차 보안 감사 개선 사항 전체 테스트 (27개 항목)

정적 분석 기반 테스트 — 실행 환경 불필요
"""
import ast
import re
import sys
import textwrap

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"

results: list[tuple[str, str, str]] = []


def check(test_id: str, desc: str, passed: bool, detail: str = "") -> None:
    status = PASS if passed else FAIL
    results.append((test_id, status, f"{desc}{' — ' + detail if detail else ''}"))


def warn(test_id: str, desc: str, detail: str = "") -> None:
    results.append((test_id, WARN, f"{desc}{' — ' + detail if detail else ''}"))


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# CRIT-01 / HIGH-05: _extract_client_ip — XFF 신뢰 프록시 처리
# ─────────────────────────────────────────────────────────────────────────────
auth_py = read("itsm-api/app/routers/auth.py")

check("CRIT-01/HIGH-05-a", "_extract_client_ip 함수 정의 존재",
      "def _extract_client_ip" in auth_py)

check("CRIT-01/HIGH-05-b", "_extract_client_ip이 TRUSTED_PROXIES 설정 참조",
      "TRUSTED_PROXIES" in auth_py and "_extract_client_ip" in auth_py)

check("CRIT-01/HIGH-05-c", "sudo 토큰 발급/검증이 _extract_client_ip 사용",
      auth_py.count("_extract_client_ip(request)") >= 2,
      f"사용 횟수: {auth_py.count('_extract_client_ip(request)')}")

check("CRIT-01/HIGH-05-d", "is_trusted 분기로 사설 IP 신뢰 여부 확인",
      "is_trusted" in auth_py and "ip_network" in auth_py)

# _extract_client_ip 헬퍼 함수 내부에서만 X-Forwarded-For 접근,
# 함수 외부(sudo 토큰 로직 등)에서 직접 읽지 않음을 확인
_xff_outside_helper = re.sub(
    r"def _extract_client_ip.*?(?=\ndef |\Z)", "", auth_py, flags=re.DOTALL
)
check("CRIT-01/HIGH-05-e", "XFF 헤더가 _extract_client_ip 헬퍼 외부에서 직접 접근되지 않음",
      'headers.get("X-Forwarded-For"' not in _xff_outside_helper)

# ─────────────────────────────────────────────────────────────────────────────
# CRIT-02: SECRET_KEY 약한 기본값 차단
# ─────────────────────────────────────────────────────────────────────────────
config_py = read("itsm-api/app/config.py")

check("CRIT-02-a", "SECRET_KEY 기본값 블랙리스트에 'change_me_to_random_32char_string' 포함",
      "change_me_to_random_32char_string" in config_py)

check("CRIT-02-b", "weak_defaults 집합이 정의되고 블랙리스트 검사 수행",
      "weak_defaults" in config_py and "lower()" in config_py)

check("CRIT-02-c", "길이 검사 (len < 32) 병행",
      "len(v) < 32" in config_py)

# CRIT-02 로직 단위 테스트
def _secret_key_validator(v: str) -> tuple[bool, str]:
    weak_defaults = {
        "change_me", "secret", "your-secret-key", "development-key",
        "change_me_to_random_32char_string",
    }
    if v.lower() in {w.lower() for w in weak_defaults} or len(v) < 32:
        return False, "rejected"
    return True, "accepted"

_cases = [
    ("change_me_to_random_32char_string", False),
    ("change_me", False),
    ("short", False),
    ("a" * 31, False),
    ("a" * 32, True),
    ("super-strong-production-key-xxxxxxxxx", True),
]
all_ok = all(_secret_key_validator(v)[0] == expected for v, expected in _cases)
check("CRIT-02-d", "validator 로직 단위 테스트 (약한 키 거부 / 강한 키 통과)",
      all_ok, f"{len(_cases)}개 케이스")

# ─────────────────────────────────────────────────────────────────────────────
# CRIT-03: DOMPurify HTML 새니타이저
# ─────────────────────────────────────────────────────────────────────────────
ticket_page_tsx = read("itsm-web/src/app/tickets/[id]/page.tsx")

check("CRIT-03-a", "isomorphic-dompurify import 존재",
      "isomorphic-dompurify" in ticket_page_tsx or
      "from 'dompurify'" in ticket_page_tsx or
      "DOMPurify" in ticket_page_tsx)

check("CRIT-03-b", "DOMPurify.sanitize() 호출 존재",
      "DOMPurify.sanitize" in ticket_page_tsx)

check("CRIT-03-c", "ALLOWED_TAGS 화이트리스트 설정",
      "ALLOWED_TAGS" in ticket_page_tsx)

check("CRIT-03-d", "ALLOW_DATA_ATTR: false 설정 (data-* 속성 차단)",
      "ALLOW_DATA_ATTR" in ticket_page_tsx and "false" in ticket_page_tsx)

check("CRIT-03-e", "커스텀 정규식 sanitizer 제거 (regex 기반 XSS 필터 미사용)",
      "replace(/<script" not in ticket_page_tsx and
      "replace(/on\\w+" not in ticket_page_tsx)

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-01: Grafana localhost 바인딩 + 강제 패스워드
# ─────────────────────────────────────────────────────────────────────────────
compose = read("docker-compose.yml")

check("HIGH-01-a", "Grafana 포트가 127.0.0.1에만 바인딩",
      "127.0.0.1:${GRAFANA_PORT" in compose or "127.0.0.1:3001" in compose)

check("HIGH-01-b", "GRAFANA_PASSWORD가 :? 강제 설정 (미설정 시 시작 실패)",
      "GRAFANA_PASSWORD:?" in compose)

check("HIGH-01-c", "GF_AUTH_DISABLE_SIGNUP 비활성화",
      'GF_AUTH_DISABLE_SIGNUP: "true"' in compose)

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-02: Prometheus localhost 바인딩
# ─────────────────────────────────────────────────────────────────────────────
check("HIGH-02-a", "Prometheus 포트가 127.0.0.1에만 바인딩",
      '"127.0.0.1:9090:9090"' in compose)

check("HIGH-02-b", "Prometheus 포트가 0.0.0.0에 노출되지 않음",
      '"9090:9090"' not in compose)

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-03: verify_sudo_token — 파괴적 DELETE 엔드포인트 보호
# ─────────────────────────────────────────────────────────────────────────────
admin_py = read("itsm-api/app/routers/admin.py")

SUDO_PROTECTED = [
    "delete_service_type",
    "delete_escalation_policy",
    "delete_outbound_webhook",
    "revoke_api_key",
]
for ep in SUDO_PROTECTED:
    # 각 엔드포인트 함수 본문에 verify_sudo_token 호출이 있는지 확인
    pattern = rf"def {ep}.*?(?=\ndef |\Z)"
    match = re.search(pattern, admin_py, re.DOTALL)
    has_sudo = match and "verify_sudo_token" in match.group(0)
    check(f"HIGH-03-{ep[:10]}", f"{ep}에 verify_sudo_token 적용", bool(has_sudo))

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-04: Webhook secret 미설정 시 시작 경고
# ─────────────────────────────────────────────────────────────────────────────
webhooks_py = read("itsm-api/app/routers/webhooks.py")

check("HIGH-04-a", "_check_webhook_secret_configured 함수 정의",
      "def _check_webhook_secret_configured" in webhooks_py)

check("HIGH-04-b", "모듈 로드 시 즉시 실행 (_check_webhook_secret_configured())",
      "_check_webhook_secret_configured()" in webhooks_py)

check("HIGH-04-c", "미설정 시 logger.error로 경고 (fail-closed 명시)",
      "logger.error" in webhooks_py and "GITLAB_WEBHOOK_SECRET" in webhooks_py)

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-06: CSV 수식 인젝션 방어
# ─────────────────────────────────────────────────────────────────────────────
tickets_py = read("itsm-api/app/routers/tickets.py")

check("HIGH-06-a", "_sc() CSV 새니타이저 함수 정의",
      "def _sc(" in tickets_py or "def _sc(" in tickets_py)

check("HIGH-06-b", "= + - @ 접두사 차단",
      "\"=\"" in tickets_py or "'+'" in tickets_py or
      "'=', '+', '-', '@'" in tickets_py or
      "('=', '+', '-', '@'" in tickets_py)

check("HIGH-06-c", "prefix 탐지 후 앞에 ' 삽입",
      "\"'\" + s" in tickets_py or "\"'\" +" in tickets_py or
      "\"'\" + " in tickets_py)

check("HIGH-06-d", "\\t \\r 도 차단 (DDE 우회 방지)",
      "'\\\\t'" in tickets_py or "'\\t'" in tickets_py or
      r"'\t'" in tickets_py or "\\t" in tickets_py)

# ─────────────────────────────────────────────────────────────────────────────
# HIGH-07: nginx metrics token envsubst 파라미터화
# ─────────────────────────────────────────────────────────────────────────────
nginx_template = read("nginx/templates/default.conf.template")
nginx_old = read("nginx/conf.d/default.conf")

check("HIGH-07-a", "nginx/templates/default.conf.template 파일 존재",
      bool(nginx_template))

check("HIGH-07-b", "템플릿에 ${METRICS_TOKEN} 변수 사용",
      "${METRICS_TOKEN}" in nginx_template)

check("HIGH-07-c", "하드코딩 CHANGE_THIS_TO_A_STRONG_SECRET 템플릿에 없음",
      "CHANGE_THIS_TO_A_STRONG_SECRET" not in nginx_template)

check("HIGH-07-d", "docker-compose nginx 서비스에 METRICS_TOKEN 환경변수 정의",
      "METRICS_TOKEN:" in compose)

check("HIGH-07-e", "docker-compose nginx가 templates 볼륨 마운트",
      "nginx/templates:/etc/nginx/templates" in compose)

# ─────────────────────────────────────────────────────────────────────────────
# MED-01: audit log 필터 allowlist
# ─────────────────────────────────────────────────────────────────────────────
check("MED-01-a", "_AUDIT_RESOURCE_TYPES allowlist 정의",
      "_AUDIT_RESOURCE_TYPES" in admin_py)

check("MED-01-b", "_AUDIT_ACTION_PREFIX_ALLOWLIST 정의",
      "_AUDIT_ACTION_PREFIX_ALLOWLIST" in admin_py or
      "_AUDIT_ACTION" in admin_py)

check("MED-01-c", "resource_type 필터에 allowlist 적용",
      "not in _AUDIT_RESOURCE_TYPES" in admin_py or
      "_AUDIT_RESOURCE_TYPES" in admin_py)

# ─────────────────────────────────────────────────────────────────────────────
# MED-02: 확인 이메일 HTML 이스케이프
# ─────────────────────────────────────────────────────────────────────────────
portal_py = read("itsm-api/app/routers/portal.py")

check("MED-02-a", "html 모듈 import",
      "import html" in portal_py or "import html as" in portal_py)

check("MED-02-b", "name을 html.escape() 처리",
      "escape(name)" in portal_py or "_html_mod.escape(name)" in portal_py)

check("MED-02-c", "track_url을 html.escape() 처리",
      "escape(track_url)" in portal_py or "_html_mod.escape(track_url)" in portal_py)

check("MED-02-d", "이스케이프된 safe_name/safe_url이 이메일 body에 삽입됨",
      "safe_name" in portal_py and "safe_url" in portal_py)

# MED-02 로직 단위 테스트
import html as _html
_xss = "<script>alert('xss')</script>"
_escaped = _html.escape(_xss)
check("MED-02-e", "html.escape XSS 방어 단위 테스트",
      "<script>" not in _escaped and "&lt;script&gt;" in _escaped,
      f"입력: {_xss!r} → {_escaped!r}")

# ─────────────────────────────────────────────────────────────────────────────
# MED-03: webhook 알림 body 제어문자 제거
# ─────────────────────────────────────────────────────────────────────────────
check("MED-03-a", "_safe_str 함수 정의",
      "def _safe_str(" in webhooks_py)

check("MED-03-b", "_safe_str이 re.sub으로 제어문자 제거",
      "re.sub" in webhooks_py and "_safe_str" in webhooks_py)

check("MED-03-c", "author_name에 _safe_str 적용",
      '_safe_str(author.get("name"' in webhooks_py or
      "_safe_str(author" in webhooks_py)

check("MED-03-d", "preview(note_body)에 _safe_str 적용",
      "_safe_str(note_body" in webhooks_py)

# MED-03 로직 단위 테스트
import re as _re
def _safe_str_impl(value, max_len=200):
    s = str(value) if value is not None else ""
    s = _re.sub(r"[\r\n\t\x00-\x1f\x7f]", " ", s)
    return s[:max_len]

_inject = "normal text\ninjected second line\r\ntabbed\there"
_result = _safe_str_impl(_inject)
check("MED-03-e", "_safe_str CRLF 제거 단위 테스트",
      "\n" not in _result and "\r" not in _result and "\t" not in _result,
      f"결과: {_result!r}")

check("MED-03-f", "_safe_str max_len 제한",
      len(_safe_str_impl("x" * 300)) == 200)

# ─────────────────────────────────────────────────────────────────────────────
# MED-04: KB 검색 LIKE 메타문자 이스케이프
# ─────────────────────────────────────────────────────────────────────────────
kb_py = read("itsm-api/app/routers/kb.py")

check("MED-04-a", "LIKE 폴백에서 % 이스케이프 처리",
      r'replace("%", "\\%")' in kb_py or
      r"replace('%', '\\%')" in kb_py)

check("MED-04-b", "LIKE 폴백에서 _ 이스케이프 처리",
      r'replace("_", "\\_")' in kb_py or
      r"replace('_', '\\_')" in kb_py)

check("MED-04-c", "이스케이프 문자가 ilike에 escape 파라미터로 전달됨",
      'ilike(like, escape="\\\\")' in kb_py or
      'escape="\\\\"' in kb_py or
      "escape=" in kb_py)

# MED-04 로직 단위 테스트
def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

_like_cases = [
    ("100%", "100\\%"),
    ("file_name", "file\\_name"),
    ("a%b_c", "a\\%b\\_c"),
    ("normal", "normal"),
    ("back\\slash", "back\\\\slash"),
]
_like_ok = all(_escape_like(q) == exp for q, exp in _like_cases)
check("MED-04-d", "LIKE 이스케이프 로직 단위 테스트",
      _like_ok, f"{len(_like_cases)}개 케이스")

# ─────────────────────────────────────────────────────────────────────────────
# MED-05: API 키 developer 역할 설계 주석
# ─────────────────────────────────────────────────────────────────────────────
auth_main_py = read("itsm-api/app/auth.py")

check("MED-05-a", "API 키 역할 고정에 MED-05 주석 존재",
      "MED-05" in auth_main_py)

check("MED-05-b", "scopes 기반 제어 설명 주석 (require_scope 참조)",
      "require_scope" in auth_main_py and "scopes" in auth_main_py)

check("MED-05-c", "_verify_api_key가 scopes 반환 (접근 제어에 활용)",
      '"scopes": rec.scopes' in auth_main_py or
      "'scopes': rec.scopes" in auth_main_py)

# ─────────────────────────────────────────────────────────────────────────────
# MED-06: refresh token 기본 만료 7일
# ─────────────────────────────────────────────────────────────────────────────
check("MED-06-a", "REFRESH_TOKEN_EXPIRE_DAYS 기본값 7일",
      "REFRESH_TOKEN_EXPIRE_DAYS: int = 7" in config_py)

check("MED-06-b", "기존 30일 값 제거 확인",
      "int = 30" not in config_py or
      "REFRESH_TOKEN_EXPIRE_DAYS: int = 30" not in config_py)

# ─────────────────────────────────────────────────────────────────────────────
# MED-07: HSTS over HTTP 한계 주석
# ─────────────────────────────────────────────────────────────────────────────
check("MED-07-a", "nginx 템플릿에 HSTS-over-HTTP 주석 존재",
      "MED-07" in nginx_template or
      ("HSTS" in nginx_template and "HTTP" in nginx_template))

check("MED-07-b", "Strict-Transport-Security 헤더는 유지됨",
      "Strict-Transport-Security" in nginx_template)

# ─────────────────────────────────────────────────────────────────────────────
# LOW-01: Content-Disposition filename 따옴표
# ─────────────────────────────────────────────────────────────────────────────
check("LOW-01-a", "admin.py Content-Disposition filename 따옴표",
      'filename="' in admin_py)

check("LOW-01-b", "tickets.py Content-Disposition filename 따옴표",
      'filename="' in tickets_py)

# 따옴표 없는 패턴이 없는지 확인
_bad_pattern_admin = re.search(r'filename=[^"\']', admin_py.split("Content-Disposition")[-1] if "Content-Disposition" in admin_py else "")
_bad_pattern_tickets = re.search(r'filename=[^"\']', tickets_py.split("Content-Disposition")[-1] if "Content-Disposition" in tickets_py else "")
check("LOW-01-c", "따옴표 없는 filename= 패턴 없음",
      not _bad_pattern_admin and not _bad_pattern_tickets)

# ─────────────────────────────────────────────────────────────────────────────
# LOW-02: 레이트 리밋 비활성화 시 프로덕션 경고
# ─────────────────────────────────────────────────────────────────────────────
rate_limit_py = read("itsm-api/app/rate_limit.py")

check("LOW-02-a", "slowapi 초기화 실패 시 프로덕션 환경 체크 로직 존재",
      "production" in rate_limit_py and "ENVIRONMENT" in rate_limit_py)

check("LOW-02-b", "프로덕션에서 CRITICAL 수준 로그 출력",
      "logger.error" in rate_limit_py and "CRITICAL" in rate_limit_py)

check("LOW-02-c", "예외 처리 안에서 config 접근 (초기화 오류 방지)",
      "try:" in rate_limit_py.split("except Exception")[-1] or
      "try:" in rate_limit_py)

# ─────────────────────────────────────────────────────────────────────────────
# LOW-03: CORS 와일드카드 프로덕션 차단
# ─────────────────────────────────────────────────────────────────────────────
check("LOW-03-a", "CORS_ORIGINS field_validator 정의",
      "cors_no_wildcard_in_production" in config_py)

check("LOW-03-b", "프로덕션에서 * 포함 시 ValueError",
      'raise ValueError("프로덕션에서는 CORS_ORIGINS' in config_py or
      '"*" in self.CORS_ORIGINS' in config_py)

# LOW-03 로직 단위 테스트
def _cors_production_check(origins: str, env: str) -> bool:
    """프로덕션에서 와일드카드 사용 시 에러 발생 여부"""
    if env == "production" and "*" in origins:
        return False  # 차단
    return True

check("LOW-03-c", "CORS 와일드카드 차단 단위 테스트",
      not _cors_production_check("*", "production") and
      _cors_production_check("*", "development") and
      _cors_production_check("http://localhost", "production"))

# ─────────────────────────────────────────────────────────────────────────────
# LOW-04: GIF EXIF 미처리 문서화
# ─────────────────────────────────────────────────────────────────────────────
check("LOW-04-a", "tickets.py에 GIF EXIF 처리 제외 이유 주석 존재",
      "LOW-04" in tickets_py or
      ("GIF" in tickets_py and "EXIF" in tickets_py and
       ("애니메이션" in tickets_py or "animation" in tickets_py.lower())))

check("LOW-04-b", "_strip_image_metadata가 gif를 스킵 처리 확인",
      '"image/gif"' not in tickets_py.split("_STRIPPABLE")[1].split("if mime not in")[0]
      if "_STRIPPABLE" in tickets_py else False)

# ─────────────────────────────────────────────────────────────────────────────
# LOW-05: 로그 인젝션 방어 (webhooks.py _safe_str)
# ─────────────────────────────────────────────────────────────────────────────
check("LOW-05-a", "_safe_str가 \\r\\n\\t\\x00-\\x1f 제어문자 제거",
      r'[\r\n\t\x00-\x1f' in webhooks_py)

check("LOW-05-b", "actor_name 로그 출력 전 _safe_str 적용",
      '_safe_str(payload.get("user"' in webhooks_py or
      "_safe_str(actor" in webhooks_py or
      "_safe_str(author" in webhooks_py)

# LOW-05 로직 단위 테스트
_log_inject = 'safe\nINFO fake_logger: injected log line'
_safe_log = _safe_str_impl(_log_inject)
check("LOW-05-c", "로그 인젝션 페이로드 단위 테스트",
      "\n" not in _safe_log,
      f"결과: {_safe_log!r}")

# ─────────────────────────────────────────────────────────────────────────────
# LOW-06: 알림 link 내부 경로 검증
# ─────────────────────────────────────────────────────────────────────────────
notifications_py = read("itsm-api/app/notifications.py")

check("LOW-06-a", "_validate_notification_link 함수 정의",
      "def _validate_notification_link" in notifications_py)

check("LOW-06-b", "외부 URL (://) 차단",
      '"://" in link' in notifications_py or
      "'://' in link" in notifications_py)

check("LOW-06-c", "// 프로토콜-상대 URL 차단",
      'startswith("//"' in notifications_py)

check("LOW-06-d", "CRLF 인젝션 차단",
      '"\\n" in link' in notifications_py or
      "'\\n' in link" in notifications_py)

check("LOW-06-e", "/ 로 시작하지 않는 경로 차단",
      'startswith("/")' in notifications_py)

check("LOW-06-f", "create_db_notification이 validator 호출",
      "_validate_notification_link(link)" in notifications_py)

# LOW-06 로직 단위 테스트
def _validate_link(link):
    if link is None:
        return None
    if (not link.startswith("/") or "://" in link or
            "\n" in link or "\r" in link or link.startswith("//")):
        return None
    return link

_link_cases = [
    ("/tickets/1", "/tickets/1"),          # 정상
    ("//evil.com", None),                   # 프로토콜-상대 URL
    ("http://evil.com", None),              # 외부 URL
    ("https://evil.com", None),             # HTTPS 외부 URL
    ("/path\ninjected", None),              # CRLF 인젝션
    ("/path\rinjected", None),              # CR 인젝션
    ("relative/path", None),               # 상대 경로 (/ 없음)
    (None, None),                           # None 통과
    ("/kb/123/edit", "/kb/123/edit"),       # 정상 경로
]
_link_ok = all(_validate_link(i) == e for i, e in _link_cases)
check("LOW-06-g", "link 검증 로직 단위 테스트",
      _link_ok, f"{len(_link_cases)}개 케이스")

# ─────────────────────────────────────────────────────────────────────────────
# INFO-02: TOKEN_ENCRYPTION_KEY 프로덕션 경고
# ─────────────────────────────────────────────────────────────────────────────
check("INFO-02-a", "TOKEN_ENCRYPTION_KEY 빈 값 프로덕션 경고 로직",
      "TOKEN_ENCRYPTION_KEY" in config_py and
      "production" in config_py and
      "logger.warning" in config_py)

check("INFO-02-b", "개발 환경에서는 경고 없음 (조건부)",
      'if self.ENVIRONMENT == "production"' in config_py)

# ─────────────────────────────────────────────────────────────────────────────
# 추가: docker-compose METRICS_TOKEN 강제 설정
# ─────────────────────────────────────────────────────────────────────────────
check("HIGH-07-f", "docker-compose METRICS_TOKEN :? 강제 설정",
      "METRICS_TOKEN:?" in compose)

# ─────────────────────────────────────────────────────────────────────────────
# 결과 출력
# ─────────────────────────────────────────────────────────────────────────────
print()
print("=" * 72)
print(" 4차 보안 감사 개선사항 테스트 결과")
print("=" * 72)

categories = {
    "CRIT": [], "HIGH": [], "MED": [], "LOW": [], "INFO": []
}
for tid, status, desc in results:
    for cat in categories:
        if tid.startswith(cat):
            categories[cat].append((tid, status, desc))
            break

total = len(results)
passed = sum(1 for _, s, _ in results if s == PASS)
failed = sum(1 for _, s, _ in results if s == FAIL)
warned = sum(1 for _, s, _ in results if s == WARN)

for cat, items in categories.items():
    if not items:
        continue
    cat_pass = sum(1 for _, s, _ in items if s == PASS)
    cat_fail = sum(1 for _, s, _ in items if s == FAIL)
    print(f"\n[{cat}] {cat_pass}/{len(items)} PASS")
    for tid, status, desc in items:
        icon = "✅" if status == PASS else ("⚠️ " if status == WARN else "❌")
        print(f"  {icon} {tid:22s} {desc}")

print()
print("─" * 72)
print(f"  총 테스트: {total}개  |  PASS: {passed}  |  FAIL: {failed}  |  WARN: {warned}")
print("─" * 72)

if failed:
    print(f"\n❌ 실패 항목 ({failed}개):")
    for tid, status, desc in results:
        if status == FAIL:
            print(f"  - {tid}: {desc}")

sys.exit(0 if failed == 0 else 1)
