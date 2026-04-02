#!/usr/bin/env bash
# =============================================================================
# ZENITH ITSM 최초 설치 스크립트
# 사용법: ./scripts/setup.sh [--non-interactive]
#
# 수행 순서:
#   1. 시스템 요구사항 확인 (Docker, Docker Compose, Python3)
#   2. 환경변수 대화형 입력 → .env 생성
#   3. GitLab 단독 기동 및 초기화 대기
#   4. GitLab OAuth Application 안내
#   5. 나머지 서비스 전체 기동
#   6. DB 마이그레이션 (alembic upgrade head)
#   7. 헬스체크 검증 및 접속 정보 출력
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
NON_INTERACTIVE="${1:-}"

# ── 색상 출력 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}══ $* ══${NC}"; }
prompt()  { echo -e "${CYAN}▶${NC} $*"; }

# ── 헬퍼 ─────────────────────────────────────────────────────────────────────
ask() {
    # ask <VAR_NAME> <PROMPT> [DEFAULT]
    local var_name="$1" msg="$2" default="${3:-}"
    if [[ "$NON_INTERACTIVE" == "--non-interactive" ]]; then
        eval "$var_name=\"$default\""
        return
    fi
    local display_default=""
    [[ -n "$default" ]] && display_default=" [${default}]"
    prompt "${msg}${display_default}: "
    read -r input
    if [[ -z "$input" && -n "$default" ]]; then
        eval "$var_name=\"$default\""
    else
        eval "$var_name=\"$input\""
    fi
}

ask_secret() {
    # ask_secret <VAR_NAME> <PROMPT> [DEFAULT]
    local var_name="$1" msg="$2" default="${3:-}"
    if [[ "$NON_INTERACTIVE" == "--non-interactive" ]]; then
        eval "$var_name=\"$default\""
        return
    fi
    local display_default=""
    [[ -n "$default" ]] && display_default=" [자동생성값 사용]"
    prompt "${msg}${display_default} (Enter=자동생성): "
    read -r -s input
    echo
    if [[ -z "$input" && -n "$default" ]]; then
        eval "$var_name=\"$default\""
    elif [[ -n "$input" ]]; then
        eval "$var_name=\"$input\""
    else
        eval "$var_name=\"$default\""
    fi
}

gen_secret() { openssl rand -hex 32; }
gen_redis_pw() { openssl rand -hex 16; }
gen_fernet() {
    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || \
    python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
}

# ── 1. 요구사항 확인 ──────────────────────────────────────────────────────────
check_requirements() {
    step "시스템 요구사항 확인"

    # Docker
    command -v docker >/dev/null 2>&1 || die "Docker가 설치되어 있지 않습니다. https://docs.docker.com/engine/install/ 참고"
    info "Docker: $(docker --version)"

    # Docker Compose (v2 plugin)
    if docker compose version >/dev/null 2>&1; then
        info "Docker Compose: $(docker compose version)"
    elif command -v docker-compose >/dev/null 2>&1; then
        warn "docker-compose v1이 감지되었습니다. v2(plugin) 사용을 권장합니다."
        # 이후 명령은 'docker compose' (v2)로 통일
    else
        die "Docker Compose가 설치되어 있지 않습니다. Docker Desktop 또는 compose plugin을 설치하세요."
    fi

    # Python3 (Fernet 키 생성용)
    command -v python3 >/dev/null 2>&1 || die "python3이 필요합니다."

    # cryptography 패키지 (없으면 base64 폴백 사용 — gen_fernet 내부 처리)
    python3 -c "from cryptography.fernet import Fernet" 2>/dev/null || \
        warn "cryptography 패키지 없음 — base64 폴백으로 Fernet 키 생성"

    # .env 중복 확인
    if [[ -f "${PROJECT_DIR}/.env" ]]; then
        warn ".env 파일이 이미 존재합니다."
        if [[ "$NON_INTERACTIVE" != "--non-interactive" ]]; then
            prompt "덮어쓰시겠습니까? (y/N): "
            read -r overwrite
            [[ "${overwrite,,}" == "y" ]] || { info "설치를 취소합니다."; exit 0; }
        fi
    fi

    info "모든 요구사항 충족"
}

# ── 2. 환경변수 수집 ──────────────────────────────────────────────────────────
collect_env() {
    step "환경변수 설정"

    echo ""
    echo -e "${BOLD}서버 접속 주소를 입력하세요.${NC}"
    echo "  - 로컬 개발: localhost 또는 127.0.0.1"
    echo "  - 원격 서버: 공인 IP 또는 도메인 (예: 192.168.1.100, itsm.company.com)"
    echo ""

    # 서버 주소
    ask SERVER_HOST "서버 주소" "localhost"

    # 포트
    ask APP_PORT "ITSM 포트 (Nginx)" "8111"
    ask GITLAB_PORT "GitLab 포트" "8929"
    ask GRAFANA_PORT "Grafana 포트" "3001"

    # 자동 생성 시크릿
    AUTO_SECRET_KEY=$(gen_secret)
    AUTO_REDIS_PW=$(gen_redis_pw)
    AUTO_POSTGRES_PW=$(gen_secret)
    AUTO_FERNET=$(gen_fernet)
    AUTO_GITLAB_PW=$(gen_secret | head -c 20)

    echo ""
    echo -e "${BOLD}데이터베이스 설정${NC}"
    ask_secret POSTGRES_PASSWORD "PostgreSQL 비밀번호" "$AUTO_POSTGRES_PW"

    echo ""
    echo -e "${BOLD}Redis 설정${NC}"
    ask_secret REDIS_PASSWORD "Redis 비밀번호" "$AUTO_REDIS_PW"

    echo ""
    echo -e "${BOLD}GitLab 설정${NC}"
    ask_secret GITLAB_ROOT_PASSWORD "GitLab root 비밀번호 (최소 8자)" "$AUTO_GITLAB_PW"

    echo ""
    echo -e "${BOLD}ITSM API 보안 키${NC}"
    ask_secret SECRET_KEY "API Secret Key (32자+)" "$AUTO_SECRET_KEY"
    ask_secret TOKEN_ENCRYPTION_KEY "Fernet 암호화 키 (Enter=자동생성)" "$AUTO_FERNET"

    echo ""
    echo -e "${BOLD}이메일 알림 (선택 — Enter로 건너뜀)${NC}"
    ask SMTP_HOST "SMTP 호스트" ""
    if [[ -n "$SMTP_HOST" ]]; then
        ask SMTP_PORT "SMTP 포트" "587"
        ask SMTP_USER "SMTP 사용자" ""
        ask_secret SMTP_PASSWORD "SMTP 비밀번호" ""
        ask SMTP_FROM "발신자 주소" "ITSM Portal <noreply@${SERVER_HOST}>"
        ask IT_TEAM_EMAIL "IT팀 이메일" ""
        NOTIFICATION_ENABLED=true
    else
        SMTP_PORT=587; SMTP_USER=""; SMTP_PASSWORD=""; SMTP_FROM=""
        IT_TEAM_EMAIL=""; NOTIFICATION_ENABLED=false
    fi

    echo ""
    echo -e "${BOLD}텔레그램 알림 (선택 — Enter로 건너뜀)${NC}"
    ask TELEGRAM_BOT_TOKEN "텔레그램 봇 토큰" ""
    if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
        ask TELEGRAM_CHAT_ID "텔레그램 채팅 ID" ""
        TELEGRAM_ENABLED=true
    else
        TELEGRAM_CHAT_ID=""; TELEGRAM_ENABLED=false
    fi

    echo ""
    echo -e "${BOLD}Grafana 설정${NC}"
    ask_secret GRAFANA_PASSWORD "Grafana admin 비밀번호" "admin"

    # URL 조합
    GITLAB_EXTERNAL_URL="http://${SERVER_HOST}:${GITLAB_PORT}"
    FRONTEND_URL="http://${SERVER_HOST}:${APP_PORT}"
    NEXT_PUBLIC_API_BASE_URL="http://${SERVER_HOST}:${APP_PORT}/api"
    NEXT_PUBLIC_GITLAB_URL="http://${SERVER_HOST}:${GITLAB_PORT}"
    GRAFANA_ROOT_URL="http://${SERVER_HOST}:${GRAFANA_PORT}"
    GITLAB_OAUTH_REDIRECT_URI="http://${SERVER_HOST}:${APP_PORT}/api/auth/callback"

    # GitLab OAuth (초기 설정 전이므로 placeholder)
    GITLAB_OAUTH_CLIENT_ID="to_be_filled_after_gitlab_setup"
    GITLAB_OAUTH_CLIENT_SECRET="to_be_filled_after_gitlab_setup"
    GITLAB_PROJECT_TOKEN="to_be_filled_after_gitlab_setup"
    GITLAB_PROJECT_ID="1"
}

# ── 3. .env 생성 ──────────────────────────────────────────────────────────────
write_env() {
    step ".env 파일 생성"

    cat > "${PROJECT_DIR}/.env" <<EOF
# ───────────────────────────────────────────
# Docker 이미지 (CI/CD 배포 시 설정)
# ───────────────────────────────────────────
IMAGE_API=
IMAGE_WEB=
IMAGE_API_TAG=latest
IMAGE_WEB_TAG=latest

# ───────────────────────────────────────────
# PostgreSQL
# ───────────────────────────────────────────
POSTGRES_DB=itsm
POSTGRES_USER=itsm
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# ───────────────────────────────────────────
# GitLab
# ───────────────────────────────────────────
GITLAB_ROOT_PASSWORD=${GITLAB_ROOT_PASSWORD}

# GitLab OAuth 앱에서 발급 (아래 Step 4에서 직접 등록)
GITLAB_OAUTH_CLIENT_ID=${GITLAB_OAUTH_CLIENT_ID}
GITLAB_OAUTH_CLIENT_SECRET=${GITLAB_OAUTH_CLIENT_SECRET}
GITLAB_OAUTH_REDIRECT_URI=${GITLAB_OAUTH_REDIRECT_URI}

# GitLab 프로젝트 액세스 토큰 (Step 4에서 생성)
GITLAB_PROJECT_TOKEN=${GITLAB_PROJECT_TOKEN}
GITLAB_PROJECT_ID=${GITLAB_PROJECT_ID}

GITLAB_GROUP_ID=
GITLAB_GROUP_TOKEN=

GITLAB_WEBHOOK_SECRET=
ITSM_WEBHOOK_URL=http://itsm-api:8000/webhooks/gitlab

# ───────────────────────────────────────────
# Redis
# ───────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}

# ───────────────────────────────────────────
# ITSM API
# ───────────────────────────────────────────
SECRET_KEY=${SECRET_KEY}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}

ENVIRONMENT=production
REFRESH_TOKEN_EXPIRE_DAYS=30
MAX_ACTIVE_SESSIONS=5

GITLAB_EXTERNAL_URL=${GITLAB_EXTERNAL_URL}
FRONTEND_URL=${FRONTEND_URL}

# ───────────────────────────────────────────
# ITSM Web
# ───────────────────────────────────────────
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
NEXT_PUBLIC_GITLAB_URL=${NEXT_PUBLIC_GITLAB_URL}

# ───────────────────────────────────────────
# Nginx
# ───────────────────────────────────────────
APP_PORT=${APP_PORT}

# ───────────────────────────────────────────
# 이메일 알림
# ───────────────────────────────────────────
NOTIFICATION_ENABLED=${NOTIFICATION_ENABLED}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
SMTP_FROM=${SMTP_FROM}
SMTP_TLS=true
IT_TEAM_EMAIL=${IT_TEAM_EMAIL}

