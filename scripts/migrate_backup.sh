#!/usr/bin/env bash
# migrate_backup.sh — 서버 이전용 최종 백업 스크립트
#
# 사용법:
#   ./scripts/migrate_backup.sh [옵션]
#
# 옵션:
#   --output-dir DIR    백업 저장 디렉토리 (기본: /tmp/itsm-migration)
#   --new-server ADDR   신규 서버 SSH 주소 (예: user@192.168.1.100)
#                       지정 시 rsync로 자동 전송 수행
#   --no-uploads        업로드 파일 동기화 건너뜀
#   --dry-run           실제 명령 없이 실행 계획만 출력
#
# 환경변수:
#   POSTGRES_USER       PostgreSQL 사용자 (기본: .env 파일에서 읽음)
#   POSTGRES_DB         PostgreSQL DB명  (기본: .env 파일에서 읽음)
#   ITSM_DIR            ITSM 설치 디렉토리 (기본: 스크립트 위치 기준 부모)
#
# 예시:
#   ./scripts/migrate_backup.sh
#   ./scripts/migrate_backup.sh --output-dir /opt/backup --new-server ubuntu@10.0.0.50

set -euo pipefail
IFS=$'\n\t'

# ──────────────────────────────────────────────
# 기본값 설정
# ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITSM_DIR="${ITSM_DIR:-$(dirname "${SCRIPT_DIR}")}"
OUTPUT_DIR="/tmp/itsm-migration"
NEW_SERVER=""
SYNC_UPLOADS=true
DRY_RUN=false

# ──────────────────────────────────────────────
# 인수 파싱
# ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)   OUTPUT_DIR="$2"; shift 2 ;;
    --new-server)   NEW_SERVER="$2"; shift 2 ;;
    --no-uploads)   SYNC_UPLOADS=false; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

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
  # 줄바꿈/특수문자가 포함된 값(예: SMTP_FROM=Name <email>)을 안전하게 처리
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

if ! docker compose ps postgres 2>/dev/null | grep -q "running\|Up"; then
  err "PostgreSQL 컨테이너가 실행 중이지 않습니다."
  err "  docker compose up -d postgres 후 재시도 하세요."
  exit 1
fi

ok "사전 점검 통과"

# ──────────────────────────────────────────────
# 출력 디렉토리 준비
# ──────────────────────────────────────────────
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="${OUTPUT_DIR}/itsm_final_${TIMESTAMP}.dump"
MD5_FILE="${DUMP_FILE}.md5"

run "mkdir -p '${OUTPUT_DIR}'"
info "백업 저장 위치: ${OUTPUT_DIR}"
info "덤프 파일:      ${DUMP_FILE}"

# ──────────────────────────────────────────────
# Step 1: nginx 점검 모드 전환
# ──────────────────────────────────────────────
log "Step 1: nginx 점검 모드 전환 중..."

MAINT_CONF="$(cat <<'EOF'
server {
  listen 80;
  return 503 '{"error":"점검 중입니다. 잠시 후 다시 시도해주세요."}';
  add_header Content-Type "application/json";
}
EOF
)"

if docker compose ps nginx 2>/dev/null | grep -q "running\|Up"; then
  run "echo '${MAINT_CONF}' > /tmp/itsm_maintenance.conf"
  run "docker cp /tmp/itsm_maintenance.conf itsm-nginx-1:/etc/nginx/conf.d/default.conf 2>/dev/null \
    || docker compose cp /tmp/itsm_maintenance.conf nginx:/etc/nginx/conf.d/default.conf"
  run "docker compose exec nginx nginx -s reload"
  ok "nginx 점검 모드 진입 완료"
else
  warn "nginx 컨테이너를 찾을 수 없습니다 — 점검 모드 건너뜀"
fi

# ──────────────────────────────────────────────
# Step 2: PostgreSQL 최종 덤프
# ──────────────────────────────────────────────
log "Step 2: PostgreSQL 최종 덤프 시작..."
info "  사용자: ${POSTGRES_USER}, DB: ${POSTGRES_DB}"

if [[ "${DRY_RUN}" == false ]]; then
  docker compose exec -T postgres pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --format=custom \
    --compress=9 \
    > "${DUMP_FILE}"

  DUMP_SIZE="$(du -sh "${DUMP_FILE}" | cut -f1)"
  ok "덤프 완료: ${DUMP_FILE} (${DUMP_SIZE})"

  # MD5 체크섬 생성
  md5sum "${DUMP_FILE}" > "${MD5_FILE}"
  ok "MD5 생성: $(cat "${MD5_FILE}")"
else
  run "docker compose exec -T postgres pg_dump -U '${POSTGRES_USER}' -d '${POSTGRES_DB}' --format=custom --compress=9 > '${DUMP_FILE}'"
  run "md5sum '${DUMP_FILE}' > '${MD5_FILE}'"
