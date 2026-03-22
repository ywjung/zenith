#!/usr/bin/env bash
# migrate_restore.sh — 신규 서버 복원 스크립트
#
# 사용법:
#   ./scripts/migrate_restore.sh [옵션] <덤프파일.dump>
#
# 옵션:
#   --uploads-dir DIR   업로드 파일 경로 (기본: /opt/itsm-uploads)
#   --skip-verify       복원 후 데이터 검증 건너뜀
#   --dry-run           실제 명령 없이 실행 계획만 출력
#
# 환경변수:
#   POSTGRES_USER       PostgreSQL 사용자 (기본: .env 파일에서 읽음)
#   POSTGRES_DB         PostgreSQL DB명  (기본: .env 파일에서 읽음)
#   ITSM_DIR            ITSM 설치 디렉토리
#
# 예시:
#   ./scripts/migrate_restore.sh /tmp/itsm_final_20260317_020000.dump
#   ./scripts/migrate_restore.sh --uploads-dir /opt/itsm-uploads /tmp/itsm_final_*.dump

set -euo pipefail
IFS=$'\n\t'

# ──────────────────────────────────────────────
# 기본값 설정
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITSM_DIR="${ITSM_DIR:-$(dirname "${SCRIPT_DIR}")}"
UPLOADS_DIR="/opt/itsm-uploads"
SKIP_VERIFY=false
DRY_RUN=false
DUMP_FILE=""

# ──────────────────────────────────────────────
# 인수 파싱
# ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uploads-dir) UPLOADS_DIR="$2"; shift 2 ;;
    --skip-verify) SKIP_VERIFY=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    -*)
      echo "알 수 없는 옵션: $1" >&2; exit 1
      ;;
    *)
      DUMP_FILE="$1"; shift
      ;;
  esac
done

if [[ -z "${DUMP_FILE}" ]]; then
  echo "오류: 덤프 파일 경로를 지정하세요." >&2
  echo "사용법: $0 [옵션] <덤프파일.dump>" >&2
  exit 1
fi

# 와일드카드 지원 (glob 패턴인 경우 첫 번째 매치 사용)
if [[ "${DUMP_FILE}" == *"*"* ]]; then
  RESOLVED="$(ls ${DUMP_FILE} 2>/dev/null | sort | tail -1)"
  if [[ -z "${RESOLVED}" ]]; then
    echo "오류: 패턴과 일치하는 파일이 없습니다: ${DUMP_FILE}" >&2; exit 1
  fi
  DUMP_FILE="${RESOLVED}"
fi

if [[ "${DRY_RUN}" == false && ! -f "${DUMP_FILE}" ]]; then
  echo "오류: 덤프 파일이 없습니다: ${DUMP_FILE}" >&2; exit 1
fi