# ───────────────────────────────────────────
# 텔레그램 알림
# ───────────────────────────────────────────
TELEGRAM_ENABLED=${TELEGRAM_ENABLED}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}

# ───────────────────────────────────────────
# 모니터링
# ───────────────────────────────────────────
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
GRAFANA_PORT=${GRAFANA_PORT}
GRAFANA_ROOT_URL=${GRAFANA_ROOT_URL}

# ───────────────────────────────────────────
# ClamAV
# ───────────────────────────────────────────
CLAMAV_ENABLED=true
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
EOF

    chmod 600 "${PROJECT_DIR}/.env"
    info ".env 생성 완료: ${PROJECT_DIR}/.env"
}

# ── 4. GitLab 기동 및 초기화 대기 ────────────────────────────────────────────
start_gitlab() {
    step "GitLab 기동 (초기 설정 최대 5분 소요)"

    cd "$PROJECT_DIR"
    docker compose up -d gitlab

    info "GitLab 컨테이너 시작됨. 초기화 완료까지 대기 중..."
    echo ""

    local max_wait=300  # 5분
    local elapsed=0
    local interval=10

    while true; do
        local status
        status=$(docker compose exec -T gitlab gitlab-ctl status 2>/dev/null | grep "^run:" | wc -l || echo "0")
        if [[ "$status" -ge 3 ]]; then
            info "GitLab 서비스 기동 확인 (${status}개 프로세스 실행 중)"
            break
        fi

        # HTTP 응답 확인 (gitlab-ctl 없이도 체크)
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            "http://localhost:${GITLAB_PORT}/-/health" 2>/dev/null || echo "000")
        if [[ "$http_code" == "200" || "$http_code" == "302" || "$http_code" == "301" ]]; then
            info "GitLab HTTP 응답 확인 (${http_code})"
            break
        fi

        elapsed=$((elapsed + interval))
        if [[ $elapsed -ge $max_wait ]]; then
            warn "GitLab 초기화 대기 시간 초과 (${max_wait}s). 수동으로 확인하세요."
            break
        fi

        echo -ne "\r  대기 중... ${elapsed}s / ${max_wait}s (HTTP: ${http_code})  "
        sleep "$interval"
    done
    echo ""

    # 추가 안정화 대기
    sleep 10
    info "GitLab 초기화 완료"
}

# ── 5. GitLab OAuth 앱 등록 안내 ─────────────────────────────────────────────
guide_gitlab_oauth() {
    step "GitLab OAuth Application 등록"

    echo ""
    echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  GitLab OAuth Application 등록 안내${NC}"
    echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "1. 브라우저에서 GitLab에 접속하세요:"
    echo -e "   ${CYAN}${GITLAB_EXTERNAL_URL}${NC}"
    echo ""
    echo -e "2. 로그인:"
    echo -e "   사용자명: ${BOLD}root${NC}"
    echo -e "   비밀번호: ${BOLD}${GITLAB_ROOT_PASSWORD}${NC}"
    echo ""
    echo -e "3. Admin Area → Applications → New Application:"
    echo -e "   - Name: ${BOLD}ITSM Portal${NC}"
    echo -e "   - Redirect URI: ${CYAN}${GITLAB_OAUTH_REDIRECT_URI}${NC}"
    echo -e "   - Scopes: ${BOLD}api, read_user, openid, profile, email${NC}"
    echo -e "   - Confidential: ${BOLD}체크${NC}"
    echo ""
    echo -e "4. Application ID와 Secret을 복사하세요."
    echo ""
    echo -e "5. ITSM 전용 프로젝트 생성 후 Access Token 발급:"
    echo -e "   Project → Settings → Access Tokens"
    echo -e "   - Name: itsm-bot"
    echo -e "   - Scopes: ${BOLD}api${NC}"
    echo -e "   - Role: ${BOLD}Maintainer${NC}"
    echo ""
    echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo ""

    if [[ "$NON_INTERACTIVE" != "--non-interactive" ]]; then
        prompt "위 절차를 완료한 후 Enter를 누르세요..."
        read -r _

        echo ""
        echo -e "${BOLD}발급된 값을 입력하세요:${NC}"
        ask GITLAB_OAUTH_CLIENT_ID    "GitLab OAuth Application ID"    ""
        ask_secret GITLAB_OAUTH_CLIENT_SECRET "GitLab OAuth Secret"    ""
        ask GITLAB_PROJECT_ID         "GitLab 프로젝트 ID"              "1"
        ask_secret GITLAB_PROJECT_TOKEN "GitLab 프로젝트 Access Token"  ""

        # .env 업데이트
        sed -i.bak \
            -e "s|^GITLAB_OAUTH_CLIENT_ID=.*|GITLAB_OAUTH_CLIENT_ID=${GITLAB_OAUTH_CLIENT_ID}|" \
            -e "s|^GITLAB_OAUTH_CLIENT_SECRET=.*|GITLAB_OAUTH_CLIENT_SECRET=${GITLAB_OAUTH_CLIENT_SECRET}|" \
            -e "s|^GITLAB_PROJECT_ID=.*|GITLAB_PROJECT_ID=${GITLAB_PROJECT_ID}|" \
            -e "s|^GITLAB_PROJECT_TOKEN=.*|GITLAB_PROJECT_TOKEN=${GITLAB_PROJECT_TOKEN}|" \
            "${PROJECT_DIR}/.env"
        rm -f "${PROJECT_DIR}/.env.bak"
        info ".env OAuth 정보 업데이트 완료"
    else
        warn "--non-interactive 모드: GitLab OAuth 값은 .env에서 수동으로 입력하세요."
    fi
}

