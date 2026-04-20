#!/usr/bin/env bash
# =============================================================================
# ZENITH ITSM 원클릭 설치 런처 (Production)
#
# 사용법:
#   ./scripts/install.sh                    # 대화형
#   ./scripts/install.sh --mode bundle      # 번들 GitLab 자동 설치
#   ./scripts/install.sh --mode external    # 외부 GitLab 연동 자동 설치
#   ./scripts/install.sh --help
#
# 수행:
#   1) 사전 점검 (Docker, disk, ports)
#   2) 모드 결정: bundle(내장 GitLab) vs external(기존 GitLab)
#   3) .env 생성/병합 + 필수 secret 자동 생성 (openssl rand)
#   4) docker compose 기동 (모드별 override 자동 선택)
#   5) DB 마이그레이션
#   6) 헬스체크 + 접속 정보 출력
#
# 기존 `scripts/setup.sh`는 완전한 대화형 설치 마법사이며, 본 스크립트는
# 이를 감싸는 얇은 런처로 "프로덕션에서 빠르게 올리기"에 초점을 맞춘다.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── 색상 ─────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()  { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }

die()   { err "$*"; exit 1; }

# ── 인자 파싱 ────────────────────────────────────────────────────────────────
MODE=""
FORCE=0
SKIP_HEALTHCHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)    MODE="$2"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    --skip-healthcheck) SKIP_HEALTHCHECK=1; shift ;;
    --help|-h)
      cat <<EOF
ZENITH ITSM 설치 런처

옵션:
  --mode bundle|external   GitLab 모드
                           bundle:   docker-compose.yml의 내장 GitLab 사용
                           external: 기존 GitLab에 연동 (docker-compose.external-gitlab.yml)
  --force                  .env가 이미 있어도 덮어씀 (기존 값은 보존)
  --skip-healthcheck       기동 후 헬스체크 대기 생략 (CI 용)
  --help                   이 메시지

예시:
  ./scripts/install.sh                         # 대화형
  ./scripts/install.sh --mode external         # 외부 GitLab 빠른 설치
  ./scripts/install.sh --mode bundle --force   # 번들, .env 재생성
EOF
      exit 0
      ;;
    *) die "알 수 없는 옵션: $1 (--help 참조)" ;;
  esac
done

# ── 1. 사전 점검 ─────────────────────────────────────────────────────────────
step "1/6 사전 점검"

command -v docker >/dev/null || die "docker 가 설치돼 있지 않습니다."
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null; then
  DC="docker-compose"
else
  die "docker compose 플러그인이 없습니다. Docker 20.10+ + compose v2를 설치하세요."
fi
info "docker: $(docker --version)"
info "compose: $($DC version | head -1)"

# 디스크 공간 (최소 10GB 권장)
avail_kb=$(df -Pk . | tail -1 | awk '{print $4}')
if (( avail_kb < 10 * 1024 * 1024 )); then
  warn "가용 디스크 공간이 10GB 미만입니다 ($(( avail_kb / 1024 / 1024 ))GB). GitLab 번들 설치 시 부족할 수 있음."
fi

# 필수 포트 (bundle 모드에서 GitLab 8929, 2224 필요)
check_port() {
  local port="$1"
  if command -v lsof >/dev/null && lsof -iTCP:"$port" -sTCP:LISTEN -n >/dev/null 2>&1; then
    warn "포트 $port 가 이미 사용 중입니다."
  fi
}

# ── 2. 모드 결정 ─────────────────────────────────────────────────────────────
step "2/6 GitLab 모드 결정"

if [[ -z "$MODE" ]]; then
  echo "이미 운영 중인 GitLab이 있습니까?"
  echo "  [1] 아니요 — 번들 GitLab을 함께 설치 (bundle)"
  echo "  [2] 예     — 기존 GitLab에 연동 (external)"
  read -r -p "선택 [1/2]: " sel
  case "$sel" in
    1) MODE="bundle" ;;
    2) MODE="external" ;;
    *) die "잘못된 선택입니다." ;;
  esac
fi