# ──────────────────────────────────────────────
# 헬퍼 함수
# ──────────────────────────────────────────────
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
info() { echo -e "\033[36m[INFO]\033[0m  $*"; }
ok()   { echo -e "\033[32m[OK]\033[0m    $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m  $*" >&2; }
err()  { echo -e "\033[31m[ERR]\033[0m   $*" >&2; }
run()  {
  if [[ "${DRY_RUN}" == true ]]; then
    echo "  [DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# ──────────────────────────────────────────────
# .env 파일 로드
# ──────────────────────────────────────────────
ENV_FILE="${ITSM_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  while IFS='=' read -r key rest; do
    [[ "${key}" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key}" ]] && continue
    key="${key// /}"
    [[ -n "${key}" ]] && export "${key}=${rest}" 2>/dev/null || true
  done < "${ENV_FILE}"
  info ".env 로드 완료: ${ENV_FILE}"
else
  warn ".env 파일을 찾을 수 없습니다: ${ENV_FILE}"
fi

POSTGRES_USER="${POSTGRES_USER:-itsm}"
POSTGRES_DB="${POSTGRES_DB:-itsm}"

# ──────────────────────────────────────────────
# 사전 점검
# ──────────────────────────────────────────────
info "사전 점검 시작..."

cd "${ITSM_DIR}" || { err "ITSM 디렉토리 진입 실패: ${ITSM_DIR}"; exit 1; }

if ! command -v docker &>/dev/null; then
  err "docker 명령을 찾을 수 없습니다."; exit 1
fi

ok "사전 점검 통과"
info "  덤프 파일: ${DUMP_FILE}"
info "  업로드 디렉토리: ${UPLOADS_DIR}"
info "  DB: ${POSTGRES_USER}@${POSTGRES_DB}"

# ──────────────────────────────────────────────
# Step 1: MD5 무결성 검증
# ──────────────────────────────────────────────
log "Step 1: 파일 무결성 검증..."

MD5_FILE="${DUMP_FILE}.md5"
if [[ -f "${MD5_FILE}" ]]; then
  if [[ "${DRY_RUN}" == false ]]; then
    cd "$(dirname "${DUMP_FILE}")"
    if md5sum -c "${MD5_FILE}" 2>/dev/null; then
      ok "MD5 검증 통과"
    else
      err "MD5 불일치 — 파일이 손상되었을 수 있습니다"
      err "  확인: md5sum -c ${MD5_FILE}"
      exit 1
    fi
    cd "${ITSM_DIR}"
  else
    run "md5sum -c '${MD5_FILE}'"
  fi
else
  warn "MD5 파일이 없습니다: ${MD5_FILE} — 검증 건너뜀"
fi

# ──────────────────────────────────────────────
# Step 2: 기반 서비스 기동
# ──────────────────────────────────────────────
log "Step 2: 기반 서비스 기동 중 (postgres, redis)..."

run "docker compose up -d postgres redis"

if [[ "${DRY_RUN}" == false ]]; then
  info "PostgreSQL 준비 대기 중..."
  for i in $(seq 1 30); do
    if docker compose exec postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" &>/dev/null; then
      ok "PostgreSQL 준비 완료 (${i}초 소요)"
      break
    fi
    if [[ $i -eq 30 ]]; then
      err "PostgreSQL 기동 타임아웃 (30초)"; exit 1
    fi
    sleep 1
  done
fi

# ──────────────────────────────────────────────
# Step 3: DB 복원
# ──────────────────────────────────────────────
log "Step 3: DB 복원 시작..."
info "  대상: ${POSTGRES_DB} (기존 데이터 삭제 후 복원)"

if [[ "${DRY_RUN}" == false ]]; then
  # pg_restore는 non-zero exit를 낼 수 있으므로 오류를 잡아서 확인
  RESTORE_LOG="/tmp/itsm_restore_${POSTGRES_DB}.log"
  set +e
  cat "${DUMP_FILE}" | docker compose exec -T postgres pg_restore \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    -v 2>&1 | tee "${RESTORE_LOG}" | tail -20
  RESTORE_EXIT=${PIPESTATUS[1]}
  set -e

  # 치명적 오류 확인 (warnings는 무시)
  FATAL_COUNT="$(grep -cE "^pg_restore: error" "${RESTORE_LOG}" 2>/dev/null || echo 0)"
  if [[ "${FATAL_COUNT}" -gt 0 ]]; then
    err "복원 중 ${FATAL_COUNT}개의 오류가 발생했습니다."
    err "로그: ${RESTORE_LOG}"
    exit 1
  fi

  ok "DB 복원 완료 (경고는 정상 범위일 수 있습니다)"
  ok "복원 로그: ${RESTORE_LOG}"
else
  run "cat '${DUMP_FILE}' | docker compose exec -T postgres pg_restore \
    -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' --clean --if-exists --no-owner --no-acl -v 2>&1 | tail -20"
fi

# ──────────────────────────────────────────────
# Step 4: Alembic 마이그레이션
# ──────────────────────────────────────────────
log "Step 4: Alembic 마이그레이션 적용 중..."

run "docker compose up -d itsm-api"

if [[ "${DRY_RUN}" == false ]]; then
  info "API 기동 대기 중..."
  for i in $(seq 1 60); do
    if docker compose exec itsm-api python -c \
      "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" &>/dev/null 2>&1; then
      ok "API 기동 완료 (${i}초 소요)"
      break
    fi
    if [[ $i -eq 60 ]]; then
      warn "API 기동 타임아웃 — 로그를 확인하세요:"
      warn "  docker compose logs itsm-api --tail=50"
    fi
    sleep 1
  done
fi

# ──────────────────────────────────────────────
# Step 5: 전체 서비스 기동
# ──────────────────────────────────────────────
log "Step 5: 전체 서비스 기동 중..."

run "docker compose up -d"
sleep 5

if [[ "${DRY_RUN}" == false ]]; then
  echo ""
  info "컨테이너 상태:"
  docker compose ps
fi

# ──────────────────────────────────────────────
# Step 6: 데이터 정합성 검증
# ──────────────────────────────────────────────
if [[ "${SKIP_VERIFY}" == false ]]; then
  log "Step 6: 데이터 정합성 검증..."

  if [[ "${DRY_RUN}" == false ]]; then
    COUNTS="$(docker compose exec postgres psql \
      -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -t -A -F',' -c "
SELECT
  (SELECT COUNT(*) FROM issues)       ,
  (SELECT COUNT(*) FROM notes)        ,
  (SELECT COUNT(*) FROM sla_records)  ,
  (SELECT COUNT(*) FROM user_roles)   ,
  (SELECT COUNT(*) FROM kb_articles)  ,
  (SELECT COUNT(*) FROM audit_logs)   ,
  (SELECT COALESCE(MAX(iid), 0) FROM issues);
" 2>/dev/null)"

    IFS=',' read -r TICKETS COMMENTS SLA USERS KB AUDIT LATEST_IID <<< "${COUNTS}"
    echo ""
    echo "  ┌──────────────────────────────────────┐"
    echo "  │ 복원 데이터 현황                     │"
    echo "  ├──────────────────────────────────────┤"
    printf "  │  %-20s %14s │\n" "티켓 (issues)"    "${TICKETS}"
    printf "  │  %-20s %14s │\n" "댓글 (notes)"     "${COMMENTS}"
    printf "  │  %-20s %14s │\n" "SLA 레코드"        "${SLA}"
    printf "  │  %-20s %14s │\n" "사용자"            "${USERS}"
    printf "  │  %-20s %14s │\n" "KB 아티클"         "${KB}"
    printf "  │  %-20s %14s │\n" "감사 로그"         "${AUDIT}"
    printf "  │  %-20s %14s │\n" "최신 티켓 IID"     "${LATEST_IID}"
    echo "  └──────────────────────────────────────┘"

    if [[ "${TICKETS}" -eq 0 && "${USERS}" -eq 0 ]]; then
      warn "티켓과 사용자 수가 모두 0입니다 — 복원이 정상적으로 완료되었는지 확인하세요"
    else
      ok "데이터 복원 확인 완료"
    fi
  else
    run "docker compose exec postgres psql -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' -c 'SELECT COUNT(*) FROM issues;'"
  fi
else
  info "Step 6: 데이터 검증 건너뜀 (--skip-verify)"
fi

# ──────────────────────────────────────────────
# Step 7: API 헬스체크
# ──────────────────────────────────────────────
log "Step 7: API 헬스체크..."

BASE_URL="http://localhost:${PORT:-8111}"
if [[ "${DRY_RUN}" == false ]]; then
  HEALTH="$(curl -sf "${BASE_URL}/api/health" 2>/dev/null || echo '')"
  if [[ -n "${HEALTH}" ]]; then
    ok "API 헬스체크 통과: ${HEALTH}"
  else
    warn "API 헬스체크 실패 — 서비스가 아직 기동 중일 수 있습니다"
    warn "  수동 확인: curl ${BASE_URL}/api/health"
  fi
else
  run "curl -sf '${BASE_URL}/api/health'"
fi

# ──────────────────────────────────────────────
# 최종 요약
# ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  복원 완료 요약"
echo "══════════════════════════════════════════"
echo "  DB 복원:    완료"
echo "  서비스:     전체 기동"
echo ""
echo "  다음 단계:"
echo "  1. migrate_verify.sh 로 구 서버 대비 정합성 검증"
echo "  2. 수동 핵심 기능 검증 (docs/migration-plan.md §7.2)"
echo "  3. 이상 없으면 DNS/IP 컷오버 수행"
echo "  4. 이상 있으면 migrate_rollback.sh 실행"
echo "══════════════════════════════════════════"