# ── 6. 나머지 서비스 전체 기동 ────────────────────────────────────────────────
start_all_services() {
    step "전체 서비스 기동"

    cd "$PROJECT_DIR"

    info "이미지 빌드 중..."
    docker compose build --quiet itsm-api itsm-web

    info "서비스 시작 중..."
    docker compose up -d

    info "서비스 안정화 대기 (30초)..."
    sleep 30

    # 컨테이너 상태 출력
    echo ""
    docker compose ps
    echo ""
}

# ── 7. DB 마이그레이션 ────────────────────────────────────────────────────────
run_migration() {
    step "DB 마이그레이션 (alembic upgrade head)"

    cd "$PROJECT_DIR"

    local max_retry=5
    for i in $(seq 1 $max_retry); do
        if docker compose exec -T itsm-api alembic upgrade head; then
            info "마이그레이션 완료"
            return 0
        fi
        warn "마이그레이션 시도 $i/$max_retry 실패 — 10초 후 재시도..."
        sleep 10
    done

    die "DB 마이그레이션 실패. 로그 확인: docker compose logs itsm-api"
}

# ── 8. 초기 데이터 시드 ───────────────────────────────────────────────────────
run_seed() {
    step "초기 데이터 시드 (업무시간·시스템설정·빠른답변·서비스카탈로그)"

    local seed_file="${SCRIPT_DIR}/seed.sql"
    if [[ ! -f "$seed_file" ]]; then
        warn "seed.sql 없음 — 건너뜀 (${seed_file})"
        return 0
    fi

    source "${PROJECT_DIR}/.env"
    local max_retry=5
    for i in $(seq 1 $max_retry); do
        if docker compose exec -T itsm-postgres \
            psql -U "${POSTGRES_USER:-itsm}" "${POSTGRES_DB:-itsm}" \
            < "$seed_file"; then
            info "초기 데이터 시드 완료"
            return 0
        fi
        warn "시드 시도 $i/$max_retry 실패 — 10초 후 재시도..."
        sleep 10
    done

    warn "초기 데이터 시드 실패 — 나중에 수동으로 실행하세요:"
    warn "  docker compose exec -T itsm-postgres psql -U itsm itsm < scripts/seed.sql"
}

