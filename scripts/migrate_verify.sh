#!/usr/bin/env bash
# migrate_verify.sh — 이전 전·후 데이터 정합성 검증 스크립트
#
# 사용법:
#   # 신규 서버 단독 검증
#   ./scripts/migrate_verify.sh
#
#   # 구 서버와 신규 서버 수치 비교
#   ./scripts/migrate_verify.sh --old-server user@old-server-ip
#
# 옵션:
#   --old-server ADDR     구 서버 SSH 주소 (없으면 로컬만 검증)
#   --expected-tickets N  예상 티켓 수 (로컬 검증 시 기준값)
#   --dry-run             실제 명령 없이 실행 계획만 출력
#
# 환경변수:
#   POSTGRES_USER   PostgreSQL 사용자 (기본: .env에서 읽음)
#   POSTGRES_DB     PostgreSQL DB명
#   ITSM_DIR        ITSM 설치 디렉토리
#
# 예시:
#   ./scripts/migrate_verify.sh
#   ./scripts/migrate_verify.sh --old-server ubuntu@10.0.0.10

set -euo pipefail
IFS=$'\n\t'

# ──────────────────────────────────────────────
# 기본값
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITSM_DIR="${ITSM_DIR:-$(dirname "${SCRIPT_DIR}")}"
OLD_SERVER=""
EXPECTED_TICKETS=""
DRY_RUN=false

# ──────────────────────────────────────────────
# 인수 파싱
# ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --old-server)         OLD_SERVER="$2"; shift 2 ;;
    --expected-tickets)   EXPECTED_TICKETS="$2"; shift 2 ;;
    --dry-run)            DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

