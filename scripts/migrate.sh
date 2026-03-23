#!/usr/bin/env bash
# =============================================================================
# ZENITH ITSM 서버 이전 자동화 스크립트
# 사용법: ./scripts/migrate.sh [SOURCE_HOST] [TARGET_HOST]
# 예)     ./scripts/migrate.sh 192.168.1.10 192.168.1.20
#
# 수행 순서:
#   1. 원본 서버 .env / 볼륨 헬스체크
#   2. PostgreSQL dump (AES-256 암호화)
#   3. Docker 볼륨 rsync (Redis 제외)
#   4. 대상 서버 배포 및 마이그레이션 실행
#   5. 헬스체크 검증
#   6. 실패 시 자동 롤백
# =============================================================================
set -euo pipefail

SOURCE_HOST="${1:-}"
TARGET_HOST="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/tmp/itsm_migration_${TIMESTAMP}"
LOG_FILE="${BACKUP_DIR}/migrate.log"

# ── 색상 출력 헬퍼 ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $*" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOG_FILE"; }
die()     { error "$*"; exit 1; }

# ── 사전 검증 ────────────────────────────────────────────────────────────────
check_prerequisites() {
    info "=== 사전 요구사항 검증 ==="
    for cmd in docker rsync openssl curl ssh; do
        command -v "$cmd" >/dev/null 2>&1 || die "필수 명령어 없음: $cmd"
    done

    [[ -f "${PROJECT_DIR}/.env" ]] || die ".env 파일이 없습니다: ${PROJECT_DIR}/.env"
    source "${PROJECT_DIR}/.env"

    [[ -n "${POSTGRES_PASSWORD:-}" ]] || die ".env에 POSTGRES_PASSWORD 없음"
    [[ -n "${SECRET_KEY:-}" ]]        || die ".env에 SECRET_KEY 없음"
    [[ -n "${ENCRYPTION_KEY:-}" ]]    || ENCRYPTION_KEY=$(openssl rand -hex 32)

    mkdir -p "$BACKUP_DIR"
    info "백업 디렉토리: $BACKUP_DIR"
}

# ── 원본 서버 상태 확인 ───────────────────────────────────────────────────────
check_source_health() {
    info "=== 원본 서버 상태 확인 ==="
    local health
    health=$(curl -sf http://localhost:8111/api/health 2>/dev/null || echo '{}')
    local db_status redis_status
    db_status=$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('db','unknown'))" 2>/dev/null || echo "unknown")
    redis_status=$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('redis','unknown'))" 2>/dev/null || echo "unknown")

    [[ "$db_status" == "ok" ]] || warn "DB 상태 이상: $db_status"
    [[ "$redis_status" == "ok" ]] || warn "Redis 상태 이상: $redis_status"
    info "원본 서버 헬스: DB=${db_status}, Redis=${redis_status}"
}

# ── PostgreSQL 백업 (암호화) ──────────────────────────────────────────────────
backup_postgres() {
    info "=== PostgreSQL 백업 시작 ==="
    source "${PROJECT_DIR}/.env"

    local dump_file="${BACKUP_DIR}/itsm_${TIMESTAMP}.sql"
    local enc_file="${dump_file}.enc"

    # pg_dump 실행
    docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T itsm-postgres \
        pg_dump -U "${POSTGRES_USER:-itsm}" "${POSTGRES_DB:-itsm}" \
        > "$dump_file" || die "pg_dump 실패"

    local dump_size
    dump_size=$(du -sh "$dump_file" | cut -f1)
    info "dump 크기: $dump_size"

    # AES-256-CBC 암호화
    openssl enc -aes-256-cbc -salt -pbkdf2 \
        -k "$ENCRYPTION_KEY" \
        -in "$dump_file" \
        -out "$enc_file" || die "백업 암호화 실패"

    rm -f "$dump_file"
    info "암호화 백업 완료: $enc_file"
    echo "$enc_file"
}

# ── Docker 볼륨 백업 ──────────────────────────────────────────────────────────
backup_volumes() {
    info "=== Docker 볼륨 백업 (업로드 파일) ==="
    local vol_backup="${BACKUP_DIR}/uploads.tar.gz"

    docker run --rm \
        -v itsm_uploads:/data:ro \
        -v "${BACKUP_DIR}:/backup" \
        alpine:latest \
        tar czf /backup/uploads.tar.gz -C /data . 2>/dev/null || \
        warn "업로드 볼륨 백업 실패 (볼륨이 없을 수 있음)"

    [[ -f "$vol_backup" ]] && info "업로드 볼륨 백업: $vol_backup" || info "업로드 볼륨 없음 — 건너뜀"
}

