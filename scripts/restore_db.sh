#!/usr/bin/env bash
# restore_db.sh — pg-backup gzip 덤프로부터 PostgreSQL 복구
#
# 사용법:
#   ./scripts/restore_db.sh                       # 최신 백업으로 복구
#   ./scripts/restore_db.sh volumes/backups/itsm_20260401_030000.sql.gz
#   ./scripts/restore_db.sh --dry-run             # 실제 복구 없이 검증만
#
# 환경변수:
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT
#   BACKUP_DIR (기본: volumes/backups)
#   ALLOW_DESTRUCTIVE=1 (기본 비활성 — 기존 DB 내용이 삭제됨을 명시적으로 확인 필요)

set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-itsm}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
POSTGRES_DB="${POSTGRES_DB:-itsm}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-volumes/backups}"

DRY_RUN=0
BACKUP_FILE=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) BACKUP_FILE="$arg" ;;
  esac
done

if [[ -z "$POSTGRES_PASSWORD" ]]; then
  echo "ERROR: POSTGRES_PASSWORD 환경변수를 설정하세요 (.env 로드 필요)." >&2
  exit 2
fi

# 최신 백업 자동 선택
if [[ -z "$BACKUP_FILE" ]]; then
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "ERROR: BACKUP_DIR '$BACKUP_DIR' 이 존재하지 않습니다." >&2
    exit 2
  fi
  BACKUP_FILE=$(ls -1t "$BACKUP_DIR"/itsm_*.sql.gz 2>/dev/null | head -n1 || true)
  if [[ -z "$BACKUP_FILE" ]]; then
    echo "ERROR: $BACKUP_DIR 에 백업 파일(itsm_*.sql.gz)이 없습니다." >&2
    exit 2
  fi
  echo "[info] 자동 선택된 최신 백업: $BACKUP_FILE"
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: 백업 파일이 존재하지 않습니다: $BACKUP_FILE" >&2
  exit 2
fi

# gzip 무결성 검증
echo "[1/4] gzip 무결성 검증..."
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "ERROR: 손상된 gzip 파일입니다: $BACKUP_FILE" >&2
  exit 3
fi
echo "[info] OK — $(du -sh "$BACKUP_FILE" | cut -f1)"

# 파일 앞부분이 SQL dump인지 확인 (pg_dump 헤더)
echo "[2/4] pg_dump 헤더 검증..."
if ! gunzip -c "$BACKUP_FILE" | head -c 4096 | grep -q "PostgreSQL database dump"; then
  echo "ERROR: pg_dump 형식이 아닙니다 (헤더 확인 실패): $BACKUP_FILE" >&2
  exit 3
fi
echo "[info] OK"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] 검증 완료 — 실제 복구는 수행되지 않았습니다."
  exit 0
fi

# 파괴적 작업 확인
if [[ "${ALLOW_DESTRUCTIVE:-0}" != "1" ]]; then
  echo ""
  echo "!! 경고: 복구를 진행하면 데이터베이스 '${POSTGRES_DB}' 의 기존 내용이 덮어써질 수 있습니다."
  echo "!! 진행하려면 ALLOW_DESTRUCTIVE=1 환경변수와 함께 재실행하세요."
  echo "   예: ALLOW_DESTRUCTIVE=1 $0 $BACKUP_FILE"
  exit 4
fi

# 연결 확인
echo "[3/4] DB 연결 확인 (${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB})..."
if ! PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" -c 'SELECT 1' > /dev/null 2>&1; then
  echo "ERROR: DB 연결 실패" >&2
  exit 5
fi

# 복구 실행
echo "[4/4] 복구 진행 중... (시간이 소요될 수 있습니다)"
START=$(date +%s)
if gunzip -c "$BACKUP_FILE" | PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -v ON_ERROR_STOP=1 > /dev/null; then
  ELAPSED=$(( $(date +%s) - START ))
  echo "[info] 복구 완료 (${ELAPSED}s)"
  echo ""
  echo "다음 단계 권장:"
  echo "  1. API 재시작: docker compose restart itsm-api"
  echo "  2. Alembic 버전 확인: docker compose exec itsm-api alembic current"
  echo "  3. 헬스체크: curl -s http://localhost/api/health"
else
  echo "ERROR: 복구 중 오류 발생. DB가 일관되지 않은 상태일 수 있습니다." >&2
  exit 6
fi