# ──────────────────────────────────────────────
# 헬퍼 함수
# ──────────────────────────────────────────────
log()     { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
info()    { echo -e "\033[36m[INFO]\033[0m  $*"; }
ok()      { echo -e "\033[32m[OK]\033[0m    $*"; }
warn()    { echo -e "\033[33m[WARN]\033[0m  $*" >&2; }
err()     { echo -e "\033[31m[ERR]\033[0m   $*" >&2; }
pass()    { echo -e "  \033[32m✓\033[0m $*"; }
fail()    { echo -e "  \033[31m✗\033[0m $*"; FAILURES=$((FAILURES + 1)); }

FAILURES=0

# ──────────────────────────────────────────────
# .env 로드
# ──────────────────────────────────────────────
ENV_FILE="${ITSM_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  while IFS='=' read -r key rest; do
    [[ "${key}" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${key}" ]] && continue
    key="${key// /}"
    [[ -n "${key}" ]] && export "${key}=${rest}" 2>/dev/null || true
  done < "${ENV_FILE}"
fi

POSTGRES_USER="${POSTGRES_USER:-itsm}"
POSTGRES_DB="${POSTGRES_DB:-itsm}"
BASE_URL="http://localhost:${PORT:-8111}"

cd "${ITSM_DIR}" || { err "ITSM 디렉토리 진입 실패: ${ITSM_DIR}"; exit 1; }

# ──────────────────────────────────────────────
# 쿼리 함수: 현재 서버(local) DB에서 통계 추출
# ──────────────────────────────────────────────
get_local_stats() {
  docker compose exec postgres psql \
    -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    -t -A -F',' -c "
SELECT
  (SELECT COUNT(*) FROM issues)                         AS tickets,
  (SELECT COUNT(*) FROM notes)                          AS comments,
  (SELECT COUNT(*) FROM sla_records)                    AS sla_records,
  (SELECT COUNT(*) FROM user_roles)                     AS users,
  (SELECT COUNT(*) FROM kb_articles)                    AS kb_articles,
  (SELECT COUNT(*) FROM audit_logs)                     AS audit_logs,
  (SELECT COALESCE(MAX(iid), 0) FROM issues)            AS latest_iid,
  (SELECT COUNT(*) FROM issues WHERE state='closed')    AS closed_tickets,
  (SELECT COUNT(*) FROM issues WHERE state='opened')    AS open_tickets;
" 2>/dev/null
}

# ──────────────────────────────────────────────
# 쿼리 함수: 구 서버(remote) DB에서 통계 추출
# ──────────────────────────────────────────────
get_remote_stats() {
  local remote="$1"
  ssh -o ConnectTimeout=10 "${remote}" \
    "cd '${ITSM_DIR}' && \
     source .env 2>/dev/null || true && \
     docker compose exec postgres psql \
       -U \"\${POSTGRES_USER:-itsm}\" -d \"\${POSTGRES_DB:-itsm}\" \
       -t -A -F',' -c \"
SELECT
  (SELECT COUNT(*) FROM issues)                         ,
  (SELECT COUNT(*) FROM notes)                          ,
  (SELECT COUNT(*) FROM sla_records)                    ,
  (SELECT COUNT(*) FROM user_roles)                     ,
  (SELECT COUNT(*) FROM kb_articles)                    ,
  (SELECT COUNT(*) FROM audit_logs)                     ,
  (SELECT COALESCE(MAX(iid), 0) FROM issues)            ,
  (SELECT COUNT(*) FROM issues WHERE state='closed')    ,
  (SELECT COUNT(*) FROM issues WHERE state='opened');
\"" 2>/dev/null
}

# ──────────────────────────────────────────────
# 통계 출력 함수
# ──────────────────────────────────────────────
print_stats_table() {
  local label="$1"
  local stats="$2"
  IFS=',' read -r TICKETS COMMENTS SLA USERS KB AUDIT LATEST_IID CLOSED OPENED <<< "${stats}"
  echo ""
  echo "  ┌─ ${label} $(printf '%*s' $((38 - ${#label})) '─')┐"
  printf "  │  %-22s %12s │\n" "티켓 합계"          "${TICKETS}"
  printf "  │  %-22s %12s │\n" "  └ 오픈"           "${OPENED}"
  printf "  │  %-22s %12s │\n" "  └ 종료"           "${CLOSED}"
  printf "  │  %-22s %12s │\n" "댓글"               "${COMMENTS}"
  printf "  │  %-22s %12s │\n" "SLA 레코드"         "${SLA}"
  printf "  │  %-22s %12s │\n" "사용자"             "${USERS}"
  printf "  │  %-22s %12s │\n" "KB 아티클"          "${KB}"
  printf "  │  %-22s %12s │\n" "감사 로그"          "${AUDIT}"
  printf "  │  %-22s %12s │\n" "최신 티켓 IID"      "${LATEST_IID}"
  echo "  └────────────────────────────────────────────┘"
}

# ──────────────────────────────────────────────
# 검증 섹션 1: 컨테이너 상태
# ──────────────────────────────────────────────
log "검증 1: 컨테이너 상태 확인"

REQUIRED_SERVICES=(postgres redis itsm-api itsm-web nginx)
for svc in "${REQUIRED_SERVICES[@]}"; do
  if docker compose ps "${svc}" 2>/dev/null | grep -qE "running|Up"; then
    pass "컨테이너 실행 중: ${svc}"
  else
    if [[ "${DRY_RUN}" == false ]]; then
      fail "컨테이너 중지됨: ${svc}"
    else
      info "[DRY-RUN] docker compose ps ${svc}"
    fi
  fi
done

# ──────────────────────────────────────────────
# 검증 섹션 2: API 헬스체크
# ──────────────────────────────────────────────
log "검증 2: API 헬스체크"

if [[ "${DRY_RUN}" == false ]]; then
  HEALTH_RESP="$(curl -sf --max-time 10 "${BASE_URL}/api/health" 2>/dev/null || echo '')"
  if echo "${HEALTH_RESP}" | grep -q '"status"'; then
    pass "API /health 응답 정상"
    info "  응답: ${HEALTH_RESP}"
  else
    fail "API /health 응답 없음 — URL: ${BASE_URL}/api/health"
  fi

  # DB 연결 확인
  DB_STATUS="$(curl -sf --max-time 10 "${BASE_URL}/api/health" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('database','unknown'))" 2>/dev/null || echo 'unknown')"
  if [[ "${DB_STATUS}" == "ok" || "${DB_STATUS}" == "connected" ]]; then
    pass "DB 연결 상태: ${DB_STATUS}"
  else
    warn "DB 연결 상태 확인 불가: ${DB_STATUS}"
  fi
else
  info "[DRY-RUN] curl ${BASE_URL}/api/health"
fi

# ──────────────────────────────────────────────
# 검증 섹션 3: 데이터 정합성 비교
# ──────────────────────────────────────────────
log "검증 3: 데이터 정합성 검증"

if [[ "${DRY_RUN}" == false ]]; then
  LOCAL_STATS="$(get_local_stats)"

  if [[ -z "${LOCAL_STATS}" ]]; then
    fail "로컬 DB 쿼리 실패 — 컨테이너 상태를 확인하세요"
  else
    print_stats_table "신규 서버" "${LOCAL_STATS}"
    IFS=',' read -r L_TICKETS L_COMMENTS L_SLA L_USERS L_KB L_AUDIT L_IID _ _ <<< "${LOCAL_STATS}"

    if [[ -n "${OLD_SERVER}" ]]; then
      # ─── 구 서버와 비교 ───────────────────────
      info "구 서버(${OLD_SERVER}) 통계 조회 중..."
      REMOTE_STATS="$(get_remote_stats "${OLD_SERVER}" 2>/dev/null || echo '')"

      if [[ -z "${REMOTE_STATS}" ]]; then
        warn "구 서버 통계 조회 실패 (SSH 접근 또는 권한 문제)"
        warn "  수동으로 구 서버에서 다음을 실행하고 비교하세요:"
        warn "  docker compose exec postgres psql -U \${POSTGRES_USER} -d \${POSTGRES_DB} -c 'SELECT COUNT(*) FROM issues;'"
      else
        print_stats_table "구 서버 (이전)" "${REMOTE_STATS}"
        IFS=',' read -r R_TICKETS R_COMMENTS R_SLA R_USERS R_KB R_AUDIT R_IID _ _ <<< "${REMOTE_STATS}"

        echo ""
        echo "  비교 결과:"
        compare_val() {
          local name="$1" local_val="$2" remote_val="$3"
          # 신규 >= 구 서버 (컷오버 후 신규 데이터 있을 수 있으므로 >= 허용)
          if [[ "${local_val}" -ge "${remote_val}" ]]; then
            pass "${name}: 신규(${local_val}) ≥ 구(${remote_val})"
          else
            fail "${name}: 신규(${local_val}) < 구(${remote_val}) — 데이터 유실 가능"
          fi
        }

        compare_val "티켓 수"    "${L_TICKETS}"  "${R_TICKETS}"
        compare_val "댓글 수"    "${L_COMMENTS}" "${R_COMMENTS}"
        compare_val "SLA 레코드" "${L_SLA}"      "${R_SLA}"
        compare_val "사용자 수"  "${L_USERS}"    "${R_USERS}"
        compare_val "KB 아티클"  "${L_KB}"       "${R_KB}"

        if [[ "${L_IID}" -eq "${R_IID}" ]]; then
          pass "최신 티켓 IID 일치: ${L_IID}"
        else
          warn "최신 티켓 IID 다름: 신규=${L_IID}, 구=${R_IID} (컷오버 후 신규 티켓이면 정상)"
        fi
      fi

    elif [[ -n "${EXPECTED_TICKETS}" ]]; then
      # ─── 예상값 비교 ───────────────────────────
      if [[ "${L_TICKETS}" -ge "${EXPECTED_TICKETS}" ]]; then
        pass "티켓 수(${L_TICKETS}) ≥ 예상(${EXPECTED_TICKETS})"
      else
        fail "티켓 수(${L_TICKETS}) < 예상(${EXPECTED_TICKETS})"
      fi
    else
      # ─── 기본 최소 검증 ───────────────────────
      if [[ "${L_TICKETS}" -gt 0 ]]; then
        pass "티켓 존재 (${L_TICKETS}건)"
      else
        warn "티켓이 0건입니다 — 신규 설치 또는 복원 미완료일 수 있습니다"
      fi
      if [[ "${L_USERS}" -gt 0 ]]; then
        pass "사용자 존재 (${L_USERS}명)"
      else
        fail "사용자가 0명입니다 — user_roles 테이블을 확인하세요"
      fi
    fi
  fi
else
  info "[DRY-RUN] 데이터 정합성 쿼리 실행 생략"
fi

# ──────────────────────────────────────────────
# 검증 섹션 4: 파일 업로드 경로 확인
# ──────────────────────────────────────────────
log "검증 4: 파일 업로드 경로 확인"

if [[ "${DRY_RUN}" == false ]]; then
  if docker compose ps itsm-api 2>/dev/null | grep -qE "running|Up"; then
    UPLOAD_COUNT="$(docker compose exec itsm-api \
      find /app/uploads -type f 2>/dev/null | wc -l || echo '0')"
    UPLOAD_SIZE="$(docker compose exec itsm-api \
      du -sh /app/uploads 2>/dev/null | cut -f1 || echo '알 수 없음')"
    pass "업로드 디렉토리 접근 가능: ${UPLOAD_COUNT}개 파일 (${UPLOAD_SIZE})"
  else
    warn "itsm-api 컨테이너 미실행 — 업로드 경로 확인 불가"
  fi
else
  info "[DRY-RUN] docker compose exec itsm-api find /app/uploads -type f | wc -l"
fi

# ──────────────────────────────────────────────
# 검증 섹션 5: .env 환경변수 신규 서버 설정 확인
# ──────────────────────────────────────────────
log "검증 5: .env 환경변수 점검"

ENV_CHECKS=(
  "GITLAB_OAUTH_REDIRECT_URI"
  "FRONTEND_URL"
  "ITSM_WEBHOOK_URL"
  "CORS_ORIGINS"
)

for key in "${ENV_CHECKS[@]}"; do
  val="${!key:-}"
  if [[ -n "${val}" ]]; then
    if echo "${val}" | grep -qE "old-server|localhost|127\.0\.0\.1|example\.com"; then
      warn "${key}=${val}  ← 구 서버 또는 로컬호스트 주소가 남아 있습니다"
      fail "${key} 값 재확인 필요"
    else
      pass "${key}=${val}"
    fi
  else
    warn "${key} 가 설정되어 있지 않습니다"
  fi
done

# ──────────────────────────────────────────────
# 최종 결과
# ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  검증 결과"
echo "══════════════════════════════════════════"
if [[ "${FAILURES}" -eq 0 ]]; then
  echo -e "  \033[32m✓ 모든 검증을 통과했습니다\033[0m"
  echo ""
  echo "  컷오버 진행 가능 — DNS/IP 전환 후 공지 발송"
  EXIT_CODE=0
else
  echo -e "  \033[31m✗ ${FAILURES}개 검증 실패\033[0m"
  echo ""
  echo "  컷오버 보류 — 실패 항목 해결 후 재검증 실행"
  EXIT_CODE=1
fi
echo "══════════════════════════════════════════"

exit "${EXIT_CODE}"