fi

# ──────────────────────────────────────────────
# Step 3: Redis 스냅샷 (선택)
# ──────────────────────────────────────────────
log "Step 3: Redis 스냅샷 수행 중..."

REDIS_RDB="${OUTPUT_DIR}/redis_final_${TIMESTAMP}.rdb"
if docker compose ps redis 2>/dev/null | grep -q "running\|Up"; then
  REDIS_PASS="${REDIS_PASSWORD:-}"
  if [[ -n "${REDIS_PASS}" ]]; then
    run "docker compose exec redis redis-cli -a '${REDIS_PASS}' BGSAVE"
  else
    run "docker compose exec redis redis-cli BGSAVE"
  fi
  sleep 3
  run "docker cp itsm-redis-1:/data/dump.rdb '${REDIS_RDB}' 2>/dev/null \
    || docker compose cp redis:/data/dump.rdb '${REDIS_RDB}' 2>/dev/null \
    || true"
  ok "Redis 스냅샷 저장: ${REDIS_RDB}"
else
  warn "Redis 컨테이너를 찾을 수 없습니다 — 스냅샷 건너뜀"
fi

# ──────────────────────────────────────────────
# Step 4: 업로드 파일 동기화
# ──────────────────────────────────────────────
if [[ "${SYNC_UPLOADS}" == true ]]; then
  log "Step 4: 업로드 파일 확인 중..."

  # 컨테이너 내부 /app/uploads 크기 확인
  if docker compose ps itsm-api 2>/dev/null | grep -q "running\|Up"; then
    UPLOAD_SIZE="$(docker compose exec itsm-api du -sh /app/uploads 2>/dev/null | cut -f1 || echo "알 수 없음")"
    ok "업로드 파일 크기: ${UPLOAD_SIZE}"
  fi

  if [[ -n "${NEW_SERVER}" ]]; then
    # 신규 서버로 직접 rsync
    run "rsync -avz --progress --checksum \
      itsm-api:/app/uploads/ \
      '${NEW_SERVER}:/opt/itsm-uploads/' 2>/dev/null || true"
    ok "업로드 파일 원격 동기화 완료 → ${NEW_SERVER}:/opt/itsm-uploads/"
  else
    # 로컬에 임시 추출
    UPLOADS_DIR="${OUTPUT_DIR}/uploads_${TIMESTAMP}"
    run "mkdir -p '${UPLOADS_DIR}'"
    run "docker cp itsm-itsm-api-1:/app/uploads '${UPLOADS_DIR}' 2>/dev/null \
      || docker compose cp itsm-api:/app/uploads '${UPLOADS_DIR}' 2>/dev/null \
      || warn '업로드 파일 추출 실패 — 수동으로 복사하세요'"
    ok "업로드 파일 로컬 저장: ${UPLOADS_DIR}"
  fi
else
  info "Step 4: 업로드 파일 동기화 건너뜀 (--no-uploads)"
fi

# ──────────────────────────────────────────────
# Step 5: 신규 서버로 전송 (--new-server 지정 시)
# ──────────────────────────────────────────────
if [[ -n "${NEW_SERVER}" ]]; then
  log "Step 5: 신규 서버로 데이터 전송 중..."
  run "rsync -avz --progress \
    '${DUMP_FILE}' '${MD5_FILE}' \
    '${NEW_SERVER}:/tmp/'"
  ok "DB 덤프 전송 완료 → ${NEW_SERVER}:/tmp/"

  if [[ -f "${REDIS_RDB}" ]]; then
    run "rsync -avz '${REDIS_RDB}' '${NEW_SERVER}:/tmp/' 2>/dev/null || true"
    ok "Redis 스냅샷 전송 완료"
  fi
else
  info "Step 5: 신규 서버 전송 건너뜀 (--new-server 미지정)"
  info "  수동 전송 명령:"
  info "  rsync -avz --progress ${DUMP_FILE} ${MD5_FILE} NEW_SERVER:/tmp/"
fi

# ──────────────────────────────────────────────
# 최종 요약
# ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  백업 완료 요약"
echo "══════════════════════════════════════════"
if [[ "${DRY_RUN}" == false ]]; then
  echo "  DB 덤프:    ${DUMP_FILE}"
  echo "  MD5:        $(cat "${MD5_FILE}")"
  [[ -f "${REDIS_RDB}" ]] && echo "  Redis:      ${REDIS_RDB}"
  echo ""
  echo "  다음 단계:"
  echo "  1. 신규 서버에서 migrate_restore.sh 실행"
  echo "  2. migrate_verify.sh 로 정합성 검증"
  echo "  3. 검증 완료 후 DNS/IP 컷오버"
else
  echo "  [DRY-RUN] 실제 파일이 생성되지 않았습니다."
fi
echo "══════════════════════════════════════════"