# ── 대상 서버로 전송 ──────────────────────────────────────────────────────────
transfer_to_target() {
    local target="${1:-}"
    [[ -z "$target" ]] && { info "대상 서버 없음 — 로컬 백업만 유지"; return; }

    info "=== 대상 서버 전송: ${target} ==="
    rsync -avz --progress \
        "$BACKUP_DIR/" \
        "root@${target}:/tmp/itsm_migration_${TIMESTAMP}/" || die "rsync 전송 실패"

    # .env 전송 (암호화 채널로만)
    scp "${PROJECT_DIR}/.env" "root@${target}:/tmp/itsm_migration_${TIMESTAMP}/.env.source" || \
        warn ".env 전송 실패 — 수동으로 복사하세요"

    info "전송 완료"
}

# ── 대상 서버 배포 ────────────────────────────────────────────────────────────
deploy_on_target() {
    local target="${1:-}"
    [[ -z "$target" ]] && { info "대상 서버 지정 없음 — 배포 건너뜀"; return; }

    info "=== 대상 서버 배포: ${target} ==="
    ssh "root@${target}" bash <<REMOTE_EOF
set -euo pipefail
cd /opt/itsm 2>/dev/null || { echo "이전 디렉토리가 없습니다. git clone 후 재실행하세요."; exit 1; }

# .env 복사
cp /tmp/itsm_migration_${TIMESTAMP}/.env.source .env

# 복호화 후 DB 복원
ENC_FILE=\$(ls /tmp/itsm_migration_${TIMESTAMP}/*.sql.enc 2>/dev/null | head -1)
if [[ -n "\$ENC_FILE" ]]; then
    openssl enc -aes-256-cbc -d -pbkdf2 -k "${ENCRYPTION_KEY}" -in "\$ENC_FILE" | \
        docker compose exec -T itsm-postgres psql -U itsm itsm
fi

# 컨테이너 기동
docker compose pull
docker compose up -d

# Alembic 마이그레이션
sleep 15
docker compose exec itsm-api alembic upgrade head
REMOTE_EOF
}

# ── 헬스체크 검증 ─────────────────────────────────────────────────────────────
verify_health() {
    local target="${1:-localhost}"
    local port="${2:-8111}"
    local url="http://${target}:${port}/api/health"

    info "=== 헬스체크: $url ==="
    local retries=12
    for i in $(seq 1 $retries); do
        local health
        health=$(curl -sf "$url" 2>/dev/null || echo '{}')
        local status
        status=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
        if [[ "$status" == "ok" ]]; then
            info "✅ 헬스체크 통과 (시도 $i/$retries)"
            return 0
        fi
        warn "헬스체크 대기... ($i/$retries) status='$status'"
        sleep 10
    done
    return 1
}

# ── 롤백 ─────────────────────────────────────────────────────────────────────
rollback() {
    error "=== 롤백 시작 ==="
    warn "원본 서버를 다시 활성화하세요."
    warn "백업 파일 위치: $BACKUP_DIR"
    warn "복구 명령어:"
    warn "  openssl enc -aes-256-cbc -d -pbkdf2 -k <KEY> -in *.sql.enc | \\"
    warn "  docker compose exec -T itsm-postgres psql -U itsm itsm"
}

# ── 메인 ──────────────────────────────────────────────────────────────────────
main() {
    echo "============================================================"
    echo "  ZENITH ITSM 서버 이전 스크립트  (${TIMESTAMP})"
    echo "  SOURCE: ${SOURCE_HOST:-local}"
    echo "  TARGET: ${TARGET_HOST:-local only}"
    echo "============================================================"

    check_prerequisites
    check_source_health

    local enc_file
    enc_file=$(backup_postgres)
    backup_volumes

    if [[ -n "$TARGET_HOST" ]]; then
        transfer_to_target "$TARGET_HOST"
        deploy_on_target "$TARGET_HOST"

        if ! verify_health "$TARGET_HOST"; then
            rollback
            die "대상 서버 헬스체크 실패 — 롤백 필요"
        fi
    fi

    info "=== 이전 완료 ==="
    info "백업 위치: $BACKUP_DIR"
    info "암호화 키(보관 필수): $ENCRYPTION_KEY"
    info "ENCRYPTION_KEY를 안전한 곳에 기록하세요!"
}

trap 'error "오류 발생 (line $LINENO). 롤백 정보: $BACKUP_DIR"; rollback' ERR

main "$@"
