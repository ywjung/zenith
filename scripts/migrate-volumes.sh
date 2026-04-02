#!/usr/bin/env bash
# =============================================================================
# scripts/migrate-volumes.sh
# Docker named volumes → ./volumes/ 바인드 마운트 디렉토리로 데이터 마이그레이션
#
# 사용법:
#   bash scripts/migrate-volumes.sh
#
# 순서:
#   1. 컨테이너 중지
#   2. ./volumes/ 디렉토리 생성
#   3. 기존 named volume 데이터 복사 (alpine 임시 컨테이너 활용)
#   4. 복사 완료 후 컨테이너 재시작
#
# 주의:
#   - 실행 전 .env 파일이 준비되어 있어야 합니다
#   - Docker가 실행 중이어야 합니다
#   - 데이터 크기에 따라 수 분 소요될 수 있습니다 (GitLab 특히)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VOLUMES_DIR="${PROJECT_DIR}/volumes"

# Docker Compose 프로젝트 이름 (docker-compose.yml이 있는 디렉토리 이름)
PROJECT_NAME="$(basename "${PROJECT_DIR}")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# =============================================================================
# named volume → bind mount 매핑
# 형식: "docker_volume_name:host_subpath:container_path"
# =============================================================================
declare -a VOLUME_MAP=(
  "gitlab_config:gitlab/config:/etc/gitlab"
  "gitlab_logs:gitlab/logs:/var/log/gitlab"
  "gitlab_data:gitlab/data:/var/opt/gitlab"
  "itsm_pgdata:postgres/data:/var/lib/postgresql/data"
  "itsm_redis:redis/data:/data"
  "itsm_minio:minio:/data"
  "itsm_grafana:grafana:/var/lib/grafana"
  "itsm_prometheus:prometheus:/prometheus"
  "itsm_clamav:clamav:/var/lib/clamav"
  "itsm_celery_beat:celery-beat:/var/celery"
  "itsm_backups:backups:/backups"
)

