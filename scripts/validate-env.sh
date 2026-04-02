#!/usr/bin/env bash
# validate-env.sh — 프로덕션 배포 전 필수 환경 변수 검증
# 사용: bash scripts/validate-env.sh [.env 파일 경로, 기본값: .env]
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE 파일이 없습니다. .env.example을 참고하여 생성하세요."
  exit 1
fi

# .env 파일 로드 — 특수문자 포함 값도 안전하게 파싱
# (source 대신 라인별 읽기: SMTP_FROM=... <addr> 같은 값도 처리 가능)
while IFS= read -r line || [ -n "$line" ]; do
  # 빈 줄 / 주석 건너뜀
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  # KEY=VALUE 형식만 처리
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*) ]]; then
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # 따옴표 제거
    val="${val#\"}" ; val="${val%\"}"
    val="${val#\'}" ; val="${val%\'}"
    export "$key=$val"
  fi
done < "$ENV_FILE"

ERRORS=0
WARNINGS=0

fail() { echo "  ✗ ERROR: $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  ⚠ WARNING: $1"; WARNINGS=$((WARNINGS + 1)); }
ok()   { echo "  ✓ $1"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ITSM 프로덕션 환경 변수 검증"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 필수 시크릿 ─────────────────────────────────
echo "[ 1/6 ] 필수 시크릿"

# SECRET_KEY
if [ -z "${SECRET_KEY:-}" ]; then
  fail "SECRET_KEY가 설정되지 않았습니다. (openssl rand -hex 32)"
elif echo "$SECRET_KEY" | grep -qiE "^<REQUIRED|change_me|change_this|your.secret"; then
  fail "SECRET_KEY가 기본값입니다. 강력한 랜덤 값으로 교체하세요."
elif [ ${#SECRET_KEY} -lt 32 ]; then
  fail "SECRET_KEY가 너무 짧습니다 (최소 32자, 현재 ${#SECRET_KEY}자)."
else
  ok "SECRET_KEY"
fi

# TOKEN_ENCRYPTION_KEY
if [ -z "${TOKEN_ENCRYPTION_KEY:-}" ]; then
  fail "TOKEN_ENCRYPTION_KEY가 설정되지 않았습니다. (python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")"
else
  ok "TOKEN_ENCRYPTION_KEY"
fi

# POSTGRES_PASSWORD
if [ -z "${POSTGRES_PASSWORD:-}" ] || echo "${POSTGRES_PASSWORD:-}" | grep -qiE "^<REQUIRED|changeme|change_me"; then
  fail "POSTGRES_PASSWORD가 기본값이거나 미설정입니다."
else
  ok "POSTGRES_PASSWORD"
fi

# REDIS_PASSWORD
if [ -z "${REDIS_PASSWORD:-}" ] || echo "${REDIS_PASSWORD:-}" | grep -qiE "^<REQUIRED|change_me"; then
  fail "REDIS_PASSWORD가 기본값이거나 미설정입니다."
else
  ok "REDIS_PASSWORD"
fi

# METRICS_TOKEN
if [ -z "${METRICS_TOKEN:-}" ] || echo "${METRICS_TOKEN:-}" | grep -qiE "^<REQUIRED|change_me"; then
  fail "METRICS_TOKEN이 기본값이거나 미설정입니다."
else
  ok "METRICS_TOKEN"
fi

# ── GitLab 연동 ─────────────────────────────────
echo ""
echo "[ 2/6 ] GitLab 연동"

for var in GITLAB_OAUTH_CLIENT_ID GITLAB_OAUTH_CLIENT_SECRET GITLAB_PROJECT_TOKEN; do
  val="${!var:-}"
  if [ -z "$val" ] || echo "$val" | grep -qiE "^<REQUIRED|your_"; then
    fail "$var 가 설정되지 않았습니다."
  else
    ok "$var"
  fi
done

# GITLAB_WEBHOOK_SECRET — 선택이지만 프로덕션 권장
if [ -z "${GITLAB_WEBHOOK_SECRET:-}" ]; then
  warn "GITLAB_WEBHOOK_SECRET 미설정 — 웹훅 인증 없이 수신합니다."
else
  ok "GITLAB_WEBHOOK_SECRET"
fi

# ── 이메일 알림 ──────────────────────────────────
echo ""
echo "[ 3/6 ] 이메일 알림"

if [ "${NOTIFICATION_ENABLED:-false}" = "true" ]; then
  for var in SMTP_HOST SMTP_USER SMTP_PASSWORD; do
    if [ -z "${!var:-}" ]; then
      fail "NOTIFICATION_ENABLED=true 이지만 $var 가 설정되지 않았습니다."
    else
      ok "$var"
    fi
  done
else
  ok "이메일 알림 비활성 (NOTIFICATION_ENABLED=false)"
fi

# ── 모니터링 ─────────────────────────────────────
echo ""
echo "[ 4/6 ] 모니터링"

if [ -z "${GRAFANA_PASSWORD:-}" ] || echo "${GRAFANA_PASSWORD:-}" | grep -qiE "^<REQUIRED|^admin$|change_me"; then
  warn "GRAFANA_PASSWORD가 기본값이거나 미설정입니다 (프로파일 사용 시 보안 위험)."
else
  ok "GRAFANA_PASSWORD"
fi

if [ -z "${FLOWER_PASSWORD:-}" ] || echo "${FLOWER_PASSWORD:-}" | grep -qiE "^<REQUIRED|change_me"; then
  fail "FLOWER_PASSWORD가 기본값이거나 미설정입니다."
else
  ok "FLOWER_PASSWORD"
fi

# ── MinIO (선택) ─────────────────────────────────
echo ""
echo "[ 5/6 ] MinIO (선택)"

if [ -n "${MINIO_ENDPOINT:-}" ]; then
  for var in MINIO_ACCESS_KEY MINIO_SECRET_KEY; do
    if [ -z "${!var:-}" ]; then
      fail "MINIO_ENDPOINT 설정 시 $var 가 필요합니다."
    else
      ok "$var"
    fi
  done
else
  ok "MinIO 비활성 (MINIO_ENDPOINT 미설정)"
fi

# ── 보안 설정 ─────────────────────────────────────
echo ""
echo "[ 6/6 ] 보안 설정"

# COOKIE_SECURE — HTTPS 환경에서는 true 권장
if [ "${COOKIE_SECURE:-true}" != "true" ]; then
  warn "COOKIE_SECURE=false — HTTP 개발 환경 전용입니다. 프로덕션에서는 true로 설정하세요."
else
  ok "COOKIE_SECURE=true"
fi

# CORS_ORIGINS — 와일드카드 금지
if echo "${CORS_ORIGINS:-}" | grep -q "\*"; then
  fail "CORS_ORIGINS에 와일드카드(*)가 포함되어 있습니다."
else
  ok "CORS_ORIGINS"
fi

# ENVIRONMENT
if [ "${ENVIRONMENT:-production}" != "production" ]; then
  warn "ENVIRONMENT=${ENVIRONMENT:-} — 프로덕션 배포 시 'production'으로 설정하세요."
else
  ok "ENVIRONMENT=production"
fi

# ── 결과 ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -gt 0 ]; then
  echo "  결과: ✗ FAIL — 오류 ${ERRORS}개, 경고 ${WARNINGS}개"
  echo "  배포를 진행하기 전에 오류 항목을 수정하세요."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo "  결과: ⚠ PASS (경고 ${WARNINGS}개)"
  echo "  경고 항목을 검토한 후 배포하세요."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "  결과: ✓ PASS — 모든 검증 통과"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi
