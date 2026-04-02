#!/usr/bin/env bash
# =============================================================================
# scripts/generate-htpasswd.sh
# Prometheus/모니터링 엔드포인트용 nginx Basic Auth 비밀번호 파일 생성
#
# 사용법:
#   bash scripts/generate-htpasswd.sh [username] [password]
#   bash scripts/generate-htpasswd.sh               # 대화형 입력
#
# 생성 위치: nginx/htpasswd/prometheus
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTPASSWD_DIR="${SCRIPT_DIR}/../nginx/htpasswd"
OUTPUT_FILE="${HTPASSWD_DIR}/prometheus"

USERNAME="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$USERNAME" ]]; then
  read -rp "Prometheus 접속 사용자명 [prometheus]: " USERNAME
  USERNAME="${USERNAME:-prometheus}"
fi

if [[ -z "$PASSWORD" ]]; then
  read -rsp "비밀번호: " PASSWORD
  echo ""
  if [[ -z "$PASSWORD" ]]; then
    echo "ERROR: 비밀번호를 입력하세요." >&2
    exit 1
  fi
fi

mkdir -p "$HTPASSWD_DIR"

# htpasswd 명령 또는 Python bcrypt로 해시 생성
if command -v htpasswd &>/dev/null; then
  htpasswd -Bbn "$USERNAME" "$PASSWORD" > "$OUTPUT_FILE"
  echo "생성 완료 (htpasswd): $OUTPUT_FILE"
elif python3 -c "import bcrypt" 2>/dev/null; then
  HASH=$(python3 -c "
import bcrypt, sys
pw = sys.argv[1].encode()
print(bcrypt.hashpw(pw, bcrypt.gensalt(12)).decode())
" "$PASSWORD")
  echo "${USERNAME}:${HASH}" > "$OUTPUT_FILE"
  echo "생성 완료 (python bcrypt): $OUTPUT_FILE"
else
  echo "ERROR: htpasswd(apache2-utils) 또는 python3-bcrypt 가 필요합니다." >&2
  echo "  macOS:  brew install httpd" >&2
  echo "  Ubuntu: apt-get install apache2-utils" >&2
  exit 1
fi

chmod 600 "$OUTPUT_FILE"
echo "nginx 재시작: docker compose restart nginx"
