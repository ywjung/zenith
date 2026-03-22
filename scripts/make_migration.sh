#!/usr/bin/env bash
# make_migration.sh — Alembic 마이그레이션 파일 자동 생성
# 사용법: ./scripts/make_migration.sh "migration description"
# 예시:  ./scripts/make_migration.sh "add notification preferences table"
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"migration description\"" >&2
  exit 1
fi

DESCRIPTION="$*"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/itsm-api"
VERSIONS_DIR="$API_DIR/alembic/versions"

# 최신 revision 번호 계산 (파일명 0001_... 형식 기준)
LATEST_NUM=$(ls "$VERSIONS_DIR"/*.py 2>/dev/null \
  | grep -oE '/[0-9]+_' \
  | grep -oE '[0-9]+' \
  | sort -n \
  | tail -1)

if [[ -z "$LATEST_NUM" ]]; then
  NEXT_NUM="0001"
else
  NEXT_NUM=$(printf "%04d" $((10#$LATEST_NUM + 1)))
fi

# 설명을 snake_case 슬러그로 변환
SLUG=$(echo "$DESCRIPTION" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9가-힣]/_/g' \
  | sed 's/__*/_/g' \
  | sed 's/^_//;s/_$//')

REVISION_ID="${NEXT_NUM}_${SLUG}"
FILENAME="$VERSIONS_DIR/${REVISION_ID}.py"

# 직전 revision ID 파일에서 추출
PREV_FILE=$(ls "$VERSIONS_DIR"/*.py 2>/dev/null | sort | tail -1)
if [[ -n "$PREV_FILE" ]]; then
  PREV_REVISION=$(grep -oE '^revision\s*=\s*"[^"]+"' "$PREV_FILE" | grep -oE '"[^"]+"' | tr -d '"')
else
  PREV_REVISION="None"
fi

TODAY=$(date +%Y-%m-%d)

cat > "$FILENAME" <<PYEOF
"""${DESCRIPTION}

Revision ID: ${REVISION_ID}
Revises: ${PREV_REVISION}
Create Date: ${TODAY}
"""
from alembic import op
import sqlalchemy as sa

revision = "${REVISION_ID}"
down_revision = "${PREV_REVISION}"


def upgrade() -> None:
    pass  # TODO: implement


def downgrade() -> None:
    pass  # TODO: implement
PYEOF

echo "Created: $FILENAME"
echo "Revision: $REVISION_ID"
echo "Revises:  $PREV_REVISION"