# ── 9. 헬스체크 ───────────────────────────────────────────────────────────────
verify_health() {
    step "헬스체크 검증"

    local url="http://localhost:${APP_PORT}/api/health"
    local max_wait=120
    local elapsed=0

    while true; do
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [[ "$http_code" == "200" ]]; then
            local health
            health=$(curl -sf "$url" 2>/dev/null || echo '{}')
            local db_status redis_status
            db_status=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('db','?'))" <<< "$health" 2>/dev/null || echo "?")
            redis_status=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checks',{}).get('redis','?'))" <<< "$health" 2>/dev/null || echo "?")
            info "헬스체크 통과 — DB: ${db_status}, Redis: ${redis_status}"
            return 0
        fi

        elapsed=$((elapsed + 10))
        if [[ $elapsed -ge $max_wait ]]; then
            warn "헬스체크 타임아웃 (${max_wait}s). 수동으로 확인하세요: curl ${url}"
            return 1
        fi

        echo -ne "\r  대기 중... ${elapsed}s (HTTP: ${http_code})  "
        sleep 10
    done
    echo ""
}

# ── 10. 완료 요약 ─────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}  ZENITH ITSM 설치 완료!${NC}"
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}접속 주소:${NC}"
    echo -e "  ITSM Portal  : ${CYAN}${FRONTEND_URL}${NC}"
    echo -e "  GitLab       : ${CYAN}${GITLAB_EXTERNAL_URL}${NC}"
    echo -e "  Grafana      : ${CYAN}${GRAFANA_ROOT_URL}${NC}"
    echo -e "  API 헬스     : ${CYAN}${NEXT_PUBLIC_API_BASE_URL}/health${NC}"
    echo ""
    echo -e "${BOLD}관리자 계정:${NC}"
    echo -e "  GitLab root  : ${BOLD}${GITLAB_ROOT_PASSWORD}${NC}"
    echo -e "  Grafana admin: ${BOLD}${GRAFANA_PASSWORD}${NC}"
    echo ""
    echo -e "${BOLD}주요 명령어:${NC}"
    echo -e "  전체 로그       : docker compose logs -f"
    echo -e "  API 로그        : docker compose logs -f itsm-api"
    echo -e "  서비스 재시작   : docker compose restart"
    echo -e "  서비스 중단     : docker compose down"
    echo -e "  DB 마이그레이션 : docker compose exec itsm-api alembic upgrade head"
    echo -e "  초기 데이터 재시드: docker compose exec -T itsm-postgres psql -U itsm itsm < scripts/seed.sql"
    echo -e "  DB 백업         : ./scripts/backup_db.sh"
    echo ""

    if [[ "${GITLAB_OAUTH_CLIENT_ID}" == "to_be_filled_after_gitlab_setup" ]]; then
        echo -e "${YELLOW}⚠️  GitLab OAuth 설정이 완료되지 않았습니다.${NC}"
        echo -e "   .env 파일에서 아래 항목을 직접 입력한 후 서비스를 재시작하세요:"
        echo -e "   - GITLAB_OAUTH_CLIENT_ID"
        echo -e "   - GITLAB_OAUTH_CLIENT_SECRET"
        echo -e "   - GITLAB_PROJECT_TOKEN"
        echo -e "   재시작: ${CYAN}docker compose restart itsm-api itsm-web${NC}"
        echo ""
    fi

    echo -e "${BOLD}설정 파일:${NC} ${PROJECT_DIR}/.env"
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════════════${NC}"
}

# ── 메인 ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║           ZENITH ITSM 최초 설치 스크립트                ║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    cd "$PROJECT_DIR"

    check_requirements
    collect_env
    write_env
    start_gitlab
    guide_gitlab_oauth
    start_all_services
    run_migration
    run_seed
    verify_health || true   # 타임아웃이어도 계속 진행
    print_summary
}

trap 'echo -e "\n${RED}[ERROR]${NC} 설치 중 오류 발생 (line $LINENO). docker compose logs 로 확인하세요." >&2' ERR

main "$@"