# =============================================================================
# 사전 확인
# =============================================================================
check_prerequisites() {
  info "사전 조건 확인 중..."

  if ! command -v docker &>/dev/null; then
    error "Docker가 설치되어 있지 않습니다."
    exit 1
  fi

  if ! docker info &>/dev/null; then
    error "Docker 데몬이 실행 중이지 않습니다."
    exit 1
  fi

  if [[ ! -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
    error "docker-compose.yml을 찾을 수 없습니다: ${PROJECT_DIR}"
    exit 1
  fi

  success "사전 조건 확인 완료"
}

# =============================================================================
# 컨테이너 중지
# =============================================================================
stop_containers() {
  info "실행 중인 컨테이너 중지 중..."
  cd "${PROJECT_DIR}"

  if docker compose ps --quiet 2>/dev/null | grep -q .; then
    docker compose stop
    success "컨테이너 중지 완료"
  else
    info "실행 중인 컨테이너 없음 — 건너뜀"
  fi
}

# =============================================================================
# 볼륨 디렉토리 생성
# =============================================================================
create_directories() {
  info "볼륨 디렉토리 생성 중: ${VOLUMES_DIR}"

  local dirs=(
    "gitlab/config"
    "gitlab/logs"
    "gitlab/data"
    "postgres/data"
    "redis/data"
    "minio"
    "grafana"
    "prometheus"
    "clamav"
    "celery-beat"
    "backups"
  )

  for d in "${dirs[@]}"; do
    mkdir -p "${VOLUMES_DIR}/${d}"
  done

  success "디렉토리 생성 완료"
}

# =============================================================================
# 단일 볼륨 데이터 복사
# 인자: docker_volume_name  host_subpath
# =============================================================================
copy_volume() {
  local vol_name="$1"
  local host_subpath="$2"
  local dest_dir="${VOLUMES_DIR}/${host_subpath}"

  # Docker Compose 프로젝트 prefix 붙은 실제 볼륨 이름 확인
  local full_vol_name="${PROJECT_NAME}_${vol_name}"

  # 볼륨 존재 여부 확인
  if ! docker volume inspect "${full_vol_name}" &>/dev/null; then
    warn "볼륨 없음 — 건너뜀: ${full_vol_name}"
    return 0
  fi

  # 이미 데이터가 있으면 덮어쓰지 않음 (재실행 안전)
  if [[ -n "$(ls -A "${dest_dir}" 2>/dev/null)" ]]; then
    warn "이미 데이터 존재 — 건너뜀: ${host_subpath} (강제 복사: --force 옵션 사용)"
    return 0
  fi

  info "복사 중: ${full_vol_name} → ${dest_dir}"

  docker run --rm \
    -v "${full_vol_name}:/source:ro" \
    -v "${dest_dir}:/dest" \
    alpine \
    sh -c 'cp -a /source/. /dest/ && echo "done"'

  success "복사 완료: ${host_subpath}"
}

# =============================================================================
# --force 옵션: 이미 존재하는 디렉토리도 덮어씀
# =============================================================================
copy_volume_force() {
  local vol_name="$1"
  local host_subpath="$2"
  local dest_dir="${VOLUMES_DIR}/${host_subpath}"
  local full_vol_name="${PROJECT_NAME}_${vol_name}"

  if ! docker volume inspect "${full_vol_name}" &>/dev/null; then
    warn "볼륨 없음 — 건너뜀: ${full_vol_name}"
    return 0
  fi

  info "강제 복사 중: ${full_vol_name} → ${dest_dir}"

  docker run --rm \
    -v "${full_vol_name}:/source:ro" \
    -v "${dest_dir}:/dest" \
    alpine \
    sh -c 'cp -a /source/. /dest/ && echo "done"'

  success "복사 완료 (force): ${host_subpath}"
}

# =============================================================================
# 메인
# =============================================================================
main() {
  local force=false
  local skip_restart=false

  for arg in "$@"; do
    case "$arg" in
      --force)        force=true ;;
      --no-restart)   skip_restart=true ;;
    esac
  done

  echo ""
  echo "=============================================="
  echo " ITSM 볼륨 마이그레이션"
  echo " 프로젝트: ${PROJECT_NAME}"
  echo " 대상:     ${VOLUMES_DIR}"
  echo "=============================================="
  echo ""

  check_prerequisites
  stop_containers
  create_directories

  echo ""
  info "데이터 복사 시작 (GitLab 볼륨은 수 분 소요될 수 있습니다)..."
  echo ""

  for entry in "${VOLUME_MAP[@]}"; do
    IFS=':' read -r vol_name host_subpath _container_path <<< "${entry}"
    if [[ "${force}" == "true" ]]; then
      copy_volume_force "${vol_name}" "${host_subpath}"
    else
      copy_volume "${vol_name}" "${host_subpath}"
    fi
  done

  echo ""
  success "====== 마이그레이션 완료 ======"
  echo ""
  echo "  볼륨 데이터 위치: ${VOLUMES_DIR}"
  echo ""

  if [[ "${skip_restart}" == "false" ]]; then
    info "컨테이너를 다시 시작합니다..."
    cd "${PROJECT_DIR}"
    docker compose up -d
    success "컨테이너 시작 완료"
    echo ""
    docker compose ps
  else
    info "컨테이너 시작을 건너뜁니다 (--no-restart 옵션)"
    info "직접 시작하려면: docker compose up -d"
  fi

  echo ""
  warn "마이그레이션 완료 후 기존 named volume은 수동으로 삭제할 수 있습니다:"
  echo "  docker volume rm ${PROJECT_NAME}_gitlab_config ${PROJECT_NAME}_gitlab_logs ${PROJECT_NAME}_gitlab_data"
  echo "  docker volume rm ${PROJECT_NAME}_itsm_pgdata ${PROJECT_NAME}_itsm_redis ${PROJECT_NAME}_itsm_minio"
  echo "  docker volume rm ${PROJECT_NAME}_itsm_grafana ${PROJECT_NAME}_itsm_prometheus ${PROJECT_NAME}_itsm_clamav"
  echo "  docker volume rm ${PROJECT_NAME}_itsm_celery_beat ${PROJECT_NAME}_itsm_backups"
  echo ""
}

main "$@"