case "$MODE" in
  bundle)
    info "모드: bundle — 내장 GitLab 컨테이너 포함"
    COMPOSE_FILES=(-f docker-compose.yml)
    check_port 8929; check_port 2224
    ;;
  external)
    info "모드: external — 기존 GitLab 재사용"
    COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.external-gitlab.yml)
    ;;
  *) die "--mode는 bundle 또는 external 중 하나여야 합니다." ;;
esac
check_port 8111

# ── 3. .env 생성/병합 ────────────────────────────────────────────────────────
step "3/6 환경변수 (.env) 준비"

gen_secret() { openssl rand -hex "${1:-32}"; }
gen_fernet() {
  python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || {
    # cryptography 미설치 시 32바이트 base64 대체 (Fernet 호환 길이)
    python3 -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
  }
}

if [[ -f .env && "$FORCE" -eq 0 ]]; then
  info ".env 이미 존재 — 기존 값 유지 (덮어쓰려면 --force)"
else
  cp .env.example .env
  info ".env.example → .env 복사"

  # 기본 secrets 채움 (빈 값 또는 <REQUIRED:...> 플레이스홀더만 갱신)
  set_if_placeholder() {
    local key="$1" value="$2"
    # <REQUIRED 또는 your_client_id 등 플레이스홀더로 보이는 값만 교체
    if grep -qE "^${key}=(<REQUIRED|your_|$|\\s*$)" .env; then
      # macOS/BSD sed 호환
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' -E "s|^${key}=.*|${key}=${value}|" .env
      else
        sed -i -E "s|^${key}=.*|${key}=${value}|" .env
      fi
    fi
  }

  set_if_placeholder POSTGRES_PASSWORD   "$(gen_secret 16)"
  set_if_placeholder REDIS_PASSWORD      "$(gen_secret 16)"
  set_if_placeholder SECRET_KEY          "$(gen_secret 32)"
  set_if_placeholder TOKEN_ENCRYPTION_KEY "$(gen_fernet)"
  set_if_placeholder BACKUP_ENCRYPTION_KEY "$(gen_secret 32)"
  set_if_placeholder MINIO_ACCESS_KEY    "$(gen_secret 8)"
  set_if_placeholder MINIO_SECRET_KEY    "$(gen_secret 16)"
  set_if_placeholder GITLAB_WEBHOOK_SECRET "$(gen_secret 24)"
  set_if_placeholder METRICS_TOKEN       "$(gen_secret 24)"
  set_if_placeholder FLOWER_PASSWORD     "$(gen_secret 12)"
  set_if_placeholder GRAFANA_PASSWORD    "$(gen_secret 12)"

  if [[ "$MODE" == "bundle" ]]; then
    set_if_placeholder GITLAB_ROOT_PASSWORD "$(gen_secret 16)"
  else
    # 외부 GitLab 모드: bundle-전용 값은 빈 문자열로
    sed_in() {
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' -E "$1" .env
      else
        sed -i -E "$1" .env
      fi
    }
    sed_in "s|^GITLAB_ROOT_PASSWORD=.*|GITLAB_ROOT_PASSWORD=|"
  fi

  info "필수 secrets 자동 생성 완료"
  warn ".env를 열어 다음 항목을 채우세요:"
  echo "     - GITLAB_API_URL         (외부 GitLab은 사내 URL)"
  echo "     - GITLAB_EXTERNAL_URL    (브라우저 접근 URL)"
  echo "     - GITLAB_OAUTH_CLIENT_ID/SECRET"
  echo "     - GITLAB_PROJECT_TOKEN"
  echo "     - GITLAB_PROJECT_ID"
  echo "     - GITLAB_OAUTH_REDIRECT_URI"
  if [[ -t 0 ]]; then
    read -r -p "지금 편집기로 열까요? [Y/n]: " open_editor
    if [[ "$open_editor" != "n" && "$open_editor" != "N" ]]; then
      "${EDITOR:-vi}" .env
    fi
  fi
fi

