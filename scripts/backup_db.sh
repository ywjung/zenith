#!/usr/bin/env bash
# backup_db.sh — PostgreSQL 자동 백업 (I-3)
# 사용법: ./scripts/backup_db.sh
# 환경변수: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, BACKUP_DIR, RETENTION_DAYS

set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-itsm}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-itsm}"
POSTGRES_DB="${POSTGRES_DB:-itsm}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/itsm_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup started: ${BACKUP_FILE}"

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  "${POSTGRES_DB}" \
  | gzip > "${BACKUP_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed: $(du -sh "${BACKUP_FILE}" | cut -f1)"

# 보존 기간 초과 백업 삭제
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "itsm_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleanup done."
