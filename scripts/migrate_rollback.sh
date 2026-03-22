#!/usr/bin/env bash
# migrate_rollback.sh — 긴급 롤백 스크립트 (신규 서버 차단 + 구 서버 복원)
#
# 사용법:
#   # 신규 서버에서 실행 — 트래픽 차단
#   ./scripts/migrate_rollback.sh --block
#
#   # 구 서버에서 실행 — 서비스 복원
#   ./scripts/migrate_rollback.sh --restore-old
#
#   # 구 서버에 이전 중 생성된 데이터 덤프 (신규 서버에서 실행)
#   ./scripts/migrate_rollback.sh --dump-delta
#
# 옵션:
#   --block         신규 서버 nginx를 점검 모드로 전환 (트래픽 차단)
#   --restore-old   구 서버 nginx 정상 설정 복원
#   --dump-delta    신규 서버에서 최신 상태 덤프 생성 (롤백 전 데이터 보존)
#   --dry-run       실제 명령 없이 실행 계획만 출력
#
# 롤백 기준 (docs/migration-plan.md §8.1):
#   - GitLab OAuth 로그인 전체 실패 (5분 이상)
#   - DB 데이터 유실 또는 정합성 오류
#   - API 에러율 5분 기준 > 10%
#   - 파일 업로드·다운로드 전체 실패
#
# 예시:
#   # 신규 서버에서:
#   ./scripts/migrate_rollback.sh --dump-delta
#   ./scripts/migrate_rollback.sh --block
#   # 구 서버에서:
#   ./scripts/migrate_rollback.sh --restore-old

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITSM_DIR="${ITSM_DIR:-$(dirname "${SCRIPT_DIR}")}"
DRY_RUN=false
ACTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --block)       ACTION="block"; shift ;;
    --restore-old) ACTION="restore_old"; shift ;;
    --dump-delta)  ACTION="dump_delta"; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${ACTION}" ]]; then
  echo "오류: --block, --restore-old, --dump-delta 중 하나를 지정하세요." >&2
  exit 1
fi

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
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

cd "${ITSM_DIR}" || { err "디렉토리 진입 실패: ${ITSM_DIR}"; exit 1; }

# ──────────────────────────────────────────────
# Action: --block (신규 서버 트래픽 차단)
# ──────────────────────────────────────────────
if [[ "${ACTION}" == "block" ]]; then
  log "신규 서버 트래픽 차단 시작..."

  MAINT_CONF="$(cat <<'EOF'
server {
  listen 80;
  return 503 '{"error":"긴급 점검 중입니다. 잠시 후 다시 시도해주세요."}';
  add_header Content-Type "application/json";
}
EOF
)"
  run "echo '${MAINT_CONF}' > /tmp/itsm_rollback_maint.conf"
  run "docker cp /tmp/itsm_rollback_maint.conf itsm-nginx-1:/etc/nginx/conf.d/default.conf 2>/dev/null \
    || docker compose cp /tmp/itsm_rollback_maint.conf nginx:/etc/nginx/conf.d/default.conf"
  run "docker compose exec nginx nginx -s reload"

  ok "트래픽 차단 완료"
  echo ""
  echo "다음 단계:"
  echo "  1. 구 서버에서: ./scripts/migrate_rollback.sh --restore-old"
  echo "  2. DNS/IP를 구 서버 주소로 원복"
  echo "  3. GitLab OAuth Redirect URI를 구 서버 URL로 수정"
  echo "  4. 구 서버 정상화 확인: curl http://OLD_SERVER:8111/api/health"
fi

# ──────────────────────────────────────────────
# Action: --restore-old (구 서버 nginx 복원)
# ──────────────────────────────────────────────
if [[ "${ACTION}" == "restore_old" ]]; then
  log "구 서버 nginx 정상 설정 복원 시작..."

  # nginx 설정을 git에서 복원
  if git -C "${ITSM_DIR}" diff --name-only HEAD 2>/dev/null | grep -q "nginx/conf.d/default.conf"; then
    run "git -C '${ITSM_DIR}' checkout nginx/conf.d/default.conf"
    ok "nginx/conf.d/default.conf git에서 복원"
  elif [[ -f "${ITSM_DIR}/nginx/conf.d/default.conf.bak" ]]; then
    run "cp '${ITSM_DIR}/nginx/conf.d/default.conf.bak' '${ITSM_DIR}/nginx/conf.d/default.conf'"
    ok "nginx/conf.d/default.conf 백업에서 복원"
  else
    warn "git 이력 또는 백업이 없습니다 — nginx 설정을 수동으로 복원하세요"
    warn "  현재 설정: cat ${ITSM_DIR}/nginx/conf.d/default.conf"
  fi

  run "docker compose exec nginx nginx -s reload"
  ok "nginx 설정 리로드 완료"

  echo ""
  echo "구 서버 헬스체크:"
  OLD_PORT="${PORT:-8111}"
  if [[ "${DRY_RUN}" == false ]]; then
    HEALTH="$(curl -sf "http://localhost:${OLD_PORT}/api/health" 2>/dev/null || echo '')"
    if [[ -n "${HEALTH}" ]]; then
      ok "구 서버 응답 정상: ${HEALTH}"
    else
      warn "구 서버 헬스체크 실패 — 수동 확인 필요"
      warn "  curl http://localhost:${OLD_PORT}/api/health"
    fi
  else
    run "curl http://localhost:${OLD_PORT}/api/health"
  fi
fi

# ──────────────────────────────────────────────
# Action: --dump-delta (롤백 전 신규 데이터 덤프)
# ──────────────────────────────────────────────
if [[ "${ACTION}" == "dump_delta" ]]; then
  log "롤백 전 신규 서버 데이터 덤프 시작..."

  DELTA_DUMP="/tmp/itsm_rollback_$(date +%Y%m%d_%H%M%S).dump"

  if [[ "${DRY_RUN}" == false ]]; then
    docker compose exec -T postgres pg_dump \
      -U "${POSTGRES_USER}" \
      -d "${POSTGRES_DB}" \
      --format=custom \
      --compress=9 \
      > "${DELTA_DUMP}"

    DUMP_SIZE="$(du -sh "${DELTA_DUMP}" | cut -f1)"
    ok "롤백 전 덤프 완료: ${DELTA_DUMP} (${DUMP_SIZE})"
    echo ""
    echo "이 덤프에는 이전 중 신규 생성된 데이터가 포함되어 있습니다."
    echo "필요 시 구 서버에 수동으로 재적용하세요."
    echo "  rsync -avz ${DELTA_DUMP} OLD_SERVER:/tmp/"
  else
    run "docker compose exec -T postgres pg_dump -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' --format=custom --compress=9 > '${DELTA_DUMP}'"
    ok "[DRY-RUN] 덤프 경로: ${DELTA_DUMP}"
  fi
fi