# 최소 환경변수 검증
check_required() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)
  if [[ -z "$val" || "$val" =~ ^\<REQUIRED || "$val" =~ ^your_ ]]; then
    die "환경변수 ${key}가 설정되지 않았습니다 (.env 확인)"
  fi
}
for k in SECRET_KEY POSTGRES_PASSWORD REDIS_PASSWORD GITLAB_WEBHOOK_SECRET \
         TOKEN_ENCRYPTION_KEY METRICS_TOKEN FLOWER_PASSWORD GRAFANA_PASSWORD; do
  check_required "$k"
done

# ── 4. Docker Compose 기동 ──────────────────────────────────────────────────
step "4/6 컨테이너 기동"

info "docker compose ${COMPOSE_FILES[*]} pull"
$DC "${COMPOSE_FILES[@]}" pull || warn "pull 실패(로컬 빌드 시도)"

info "docker compose ${COMPOSE_FILES[*]} up -d"
$DC "${COMPOSE_FILES[@]}" up -d

# ── 5. DB 마이그레이션 ──────────────────────────────────────────────────────
step "5/6 DB 마이그레이션"

# API 컨테이너가 READY될 때까지 대기 (최대 120초)
info "itsm-api 기동 대기..."
for i in {1..60}; do
  if $DC "${COMPOSE_FILES[@]}" exec -T itsm-api python -c "print('ok')" >/dev/null 2>&1; then
    info "itsm-api READY"
    break
  fi
  sleep 2
  if (( i == 60 )); then warn "itsm-api 기동 지연 — 계속 진행"; fi
done

info "alembic upgrade head"
if ! $DC "${COMPOSE_FILES[@]}" exec -T itsm-api alembic upgrade head; then
  err "마이그레이션 실패 — 로그를 확인하세요: $DC ${COMPOSE_FILES[*]} logs itsm-api"
  exit 1
fi

# ── 6. 헬스체크 + 접속 정보 ─────────────────────────────────────────────────
step "6/6 헬스체크"

APP_PORT=$(grep -E "^APP_PORT=" .env | cut -d= -f2- | tr -d ' ' || echo "8111")
APP_PORT="${APP_PORT:-8111}"

if (( SKIP_HEALTHCHECK == 0 )); then
  info "http://localhost:${APP_PORT}/api/health"
  for i in {1..30}; do
    if curl -fsS "http://localhost:${APP_PORT}/api/health" >/dev/null 2>&1; then
      info "health OK"
      break
    fi
    sleep 2
  done
fi

cat <<EOF

${BOLD}${GREEN}✓ 설치 완료${NC}

접속 주소:
  웹 UI:         http://localhost:${APP_PORT}
  API 헬스체크:  http://localhost:${APP_PORT}/api/health
  API 문서:      http://localhost:${APP_PORT}/api/docs
EOF

if [[ "$MODE" == "bundle" ]]; then
  cat <<EOF
  번들 GitLab:   http://localhost:8929  (root / \$GITLAB_ROOT_PASSWORD)

${YELLOW}다음 단계${NC} (bundle 모드):
  1) http://localhost:8929 에 root로 로그인
  2) Admin → Applications 에서 OAuth 앱 생성
     - Redirect URI: http://localhost:${APP_PORT}/auth/callback
     - Scopes: openid, read_user, api
  3) 발급받은 Client ID/Secret을 .env의 GITLAB_OAUTH_CLIENT_ID/SECRET에 반영
  4) Project 생성 → Settings → Access Tokens로 Maintainer API 토큰 발급
     GITLAB_PROJECT_TOKEN에 설정
  5) $DC up -d --force-recreate itsm-api celery-worker
EOF
else
  cat <<EOF

${YELLOW}다음 단계${NC} (external 모드):
  자세한 단계는 docs/install-existing-gitlab.md 참고.
  .env에 외부 GitLab URL/OAuth/토큰을 이미 채우지 않았다면 지금 편집:
    \$EDITOR .env
    $DC ${COMPOSE_FILES[*]} up -d --force-recreate itsm-api celery-worker celery-beat
EOF
fi

echo
info "로그 확인:  $DC ${COMPOSE_FILES[*]} logs -f itsm-api"
info "중지:      $DC ${COMPOSE_FILES[*]} down"
