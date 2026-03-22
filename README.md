# ZENITH — IT 서비스 관리 플랫폼

> **천정(天頂)** — 하늘에서 가장 높은 점. IT 서비스의 정점을 지향합니다.

GitLab CE 기반 IT 서비스 관리(ITSM) 플랫폼.
티켓 관리 · SLA 추적 · 지식베이스 · 칸반 · 실시간 모니터링을 단일 플랫폼에서 제공합니다.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql)](https://postgresql.org)

---

## 스크린샷

| 로그인 | 티켓 목록 |
|--------|---------|
| ![로그인](docs/screenshots/01-login.png) | ![티켓 목록](docs/screenshots/03-ticket-list.png) |

| 티켓 상세 | 칸반 보드 |
|---------|---------|
| ![티켓 상세](docs/screenshots/04-ticket-detail.png) | ![칸반](docs/screenshots/05-kanban.png) |

| 지식베이스 | 리포트 |
|---------|------|
| ![지식베이스](docs/screenshots/06-kb.png) | ![리포트](docs/screenshots/07-reports.png) |

| 관리자 페이지 | 고객 포털 |
|-----------|---------|
| ![관리](docs/screenshots/08-admin.png) | ![포털](docs/screenshots/02-portal.png) |

---

## 목차

1. [시스템 구성](#1-시스템-구성)
2. [사전 요구사항](#2-사전-요구사항)
3. [설치 — 신규 서버](#3-설치--신규-서버)
4. [환경변수 설정](#4-환경변수-설정)
5. [GitLab 연동 설정](#5-gitlab-연동-설정)
6. [서비스 시작 · 중지](#6-서비스-시작--중지)
7. [DB 마이그레이션](#7-db-마이그레이션)
8. [접속 주소](#8-접속-주소)
9. [주요 기능](#9-주요-기능)
10. [사용자 역할](#10-사용자-역할)
11. [SLA 정책](#11-sla-정책)
12. [보안](#12-보안)
13. [모니터링 (Prometheus + Grafana)](#13-모니터링-prometheus--grafana)
14. [백업 & 복구](#14-백업--복구)
15. [운영 관리](#15-운영-관리)
16. [도메인 · HTTPS 적용 (운영 서버)](#16-도메인--https-적용-운영-서버)
17. [개발 환경](#17-개발-환경)
18. [CI/CD 파이프라인](#18-cicd-파이프라인)
19. [트러블슈팅](#19-트러블슈팅)
20. [버전 이력](#20-버전-이력)
21. [라이선스](#21-라이선스)

---

## 1. 시스템 구성

```
┌─────────────────────────────────────────────────────────────┐
│                    브라우저 (포트 8111)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────▼───────┐
              │  Nginx 1.27   │  리버스 프록시 · gzip · 보안 헤더
              └───┬───────┬───┘
                  │       │
         ┌────────▼──┐ ┌──▼────────┐
         │ Next.js 15│ │ FastAPI   │  Python 3.13 / Uvicorn ASGI
         │  (웹 UI)  │ │  (API)    │
         └────────────┘ └──┬───┬───┘
                           │   │
              ┌────────────┘   └─────────────┐
         ┌────▼──────┐              ┌────────▼───────┐
         │PostgreSQL │              │  Redis 7.4     │
         │    17     │              │  (캐시·Pub/Sub) │
         └───────────┘              └────────────────┘
              │
         ┌────▼──────┐   ┌────────────┐   ┌──────────────┐
         │  GitLab   │   │ Prometheus │   │   Grafana    │
         │   CE      │   │  (:9090)   │   │   (:3001)    │
         └───────────┘   └────────────┘   └──────────────┘
              │
         ┌────▼──────┐
         │  ClamAV   │  바이러스 스캔 데몬
         └───────────┘
```

### 컨테이너 목록

| 컨테이너 | 이미지 | 포트(외부) | 역할 |
|---------|--------|-----------|------|
| `gitlab` | `gitlab/gitlab-ce:latest` | 8929(HTTP), 2224(SSH) | OAuth 제공자 · 이슈 백엔드 |
| `itsm-api` | `${IMAGE_API:-itsm-api}:${IMAGE_API_TAG:-latest}` | 8000(내부) | FastAPI REST API |
| `itsm-web` | `${IMAGE_WEB:-itsm-web}:${IMAGE_WEB_TAG:-latest}` | 3000(내부) | Next.js 웹 UI |
| `nginx` | `nginx:1.27-alpine` | **8111** | 리버스 프록시 |
| `postgres` | `postgres:17` | 5432(내부) | 주 데이터베이스 |
| `redis` | `redis:7.4-alpine` | 6379(내부) | 캐시 · 알림 Pub/Sub |
| `clamav` | `clamav/clamav:1.4` | 3310(내부) | 파일 바이러스 스캔 |
| `prometheus` | `prom/prometheus:latest` | **9090** | 메트릭 수집 |
| `grafana` | `grafana/grafana:latest` | **3001** | 대시보드 |

> **로컬 개발 시**: `docker-compose.override.yml`이 자동 적용되어 `itsm-api` · `itsm-web`을 소스에서 직접 빌드합니다.
> **CI/CD 배포 시**: 레지스트리에 푸시된 이미지를 `IMAGE_API_TAG` / `IMAGE_WEB_TAG` 환경변수로 지정합니다.

### 기술 스택

| 구성 요소 | 버전 |
|---------|------|
| Python | 3.13 |
| FastAPI | 0.135 |
| SQLAlchemy | 2.0 |
| Alembic | 1.18 |
| Pydantic | 2.12 |
| httpx | 0.28 |
| Next.js | 15 |
| Node.js | 22 |
| PostgreSQL | 17 |
| Redis | 7.4 |
| Nginx | 1.27 |

---

## 2. 사전 요구사항

### 하드웨어 최소 사양

| 구성 | 최소 | 권장 |
|------|------|------|
| CPU | 4코어 | 8코어 이상 |
| RAM | **8 GB** | 16 GB 이상 |
| 디스크 | 40 GB SSD | 100 GB SSD 이상 |
| OS | Ubuntu 22.04 LTS / Debian 12 / RHEL 9 | Ubuntu 24.04 LTS |

> **GitLab CE 단독으로 최소 4 GB RAM을 소비합니다.** RAM이 8 GB 미만이면 서비스 불안정이 발생할 수 있습니다.

### 소프트웨어 요구사항

```bash
# Docker 및 Docker Compose (필수)
Docker Engine  24.0 이상
Docker Compose v2.20 이상

# 확인 명령어
docker --version
docker compose version
```

### 포트 개방 요구사항

| 포트 | 용도 | 외부 노출 |
|------|------|----------|
| 8111 | ZENITH 포털 (nginx) | ✅ 필수 |
| 8929 | GitLab 웹 UI | ✅ 필수 |
| 2224 | GitLab SSH | 선택 |
| 3001 | Grafana | 내부망만 |
| 9090 | Prometheus | 내부망만 |

---

## 3. 설치 — 신규 서버

### 3-1. Docker 설치 (Ubuntu 24.04 기준)

```bash
# 이전 버전 제거
sudo apt remove docker docker-engine docker.io containerd runc 2>/dev/null

# 저장소 추가
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker Engine + Compose 설치
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 사용)
sudo usermod -aG docker $USER
newgrp docker

# 설치 확인
docker --version
docker compose version
```

### 3-2. 저장소 클론 및 환경변수 설정

```bash
# 1. 저장소 클론
git clone <저장소 URL> /opt/zenith
cd /opt/zenith

# 2. 환경변수 파일 생성
cp .env.example .env

# 3. 필수 시크릿 자동 생성
SECRET_KEY=$(openssl rand -hex 32)
REDIS_PW=$(openssl rand -hex 16)
TOKEN_ENC=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null \
           || docker run --rm python:3.13-slim python3 -c \
              "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

echo "SECRET_KEY: $SECRET_KEY"
echo "REDIS_PASSWORD: $REDIS_PW"
echo "TOKEN_ENCRYPTION_KEY: $TOKEN_ENC"

# 4. .env 편집 (필수값 입력)
vi .env
```

### 3-3. 환경변수 최소 필수 설정

`.env`를 열어 아래 항목을 반드시 변경합니다:

```bash
# ── PostgreSQL ──────────────────────────────
POSTGRES_PASSWORD=<강력한 랜덤 비밀번호>

# ── GitLab ─────────────────────────────────
GITLAB_ROOT_PASSWORD=<GitLab root 초기 비밀번호>
# ↓ GitLab 기동 후 OAuth 앱·토큰 발급 뒤 채워야 함
GITLAB_OAUTH_CLIENT_ID=
GITLAB_OAUTH_CLIENT_SECRET=
GITLAB_PROJECT_TOKEN=

# ── Redis ───────────────────────────────────
REDIS_PASSWORD=<openssl rand -hex 16 결과>

# ── ZENITH API ──────────────────────────────
SECRET_KEY=<openssl rand -hex 32 결과>
TOKEN_ENCRYPTION_KEY=<Fernet 키>

# ── 외부 접근 URL (서버 IP 또는 도메인으로 변경) ──
NEXT_PUBLIC_API_BASE_URL=http://<서버IP>:8111/api
NEXT_PUBLIC_GITLAB_URL=http://<서버IP>:8929
GITLAB_OAUTH_REDIRECT_URI=http://<서버IP>:8111/api/auth/callback
```

### 3-4. GitLab 먼저 기동 및 초기 설정

```bash
# GitLab만 먼저 기동 (초기화에 3~5분 소요)
docker compose up -d gitlab

# 초기화 완료 대기
docker compose logs -f gitlab | grep -m1 "Reconfigured!"
# "gitlab Reconfigured!" 메시지 확인 후 Ctrl+C

# GitLab 접속: http://<서버IP>:8929
# 계정: root / .env의 GITLAB_ROOT_PASSWORD
```

**GitLab에서 수행할 초기 설정:**

#### OAuth 앱 등록
1. **Admin Area** → **Applications** → **New application**
2. 입력값:
   - Name: `ZENITH`
   - Redirect URI: `http://<서버IP>:8111/api/auth/callback`
   - Confidential: ✅ 체크
   - Scopes: `read_user`, `api`, `openid`
3. **Save** → `Application ID`, `Secret` 복사 → `.env` 입력

#### ZENITH 프로젝트 생성 및 토큰 발급
1. **New project** → `itsm-tickets` (Private) 생성
2. 프로젝트 → **Settings** → **Access Tokens** → New token
   - Name: `ZENITH Service Token`
   - Role: **Maintainer**
   - Scopes: `api`
3. 생성된 토큰 복사 → `.env`의 `GITLAB_PROJECT_TOKEN` 입력
4. 프로젝트 ID 확인 (URL 또는 Settings에서) → `GITLAB_PROJECT_ID` 입력

#### (권장) 그룹 토큰 설정
여러 프로젝트의 라벨을 그룹 레벨에서 공유하려면:
1. **Group** → **Settings** → **Access Tokens**
2. Role: **Maintainer**, Scopes: `api`
3. `.env`에 `GITLAB_GROUP_ID`, `GITLAB_GROUP_TOKEN` 입력

### 3-5. 전체 서비스 기동

```bash
# .env 업데이트 후 전체 서비스 시작
docker compose up -d

# 기동 상태 확인
docker compose ps

# DB 마이그레이션 실행
docker compose exec itsm-api alembic upgrade head

# 헬스체크
curl http://localhost:8111/api/health
# {"status":"ok","checks":{"db":"ok","redis":"ok","gitlab":"ok","label_sync":"ok"}}
```

### 3-6. 첫 로그인 및 관리자 설정

1. `http://<서버IP>:8111` 접속
2. **GitLab으로 로그인** 클릭
3. GitLab `root` 계정으로 로그인 → ZENITH 진입
4. **관리** → **사용자 관리** → 본인 계정에 `admin` 역할 부여
5. **관리** → **서비스 유형** → 카테고리 설정 (기본값: 하드웨어/소프트웨어/네트워크/계정/기타)

---

## 4. 환경변수 설정

전체 `.env` 항목 설명입니다.

### 필수 항목

```bash
# ── PostgreSQL ──────────────────────────────────────────────
POSTGRES_DB=itsm
POSTGRES_USER=itsm
POSTGRES_PASSWORD=<강력한 랜덤 비밀번호>

# ── GitLab ─────────────────────────────────────────────────
GITLAB_ROOT_PASSWORD=<GitLab root 초기 비밀번호>
GITLAB_OAUTH_CLIENT_ID=<OAuth Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<OAuth Secret>
GITLAB_OAUTH_REDIRECT_URI=http://<HOST>:8111/api/auth/callback
GITLAB_PROJECT_TOKEN=<프로젝트 Access Token>
GITLAB_PROJECT_ID=1                    # ZENITH 전용 GitLab 프로젝트 ID
GITLAB_API_URL=http://gitlab:8929      # 내부 Docker 통신용 (변경 불필요)
GITLAB_EXTERNAL_URL=http://<HOST>:8929 # 브라우저에서 GitLab에 직접 접근하는 외부 URL

# ── Redis ───────────────────────────────────────────────────
REDIS_PASSWORD=<openssl rand -hex 16>

# ── ZENITH API ──────────────────────────────────────────────
SECRET_KEY=<openssl rand -hex 32>          # JWT 서명 키 (최소 32자, 기본값 사용 시 시작 거부)
TOKEN_ENCRYPTION_KEY=<Fernet 키>           # Refresh Token 암호화 (미설정 시 시작 경고)
ENVIRONMENT=production                      # development | production
REFRESH_TOKEN_EXPIRE_DAYS=7                # Refresh Token 유효 기간 (기본 7일)
FRONTEND_URL=http://<HOST>:8111            # 이메일 알림 링크에 사용되는 ZENITH URL

# ── 프론트엔드 빌드 시 주입 ────────────────────────────────
NEXT_PUBLIC_API_BASE_URL=http://<HOST>:8111/api
NEXT_PUBLIC_GITLAB_URL=http://<HOST>:8929
```

### 선택 항목

```bash
# ── Docker 이미지 (CI/CD 배포 시 설정) ──────────────────────
IMAGE_API=registry.gitlab.com/<org>/zenith/itsm-api  # 레지스트리 이미지 경로
IMAGE_WEB=registry.gitlab.com/<org>/zenith/itsm-web
IMAGE_API_TAG=latest               # CI가 자동 주입 (dev-20260313, v1.2.3 등)
IMAGE_WEB_TAG=latest
# 로컬 개발 시에는 docker-compose.override.yml이 build: 지시어를 자동 적용하므로 불필요

# ── Nginx 포트 ──────────────────────────────────────────────
APP_PORT=8111                          # ZENITH 포털 외부 포트

# ── GitLab 그룹 라벨 (권장) ────────────────────────────────
GITLAB_GROUP_ID=<그룹 숫자 ID>
GITLAB_GROUP_TOKEN=<그룹 Access Token>

# ── GitLab 웹훅 ────────────────────────────────────────────
GITLAB_WEBHOOK_SECRET=<랜덤 문자열>
ITSM_WEBHOOK_URL=http://itsm-api:8000/webhooks/gitlab
GITLAB_BOT_USERNAME=<ZENITH 서비스 계정 username>  # 웹훅 루프 방지

# ── 이메일 알림 ─────────────────────────────────────────────
NOTIFICATION_ENABLED=false             # true 로 활성화
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=<SMTP 비밀번호>
SMTP_FROM=ZENITH <noreply@example.com>
SMTP_TLS=true
IT_TEAM_EMAIL=itteam@example.com      # IT 팀 수신 이메일

# ── Telegram 알림 ──────────────────────────────────────────
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=<BotFather 발급 토큰>
TELEGRAM_CHAT_ID=<채널 또는 그룹 ID>

# ── IMAP 이메일 수신 (이메일 → 티켓 자동 생성) ─────────────
IMAP_ENABLED=false
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_USER=helpdesk@example.com
IMAP_PASSWORD=<비밀번호>
IMAP_FOLDER=INBOX
IMAP_POLL_INTERVAL=60                  # 폴링 주기 (초)

# ── 세션 / 보안 ─────────────────────────────────────────────
MAX_ACTIVE_SESSIONS=5                  # 계정당 최대 동시 세션
USER_SYNC_INTERVAL=3600                # GitLab 멤버 동기화 주기 (초)

# ── ClamAV 바이러스 스캔 ────────────────────────────────────
CLAMAV_ENABLED=true                    # false 로 스캔 비활성화
CLAMAV_HOST=clamav
CLAMAV_PORT=3310

# ── 모니터링 ────────────────────────────────────────────────
GRAFANA_PASSWORD=<Grafana 관리자 비밀번호>  # 미설정 시 docker compose up 실패
GRAFANA_PORT=3001
GRAFANA_ROOT_URL=http://<HOST>:3001
METRICS_TOKEN=<openssl rand -hex 32>        # nginx /metrics 엔드포인트 토큰 인증
```

### 시크릿 생성 명령어 모음

```bash
# SECRET_KEY (JWT 서명)
openssl rand -hex 32

# REDIS_PASSWORD
openssl rand -hex 16

# TOKEN_ENCRYPTION_KEY (Fernet)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# GITLAB_WEBHOOK_SECRET
openssl rand -hex 20

# GRAFANA_PASSWORD (읽기 쉬운 형태)
openssl rand -base64 12

# METRICS_TOKEN (nginx /metrics 엔드포인트 보호)
openssl rand -hex 32
```

---

## 5. GitLab 연동 설정

### OAuth 앱 등록

1. GitLab → **Admin Area** → **Applications** → **New application**
2. 입력:
   - **Name**: `ZENITH`
   - **Redirect URI**: `http://<HOST>:8111/api/auth/callback`
   - **Confidential**: ✅
   - **Scopes**: `read_user`, `api`, `openid`
3. **Application ID** · **Secret** 복사 → `.env` 반영 → API 재시작

```bash
docker compose restart itsm-api
```

### 프로젝트 Access Token 발급

1. GitLab → ZENITH 프로젝트 → **Settings** → **Access Tokens**
2. 설정:
   - **Token name**: `ZENITH Service Token`
   - **Role**: `Maintainer`
   - **Scopes**: `api`
3. 토큰 복사 → `.env`의 `GITLAB_PROJECT_TOKEN` 반영

### GitLab 웹훅 등록 (실시간 동기화)

개발 프로젝트의 이벤트(MR 머지·CI 실패 등)를 ZENITH에 실시간으로 전달합니다.

1. GitLab → 개발 프로젝트 → **Settings** → **Webhooks** → **Add new webhook**
2. 입력:
   - **URL**: `http://<서버IP>:8111/api/webhooks/gitlab`
     *(Docker 내부라면 `http://itsm-api:8000/webhooks/gitlab`)*
   - **Secret token**: `.env`의 `GITLAB_WEBHOOK_SECRET`
   - **Trigger**: `Push events`, `Issues events`, `Merge request events`, `Pipeline events`, `Comments`
3. **Add webhook** → **Test** 버튼으로 연결 확인

> 웹훅 URL이 외부에서 GitLab에 접근 불가능한 경우, Docker 내부 URL(`http://itsm-api:8000`)을 사용하세요.

### 그룹 라벨 설정 (권장)

여러 프로젝트에서 `status::`, `cat::`, `prio::` 라벨을 공유합니다.

```bash
# .env
GITLAB_GROUP_ID=<그룹 숫자 ID>          # Admin Area → Groups에서 확인
GITLAB_GROUP_TOKEN=<그룹 Access Token>  # 그룹 Settings → Access Tokens, Maintainer, api
```

> 설정하지 않으면 프로젝트 레벨 라벨로 자동 등록됩니다.

---

## 6. 서비스 시작 · 중지

### 전체 시작 / 중지

```bash
docker compose up -d          # 전체 기동
docker compose down           # 전체 중지 (데이터 보존)
docker compose down -v        # ⚠️ 전체 중지 + 볼륨(DB 데이터) 삭제
```

### 개별 서비스 재시작

```bash
docker compose restart itsm-api     # API 서버
docker compose restart itsm-web     # 웹 프론트엔드
docker compose restart nginx        # Nginx (무중단: nginx -s reload 권장)
docker compose restart grafana      # Grafana
docker compose restart clamav       # ClamAV 바이러스 스캐너
```

### Nginx 무중단 설정 리로드

```bash
docker compose exec nginx nginx -s reload
```

### 이미지 업데이트 후 배포

**CI/CD 배포 (권장)** — GitLab 태그로 자동 트리거됩니다. [CI/CD 파이프라인](#18-cicd-파이프라인) 참고.

**로컬 개발 시 재빌드** — `docker-compose.override.yml`의 `build:` 지시어가 자동 적용됩니다:

```bash
# 코드 변경 후 전체 재빌드 (로컬 개발)
docker compose build itsm-api itsm-web
docker compose up -d

# API만 재빌드·교체
docker compose build itsm-api
docker compose up -d --no-deps itsm-api

# 웹만 재빌드·교체
docker compose build itsm-web
docker compose up -d --no-deps itsm-web
```

**레지스트리 이미지로 특정 태그 배포 (프로덕션 환경)**:

```bash
# IMAGE_API_TAG / IMAGE_WEB_TAG 지정 후 pull & 재기동
IMAGE_API_TAG=v1.2.3 IMAGE_WEB_TAG=v1.2.3 docker compose pull
IMAGE_API_TAG=v1.2.3 IMAGE_WEB_TAG=v1.2.3 docker compose up -d
```

### Make 단축키

```bash
make dev          # 전체 시작
make dev-down     # 전체 중지
make build        # 전체 빌드 후 재시작
make build-api    # API만 빌드·재시작
make build-web    # 웹만 빌드·재시작
make migrate      # DB 마이그레이션
make lint         # 린터 (ruff + eslint)
make test         # 전체 테스트
make help         # 명령어 목록
```

### 상태 확인

```bash
# 컨테이너 전체 상태
docker compose ps

# 헬스체크 (db·redis·gitlab·label_sync)
curl http://localhost:8111/api/health

# 리소스 사용량
docker stats --no-stream

# 실시간 로그
docker compose logs -f itsm-api
docker compose logs -f itsm-web
docker compose logs -f clamav
```

---

## 7. DB 마이그레이션

Alembic 마이그레이션 **47단계** (0001~0047)가 관리됩니다.
API 컨테이너 시작 시 **자동으로 최신 버전까지 적용**됩니다.

```bash
# 현재 버전 확인
docker compose exec itsm-api alembic current
# 출력 예: 0047 (head)

# 수동으로 최신 버전 적용
docker compose exec itsm-api alembic upgrade head

# 마이그레이션 이력 조회
docker compose exec itsm-api alembic history

# 한 단계 롤백
docker compose exec itsm-api alembic downgrade -1

# 특정 버전으로 롤백
docker compose exec itsm-api alembic downgrade 0045
```

### 신규 마이그레이션 생성 (개발)

```bash
# 자동 감지 (models.py 변경 반영)
docker compose exec itsm-api alembic revision --autogenerate -m "설명"

# 빈 파일 생성
docker compose exec itsm-api alembic revision -m "설명"

# 파일 위치: itsm-api/alembic/versions/XXXX_설명.py
# 반드시 내용 검토 후 적용!
docker compose exec itsm-api alembic upgrade head
```

---

## 8. 접속 주소

| 서비스 | URL | 설명 |
|--------|-----|------|
| **ZENITH** | `http://<HOST>:8111` | 메인 서비스 (로그인 필요) |
| **고객 포털** | `http://<HOST>:8111/portal` | 비로그인 티켓 접수 |
| **GitLab** | `http://<HOST>:8929` | OAuth 제공자 |
| **Prometheus** | `http://<HOST>:9090` | 메트릭 수집 (내부망) |
| **Grafana** | `http://<HOST>:3001` | 대시보드 (내부망) |
| **API 문서 (Swagger)** | `http://<HOST>:8111/docs` | 내부망만 접근 가능 |
| **API 문서 (ReDoc)** | `http://<HOST>:8111/redoc` | 내부망만 접근 가능 |

> `/docs`, `/redoc`, `/metrics` 는 보안상 `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`, `127.0.0.1` 대역에서만 접근됩니다.

---

## 9. 주요 기능

### 티켓 관리
- 생성·조회·수정·삭제 (파일 첨부 최대 10 MB, ClamAV 바이러스 스캔)
- 상태 워크플로우: `접수됨 → 처리중 → 테스트중 → 대기중 → 처리완료 → 종료`
- 내부 메모 (신청자 비공개), 연관 티켓 링크, 시간 기록 (분 단위)
- **티켓 병합**: 중복 티켓을 대상 티켓으로 병합 (댓글 이전 + 소스 티켓 자동 종료)
- 티켓 복제, Confidential Issue, CSV 내보내기
- **CSV 일괄 티켓 생성**: CSV 파일 업로드로 다수 티켓을 한 번에 생성 (`POST /tickets/import/csv`)
- **타임라인 뷰**: 댓글 · 감사로그 · GitLab 시스템 노트 시간순 통합 표시 + 마크다운 렌더링
- **해결 노트**: 처리완료·종료 시 해결 내용·유형·원인 구조화 기록 → KB 변환 가능
- 첨부 이미지 라이트박스 · PDF sandbox iframe 인라인 미리보기

### 검색 & 필터
- **글로벌 검색 (⌘K)**: 전체 티켓 실시간 검색, 300 ms 디바운스, 검색 히스토리 저장
- 복합 필터 (상태·카테고리·우선순위·SLA·신청자) — 카테고리 필터 정확 동작
- URL 동기화 (북마크·뒤로가기 지원), 즐겨찾기 필터 저장·불러오기
- 정렬 서버사이드 처리 (newest/oldest/priority)

### SLA 관리
- 우선순위별 응답·해결 목표 시간 (관리자 UI에서 설정, 최소 1시간 검증)
- SLA 일시정지/재개 (대기중 상태 연동), 60분 전 사전 경고 알림
- **에스컬레이션 정책**: 위반 시 자동 알림·재배정·우선순위 상향
- 칸반 보드 SLA 색상 배지 (⚠️ 초과 빨간색 / 🟢 여유 초록색)
- **SLA 위반 히트맵**: GitHub 스타일 12주 히트맵 — 날짜별 위반 건수를 5단계 색상 강도로 시각화 (`/reports` 전체 현황 탭)

### 지식베이스 (KB)
- PostgreSQL FTS 전문 검색 (GIN 인덱스, websearch_to_tsquery OR 방식)
- 티켓 제목 6자+ 입력 시 실시간 KB 자동 추천 (긴 제목도 부분 매칭)
- 파일 첨부, 태그·카테고리 분류, 조회수 중복 카운트 방지 (5분 쿨다운)
- Markdown 에디터 (TipTap 기반), 빈 제목·내용 API 레벨 검증
- **문서 버전 이력**: 수정 시 이전 내용을 `kb_revisions`에 자동 저장 — 버전별 열람 가능

### 알림
- 인앱 실시간 알림 (SSE + Redis Pub/Sub) — tight loop 제거로 CPU 정상화
- 이메일 (SMTP) — Jinja2 템플릿 커스터마이즈, sandbox iframe 미리보기
- Telegram 봇, 아웃바운드 웹훅 (Slack Incoming Webhook, Teams Power Automate)
- 개인 알림 설정 (이벤트별 이메일/인앱 토글)
- **@멘션 인앱 알림**: 댓글에서 `@username` 멘션 시 대상 사용자에게 즉시 알림
- **승인 이메일 알림**: 승인 요청 생성 · 승인 · 반려 시 신청자에게 자동 이메일 발송

### GitLab 연동
- MR 머지 → 티켓 자동 해결 (`Closes #N`, `Fixes #N`)
- CI/CD 파이프라인 실패 → 티켓 자동 알림
- MR 목록 티켓 상세에서 조회, 개발 프로젝트 전달 (이슈 자동 생성·연결)
- **양방향 동기화**: GitLab에서 이슈 직접 수정(제목·설명·담당자·라벨) 시 ITSM 감사 로그 기록 + 신청자 인앱 알림
- **루프 방지**: `GITLAB_BOT_USERNAME` 설정 시 ITSM 봇 계정 변경은 웹훅 처리 스킵

### 에디터
- **TipTap 리치 텍스트 에디터**: 볼드·이탤릭·코드·표·이미지·코드블록·인용 지원
- **@멘션**: `@` 입력 시 프로젝트 멤버 자동완성 팝업 (tippy.js 기반)
- 이미지 붙여넣기·드래그앤드롭 업로드, KB 파일 첨부 삽입

### ITIL 기반 티켓 유형 & 문제 관리
- **티켓 유형 분류**: 인시던트(incident) · 서비스 요청(service_request) · 변경 요청(change) · 문제(problem) 4가지 ITIL 유형
- **문제 관리 패널**: 유형이 "problem"인 티켓에서 관련 인시던트를 `problem_of` 링크로 연결 · 통합 추적
- IT 개발자 이상 권한. 유형 변경 즉시 사이드바 패널 동적 전환

### 서비스 카탈로그 (Service Catalog)
- 관리자가 `/admin/service-catalog`에서 IT 서비스 항목 정의 (이름·아이콘·설명·카테고리·추가 입력 필드)
- 고객 포털(`/portal`)에 카드 형태로 노출 — 항목 선택 시 제목 자동 입력 + 서비스별 전용 필드 표시
- 추가 필드 유형: text / textarea / select / date (JSONB 스키마, 동적 변경 가능)

### 자동화 규칙 엔진 (Automation Rules)
- 관리자가 `/admin/automation-rules`에서 트리거 이벤트 · 조건 · 액션을 조합하여 규칙 정의
- 트리거: `ticket.created` / `ticket.updated` / `ticket.closed` 등
- 조건: AND 방식 다중 조건 (필드 + 연산자 `eq/neq/contains/startswith/in` + 값)
- 액션: 상태 변경 · 우선순위 설정 · 알림 발송 등 JSONB 배열로 유연하게 확장
- `order` 기준 우선순위 정렬, `is_active` 토글로 개별 활성/비활성 제어
- **실행 이력**: 규칙별·전체 실행 이력 조회 (`/admin/automation-rules` → 이력 버튼) — 트리거 이벤트·조건 매칭 여부·적용된 액션·오류 기록

### 대시보드 위젯 커스터마이징
- 홈 화면 ⚙️ 버튼으로 위젯 표시 여부 개인 설정 — 서버(`/dashboard/config`)에 저장
- 위젯: 상태 현황 탭 · 내 담당 티켓 · SLA 현황 · 최근 활동

### 편의 기능
- **칸반 보드**: 드래그앤드롭 상태 변경 + **전환 규칙 강제** (이동 불가 컬럼 🚫 자동 비활성화) + **기간 필터** (전체·오늘·이번 주·이번 달)
- **DORA 4대 지표**: 배포 빈도 / 리드타임 / 변경 실패율 / MTTR — 리포트 탭에서 기간별 조회
- 리포트 & 에이전트 성과 분석 (날짜 필터 정확 적용, 역방향 날짜 검증) + **리포트 CSV · Excel 내보내기**
- 빠른 답변 (Canned Response) 템플릿, 티켓 구독 (Watcher)
- 공지사항·배너 시스템 (info/warning/critical)
- **키보드 단축키**: `g+t`(티켓), `g+k`(칸반), `g+b`(KB), `g+r`(리포트), `n`(새 티켓), `?`(도움말)
- 고객 셀프서비스 포털 (비로그인 접수 · 진행 상황 추적)
- IMAP 이메일 → 티켓 자동 생성

### 관리 기능
- 사용자 관리 (역할 변경, Sudo 재인증, 자기 자신 강등 방지, 세션 강제 종료)
- SLA 정책 관리 (음수·0 입력 차단), 에스컬레이션 정책
- 서비스 유형 동적 관리 (사용 중 삭제 방지), API 키 관리 (이름 중복 방지)
- 이메일 템플릿 관리 (XSS sandbox iframe 미리보기)
- 감사 로그 (행위자 서버사이드 검색, Immutable PostgreSQL 트리거)
- GitLab 라벨 동기화, 자동 배정 규칙
- **업무 부하 현황** (`/admin/workload`): 담당자별 티켓 수·해결율·SLA 충족률·평균 평점 일람
- **알림 채널 관리**: 이메일·Telegram 활성화 상태 확인 및 전환
- **IP 접근 제한 설정 가이드**: 관리 API를 특정 CIDR 대역으로 제한하는 방법 안내
- **업무 시간 설정**: 영업일·업무 시간 기반 SLA 계산 설정
- **이메일 수신 모니터링**: IMAP 활성화 상태·서버·계정 확인 + 수동 즉시 실행 (`/admin/email-ingest`)

---

## 10. 사용자 역할

| 역할 | GitLab 권한 | 주요 기능 |
|------|------------|---------|
| **user** | Reporter / Guest | 티켓 생성·조회, KB 열람, 만족도 평가 |
| **developer** | Developer | 티켓 수정·상태 변경, 내부 메모, KB 작성, MR 조회 |
| **pl** | Developer | developer 권한 + 팀 내 티켓 병합·우선순위 조정 |
| **agent** | Maintainer | 전체 티켓 관리, 담당자 배정, 일괄 작업, 리포트, DORA 지표 |
| **admin** | Owner / Instance Admin | 사용자 관리, SLA 정책, 에스컬레이션, API 키, 웹훅, 업무부하 현황 |

- GitLab 그룹 멤버십은 **1시간마다 자동 동기화**됩니다.
- 퇴사자 계정은 다음 로그인 시 접근이 자동 차단됩니다.

### 최초 관리자 설정 순서

```
1. GitLab root 계정으로 ZENITH 첫 로그인
2. ZENITH 관리 → 사용자 관리 → root 계정에 admin 역할 부여
3. 이후 팀원들이 GitLab 로그인 → ZENITH 자동 등록
4. 역할 부여: 관리 → 사용자 관리 → 각 계정에 역할 설정
```

---

## 11. SLA 정책

기본값 (관리자가 **관리 → SLA 정책**에서 변경 가능):

| 우선순위 | 최초 응답 | 해결 목표 | 적용 예시 |
|---------|---------|---------|---------|
| 🔴 긴급 | 4시간 | 8시간 | 서버 다운, 전체 네트워크 불통 |
| 🟠 높음 | 8시간 | 24시간 | 주요 업무시스템 오류 |
| 🟡 보통 | 24시간 | 72시간 | 일부 기능 이상, 속도 저하 |
| ⚪ 낮음 | 48시간 | 168시간 | 장비 교체, 비업무 시간 처리 |

**티켓 상태 워크플로우:**

```
접수됨(open) → 승인완료(approved) → 처리중(in_progress) → 테스트중(testing) → 운영배포전(ready_for_release) → 운영반영완료(released) → 종료(closed)
     ↓               ↓                   ↓                        ↑
     └───────────────┴──→ 대기중(waiting) ┘                       │
                                                    처리완료(resolved) ──────────────────────────────────┘
종료(closed) → 재오픈(reopened) → 처리중(in_progress) → ...
```

> `테스트중` 상태: 처리 완료 전 검증 단계. SLA 타이머 계속 진행.
> `승인완료` 상태: 에이전트가 접수된 티켓을 승인. 이후 처리중 또는 반려(재접수) 가능.

### 에스컬레이션 정책

관리 → 에스컬레이션 정책에서 설정:

| 항목 | 설명 |
|------|------|
| 트리거 | `warning` (SLA 임박) / `breach` (SLA 위반) |
| 액션 | `notify` (알림) / `reassign` (담당자 변경) / `upgrade_priority` (우선순위 상향) |
| 체크 주기 | **5분** (백그라운드 자동 실행) |

---

## 12. 보안

### 인증 구조

```
GitLab OAuth 2.0 → JWT Access Token (2시간)
                 → Refresh Token (7일, Token Rotation)  ← 기존 30일에서 단축
                 → JTI 블랙리스트 (로그아웃 시 즉시 무효화)
                 → 세션 최대 5개 제한
```

### 파일 업로드 보안

- 최대 **10 MB**
- MIME 타입 + **Magic Bytes** 이중 검증
- 이미지 **EXIF 메타데이터 자동 제거** (JPEG/PNG/WebP, Pillow) — GPS·기기정보 포함 (GIF는 애니메이션 구조 특성상 제외)
- **ClamAV 바이러스 스캔** (fail-open: ClamAV 장애 시 통과)

### 입력 검증 & XSS 방어

- 티켓 상세 HTML 렌더링에 **DOMPurify** (`isomorphic-dompurify`) 적용 — 커스텀 정규식 대비 `<details ontoggle>` 등 우회 벡터 완전 차단
- 고객 포털 확인 이메일 본문에 `html.escape()` 적용 — 이름·URL 필드 XSS 방어
- KB 검색 LIKE 폴백에서 `%`, `_`, `\` **메타문자 이스케이프** — LIKE Wildcard Injection 방지
- 티켓 CSV 다운로드 시 **Formula Injection 방어** — `=`, `+`, `-`, `@` 접두 필드에 `'` 자동 삽입
- GitLab 웹훅 페이로드 외부 문자열에서 **CR/LF·제어문자 제거** — 로그 인젝션 방지
- 인앱 알림 `link` 필드는 `/` 시작 내부 상대 경로만 허용 — Open Redirect 방지

### 입력 검증 & PII 보호

- 티켓·댓글 제출 시 **시크릿 스캐닝** (9개 패턴: AWS Key, GitLab PAT, OpenAI Key 등)
- **PII 자동 마스킹**: `user` 역할 응답에서 주민등록번호·휴대폰·유선전화·여권번호·신용카드번호 자동 치환 (`agent` 이상은 원문 표시)
- PII 탐지 시 경고 로그 기록 (fail-soft — 요청 차단 없음)
- Pydantic v2 입력 검증
- SQLAlchemy ORM (SQL Injection 방지)
- **SSRF 방지**: 외부 URL 등록 시 내부망 IP 차단

### 설정 보안

- `SECRET_KEY` 기본값 (`change_me_to_random_32char_string` 등) 사용 시 **서버 시작 거부** — 공개 레포 노출 기본값 차단
- `CORS_ORIGINS=*` 를 프로덕션(`ENVIRONMENT=production`)에서 사용 시 **서버 시작 거부**
- `TOKEN_ENCRYPTION_KEY` 미설정 시 프로덕션 환경에서 시작 로그에 경고 기록
- `GITLAB_WEBHOOK_SECRET` 미설정 시 시작 로그에 경고 + 모든 웹훅 요청 거부 (fail-closed)
- Rate Limiting 비활성화 상태로 프로덕션 시작 시 `CRITICAL` 수준 로그 기록

### 감사 로그

- 모든 주요 이벤트 기록 (수행자·역할·IP·타임스탬프)
- **PostgreSQL 트리거로 수정·삭제 원천 차단** (Immutable 테이블)
- 감사 로그 검색 필터(`resource_type`, `action`)에 서버 측 **allowlist 검증** — 정보 수집 공격 방지

### 관리자 작업 보안

- **Sudo 재인증**: 서비스 유형 삭제·에스컬레이션 정책 삭제·아웃바운드 웹훅 삭제·API 키 취소 등 파괴적 작업에 `verify_sudo_token` 적용
- **XFF 신뢰 프록시 처리**: Sudo 토큰 발급·검증 시 `X-Forwarded-For`는 `TRUSTED_PROXIES` 설정 프록시 또는 사설 IP에서만 신뢰 — IP 스푸핑 우회 차단

### 네트워크 보안

| 헤더 | 값 |
|------|-----|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | 인라인 스크립트만 허용 |
| `Strict-Transport-Security` | `max-age=31536000` |
| `Permissions-Policy` | 카메라·마이크·위치 차단 |

> **참고**: HSTS 헤더는 HTTPS 응답에서만 브라우저가 처리합니다. TLS 종단이 nginx 앞단(로드밸런서 등)에 있다면 해당 계층에도 HSTS를 설정하세요.

### API 키 인증 (외부 연동)

```bash
# API 키 발급 (관리자 권한 필요)
curl -X POST http://localhost:8111/api/admin/api-keys \
  -H "Cookie: itsm_token=<admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI Bot","scopes":["tickets:read","tickets:write"]}'

# API 키로 호출
curl http://localhost:8111/api/tickets/ \
  -H "Authorization: Bearer itsm_live_<키>"
```

API 키는 `developer` 역할로 고정됩니다. 실제 리소스 접근은 `scopes` 배열로 제어되며, 관리자 전용 엔드포인트는 별도 `require_role("admin")` 또는 `verify_sudo_token()`으로 보호됩니다.

### Rate Limiting

| 엔드포인트 | 제한 |
|-----------|------|
| 티켓 생성 | 10회 / 분 |
| 파일 업로드 | 5회 / 분 |
| 고객 포털 제출 | 5회 / 분 |
| 로그인 시도 | 10회 / 분 (IP) · 5회 / 분 (계정) |

### 의존성 취약점 스캔 (GitHub Actions)

GitHub Actions CI에서 세 가지 스캔이 자동 실행됩니다.

| 도구 | 대상 | 실행 시점 |
|------|------|---------|
| **pip-audit** | Python 패키지 (requirements.txt) | push/PR/주간 cron |
| **npm audit** | Node.js 패키지 (package-lock.json) | push/PR/주간 cron |
| **Trivy** | Docker 이미지 (API·Web) | push/PR/주간 cron |

```bash
# 로컬에서 스캔 실행
pip install pip-audit
pip-audit -r itsm-api/requirements.txt

cd itsm-web && npm audit
```

**Dependabot** (`.github/dependabot.yml`) 설정으로 매주 자동 PR이 생성됩니다.

| 패키지 매니저 | 업데이트 주기 |
|-------------|------------|
| `pip` (itsm-api) | 매주 월요일 |
| `npm` (itsm-web) | 매주 월요일 |
| Docker 베이스 이미지 | 매주 월요일 |
| GitHub Actions | 매주 월요일 |

---

## 13. 모니터링 (Prometheus + Grafana)

### 접속

| 서비스 | URL | 계정 |
|--------|-----|------|
| Prometheus | `http://127.0.0.1:9090` | — |
| Grafana | `http://127.0.0.1:3001` | `admin` / `GRAFANA_PASSWORD` |

> **보안**: Prometheus와 Grafana는 `127.0.0.1`에만 바인딩되어 외부에서 직접 접근이 불가능합니다. 외부 접근이 필요하다면 SSH 터널 또는 VPN을 통해 접속하세요.

### Prometheus 설정

| 항목 | 값 | 비고 |
|------|-----|------|
| `scrape_interval` | **60s** | API 부하 최소화 (이전 15s에서 변경) |
| `evaluation_interval` | **60s** | — |
| `tsdb.retention.time` | 30d | 30일 시계열 보관 |

### 자동 프로비저닝 대시보드 (4개)

| 대시보드 | 내용 |
|---------|------|
| **ZENITH 운영 대시보드** | UP/DOWN, RPS, 에러율, P95 레이턴시, CPU·메모리·FD, 엔드포인트별 통계 |
| **ZENITH 성능 분석** | P50/P90/P95/P99 레이턴시, 엔드포인트별 처리량, 요청·응답 크기 |
| **ZENITH SLA 모니터링** | 가용성 %, Apdex 점수, 에러 버짓, P95 SLO 준수율, 장애 이력 |
| **ZENITH 메뉴별 운영 현황** | 티켓·KB·칸반·리포트·관리 메뉴 기준 비즈니스 KPI (27개 커스텀 메트릭) |

### 비즈니스 메트릭 (5분 주기 DB 집계)

```
itsm_kb_articles_total{status}        — KB 게시/초안 문서 수
itsm_users_total{role}                — 역할별 사용자 수
itsm_sla_records_total{breached}      — SLA 위반/정상 티켓 수
itsm_audit_events_total{action}       — 감사 로그 액션별 이벤트 수
itsm_notifications_total{read}        — 읽음/미읽음 알림 수
itsm_ratings_avg_score                — 만족도 평균 점수
itsm_time_entries_hours_total         — 총 기록 시간
itsm_escalation_records_total         — 에스컬레이션 이력 수
```

### 주요 PromQL 쿼리

```promql
# 초당 요청수
sum(rate(http_requests_total{job="itsm-api"}[5m]))

# 에러율 (%)
sum(rate(http_requests_total{job="itsm-api",status=~"5.."}[5m]))
/ sum(rate(http_requests_total{job="itsm-api"}[5m])) * 100

# P95 레이턴시 (ms)
histogram_quantile(0.95,
  sum(rate(http_request_duration_highr_seconds_bucket{job="itsm-api"}[5m])) by (le)
) * 1000

# 서비스 가용성 (%)
sum(rate(http_requests_total{job="itsm-api",status!~"5.."}[5m]))
/ sum(rate(http_requests_total{job="itsm-api"}[5m])) * 100
```

### Grafana 비밀번호 재설정

```bash
docker compose exec grafana grafana cli admin reset-admin-password <새비밀번호>
docker compose restart grafana
```

---

## 14. 백업 & 복구

### PostgreSQL 수동 백업

```bash
# 백업 생성 (gzip 압축)
docker compose exec postgres pg_dump -U itsm itsm \
  | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# 백업 복구
gunzip -c backup_20260309_120000.sql.gz \
  | docker compose exec -T postgres psql -U itsm -d itsm
```

### 자동 백업 활성화 (24시간 주기, 7일 보관)

```bash
# docker-compose.yml의 pg-backup 서비스 활성화
docker compose --profile backup up -d pg-backup
```

### Redis 데이터 백업

```bash
# RDB 스냅샷 강제 생성
docker compose exec redis redis-cli -a ${REDIS_PASSWORD} BGSAVE

# 파일 복사
docker cp itsm-redis-1:/data/dump.rdb ./redis_backup_$(date +%Y%m%d).rdb
```

### Docker 볼륨 전체 백업

```bash
# 볼륨 목록 확인
docker volume ls | grep itsm

# PostgreSQL 볼륨 백업
docker run --rm \
  -v itsm_itsm_pgdata:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/pgdata_$(date +%Y%m%d).tar.gz -C /data .

# 복구
docker run --rm \
  -v itsm_itsm_pgdata:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/pgdata_20260309.tar.gz -C /data
```

### 백업 자동화 크론 설정 (권장)

```bash
# crontab -e 에 추가
# 매일 새벽 2시 백업, 7일 초과분 자동 삭제
0 2 * * * cd /opt/zenith && \
  docker compose exec -T postgres pg_dump -U itsm itsm \
  | gzip > /opt/zenith/backups/db_$(date +\%Y\%m\%d).sql.gz && \
  find /opt/zenith/backups -name "db_*.sql.gz" -mtime +7 -delete
```

### 서버 이전 (무중단 마이그레이션)

`scripts/` 디렉토리의 스크립트를 순서대로 실행합니다. 모든 스크립트는 `--dry-run` 으로 사전 검증이 가능합니다.

#### 이전 절차

```bash
# ① 구 서버에서 — 점검 모드 전환 및 최종 백업
./scripts/migrate_backup.sh --output-dir /tmp/itsm-migration \
  --new-server ubuntu@NEW_SERVER_IP

# ② 신규 서버에서 — DB 복원 및 서비스 기동
./scripts/migrate_restore.sh /tmp/itsm_final_*.dump

# ③ 데이터 정합성 검증
./scripts/migrate_verify.sh \
  --old-server postgres://itsm:PASS@OLD_HOST:5432/itsm \
  --new-server postgres://itsm:PASS@NEW_HOST:5432/itsm

# ④ DNS/IP 컷오버 수행 → 신규 서버로 트래픽 전환
```

#### 롤백 절차

```bash
# 신규 서버 데이터 보존
./scripts/migrate_rollback.sh --dump-delta

# 신규 서버 트래픽 차단
./scripts/migrate_rollback.sh --block

# 구 서버에서 서비스 복원
./scripts/migrate_rollback.sh --restore-old
```

#### 롤백 기준

| 상황 | 조건 |
|------|------|
| GitLab OAuth 로그인 실패 | 5분 이상 지속 |
| API 에러율 | 5분 기준 > 10% |
| DB 데이터 유실 또는 정합성 오류 | 발생 즉시 |
| 파일 업로드·다운로드 전체 실패 | 발생 즉시 |

> 상세 이전 계획은 `docs/migration-plan.md` 참조.

---

## 15. 운영 관리

### 관리자 초기 설정

```
ZENITH 로그인 → 관리(Admin) 메뉴 진입:
  - 사용자 관리: 팀원 역할 부여, 세션 강제 종료
  - SLA 정책: 목표 시간 조정 (최소 1시간 검증)
  - 에스컬레이션 정책: 위반 시 자동 처리 규칙
  - 이메일 템플릿: 알림 메일 문구 커스터마이즈 (Jinja2)
  - 서비스 유형: 카테고리 추가·수정 (사용 중 삭제 보호)
  - 자동배정 규칙: 티켓 자동 담당자 배정
  - 티켓 템플릿: 반복 티켓용 자동 입력 템플릿
  - 빠른 답변: 자주 쓰는 답변 템플릿 등록
  - 공지사항/배너: info/warning/critical 시스템 공지
  - 아웃바운드 웹훅: Slack/Teams 연동
  - API 키: 외부 시스템 연동용 키 발급·관리
  - GitLab 라벨 동기화: 라벨 현황 확인 및 수동 복구
  - 감사 로그: 전체 이벤트 이력 조회·CSV 다운로드
  - 서비스 카탈로그: 포털에 노출할 IT 서비스 항목 정의 [NEW]
  - 자동화 규칙 엔진: 티켓 이벤트 기반 자동 액션 규칙 [NEW]
  - 업무 부하 현황: 담당자별 할당·해결율·SLA 충족률 일람
```

### 사용자 동기화

GitLab 그룹 멤버십은 1시간마다 자동 동기화됩니다.
즉시 동기화 필요 시:

```bash
docker compose restart itsm-api
```

### GitLab 레이블 복구

레이블이 누락되거나 corrupt된 경우 API가 자동 감지·복구합니다.
수동 복구가 필요한 경우:

```bash
# 헬스체크에서 label_sync 상태 확인
curl http://localhost:8111/api/health | python3 -m json.tool

# 수동 복구 (관리자 토큰 필요)
curl -X POST http://localhost:8111/api/admin/cleanup-labels \
  -H "Cookie: itsm_token=<admin_token>"
```

### 캐시 관리

```bash
# 티켓 목록 캐시만 삭제 (가장 안전)
docker exec itsm-redis-1 redis-cli -a ${REDIS_PASSWORD} \
  --scan --pattern "itsm:tickets:*" \
  | xargs -r docker exec -i itsm-redis-1 redis-cli -a ${REDIS_PASSWORD} DEL

# stats 캐시 삭제
docker exec itsm-redis-1 redis-cli -a ${REDIS_PASSWORD} \
  --scan --pattern "itsm:stats:*" \
  | xargs -r docker exec -i itsm-redis-1 redis-cli -a ${REDIS_PASSWORD} DEL

# ⚠️ 전체 Redis 캐시 삭제 (모든 세션 무효화 → 전원 재로그인 필요)
docker exec itsm-redis-1 redis-cli -a ${REDIS_PASSWORD} FLUSHDB
```

### ClamAV 바이러스 DB 업데이트

```bash
# 수동 업데이트
docker compose exec clamav freshclam

# 자동 업데이트 확인 (로그)
docker compose logs clamav --tail=20
```

### DB 유지보수

```bash
# VACUUM ANALYZE (Dead tuple 정리, 통계 갱신)
docker compose exec postgres psql -U itsm -d itsm -c "VACUUM ANALYZE;"

# Dead tuple 현황 확인
docker compose exec postgres psql -U itsm -d itsm -c "
SELECT relname, n_dead_tup, n_live_tup
FROM pg_stat_user_tables
WHERE n_dead_tup > 100
ORDER BY n_dead_tup DESC;
"

# DB 크기 확인
docker compose exec postgres psql -U itsm -d itsm -c "
SELECT pg_size_pretty(pg_database_size('itsm')) AS db_size;
"
```

### 로그 조회

```bash
# 실시간 로그
docker compose logs -f itsm-api

# 에러만 필터
docker compose logs itsm-api 2>&1 | grep -iE "error|critical|exception"

# 지난 1시간 로그
docker compose logs itsm-api --since 1h

# nginx 액세스 로그
docker compose logs nginx --since 1h | grep -v "health"
```

---

## 16. 도메인 · HTTPS 적용 (운영 서버)

### Certbot + Let's Encrypt 적용

```bash
# 1. Certbot 설치
sudo apt install -y certbot

# 2. 인증서 발급 (포트 80이 열려있어야 함)
sudo certbot certonly --standalone -d zenith.example.com

# 인증서 위치
# /etc/letsencrypt/live/zenith.example.com/fullchain.pem
# /etc/letsencrypt/live/zenith.example.com/privkey.pem
```

### nginx HTTPS 설정

`nginx/conf.d/default.conf`를 아래와 같이 수정합니다:

```nginx
server {
  listen 80;
  server_name zenith.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name zenith.example.com;

  ssl_certificate     /etc/letsencrypt/live/zenith.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/zenith.example.com/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         HIGH:!aNULL:!MD5;

  gzip on;
  gzip_types application/json text/plain text/css application/javascript;
  gzip_min_length 1024;
  gzip_comp_level 4;
  gzip_vary on;
  gzip_proxied any;

  # (나머지 보안 헤더·location 블록은 기존과 동일)
  ...
}
```

### docker-compose.yml 볼륨 마운트 추가

```yaml
nginx:
  volumes:
    - ./nginx/conf.d:/etc/nginx/conf.d:ro
    - /etc/letsencrypt:/etc/letsencrypt:ro   # 추가
```

### `.env` URL 변경

```bash
NEXT_PUBLIC_API_BASE_URL=https://zenith.example.com/api
NEXT_PUBLIC_GITLAB_URL=https://gitlab.example.com
GITLAB_OAUTH_REDIRECT_URI=https://zenith.example.com/api/auth/callback
GRAFANA_ROOT_URL=https://grafana.example.com
```

### 자동 갱신 설정

```bash
# crontab -e
0 3 * * * certbot renew --quiet && docker compose exec nginx nginx -s reload
```

### GitLab HTTPS 연동 시 내부 통신 주의

GitLab이 별도 도메인(`gitlab.example.com`)에 있고, ZENITH API가 Docker 내부에서 접근할 때:

```bash
# .env — Docker 내부 통신에는 내부 URL 사용
GITLAB_API_URL=http://gitlab:8929      # Docker 네트워크 내부
# 또는 외부 도메인 (Let's Encrypt 인증서 적용 후)
GITLAB_API_URL=https://gitlab.example.com
```

---

## 17. 개발 환경

### docker-compose.override.yml (로컬 개발 전용)

`docker compose up` 시 `docker-compose.override.yml`이 자동으로 병합됩니다.
이 파일에는 `itsm-api` · `itsm-web`의 `build:` 지시어가 정의되어 있어,
로컬에서는 소스를 직접 빌드하고, CI/CD 환경에서는 레지스트리 이미지를 사용합니다.

```yaml
# docker-compose.override.yml (자동 적용, 수정 불필요)
services:
  itsm-api:
    build: ./itsm-api
  itsm-web:
    build:
      context: ./itsm-web
      args:
        NEXT_PUBLIC_API_BASE_URL: ${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8111/api}
        NEXT_PUBLIC_GITLAB_URL: ${NEXT_PUBLIC_GITLAB_URL:-http://localhost:8929}
```

### 로컬 개발 설정

```bash
# 백엔드 의존성
cd itsm-api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 프론트엔드 의존성
cd itsm-web
npm ci
```

### 백엔드 로컬 실행

```bash
cd itsm-api

# 환경변수 로드
set -a && source ../.env && set +a

# DB·Redis만 Docker로 실행
docker compose up -d postgres redis

# 마이그레이션
alembic upgrade head

# 개발 서버 (핫리로드)
uvicorn app.main:app --reload --port 8000
```

### 프론트엔드 로컬 실행

```bash
cd itsm-web
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
# http://localhost:3000 에서 접속
```

### 테스트

```bash
# 백엔드 통합 테스트 (pytest · SQLite 인메모리 + Redis Mock)
cd itsm-api && pytest tests/ -v

# 커버리지 포함 실행
cd itsm-api && pytest tests/ --cov=app --cov-report=term-missing

# E2E 테스트 (Playwright · 로컬 실행)
# 1. 토큰 생성 및 Redis 등록
docker compose exec itsm-api python3 -c "
import json, base64, time
from app.auth import create_token, store_gitlab_token
user = {'id': 1, 'username': 'admin', 'name': 'Admin', 'email': 'admin@test.com', 'avatar_url': None, 'organization': ''}
token = create_token(user, gitlab_token='test_token', role='admin')
payload = json.loads(base64.b64decode(token.split('.')[1] + '=='))
store_gitlab_token(payload['jti'], 'test_token', payload['exp'] - int(time.time()))
print(token)
"
# 2. E2E 실행
cd itsm-web && E2E_BASE_URL=http://localhost:8111 E2E_ADMIN_TOKEN=<위 토큰> npm run test:e2e

# 프론트엔드 유닛 테스트
cd itsm-web && npm test

# 전체 린터
make lint
# ruff (Python) + eslint (TypeScript) 동시 실행
```

#### 백엔드 테스트 구성

| 파일 | 테스트 항목 |
|------|------------|
| `test_tickets.py` | 티켓 CRUD, GitLab 목(Mock), 권한 검증 |
| `test_admin.py` | 관리자 RBAC, 서비스 유형/SLA/배정 규칙 CRUD |
| `test_kb.py` | KB 문서 CRUD, 검색, LIKE 메타문자 안전성 |
| `test_ratings.py` | 만족도 평가 생성/중복 방지/열린 티켓 차단 |
| `test_auth.py` | JWT 토큰 검증, 만료/변조 처리, 세션 조회 |
| `test_notifications.py` | 알림 링크 검증 (Open Redirect 방어, CRLF 차단) |
| `test_webhooks.py` | 웹훅 문자열 안전화 (로그 인젝션 방어) |
| `test_health.py` | 헬스체크 엔드포인트 응답 |

**SQLite 호환 레이어**: PostgreSQL 전용 타입(JSONB, ARRAY, INET)과 pool 인수를 자동 변환하여 Docker 없이 로컬에서도 테스트 실행이 가능합니다.

#### E2E 테스트 구성 (Playwright · 65개)

| 파일 | 테스트 항목 |
|------|------------|
| `auth.setup.ts` | 관리자 JWT 쿠키 주입 및 storageState 저장 |
| `tickets.spec.ts` | 티켓 목록·생성 폼·필터·검색 E2E |
| `ticket-flow.spec.ts` | 티켓 전체 플로우 (생성→목록→상세→댓글·네비게이션) |
| `mobile.spec.ts` | 모바일 뷰포트 반응형 UI 검증 (Pixel 7, 412px) |
| `admin.spec.ts` | 관리자 패널·사용자관리·SLA·접근성 |
| `portal.spec.ts` | 고객 포털 티켓 제출·이메일 유효성 |
| `automation.spec.ts` | 자동화 규칙 페이지·탭·API |
| `kb.spec.ts` | 지식베이스 목록·상세·작성 페이지 |
| `notifications.spec.ts` | 알림 목록·전체읽음·SSE 스트림 |
| `approvals.spec.ts` | 승인 대기 목록·상세·E2E 플로우 |

**인증 방식**: JWT 토큰을 `create_token()` + `store_gitlab_token()` 로 생성·Redis 등록 후 `E2E_ADMIN_TOKEN` 환경변수로 주입합니다. CI (`e2e.yml`)에서는 토큰 생성과 Redis 등록이 자동으로 실행됩니다.

GitHub Actions (`.github/workflows/tests.yml`)에서 PR마다 자동 실행되며 커버리지 리포트를 생성합니다.

### 신규 마이그레이션 추가

```bash
# 1. itsm-api/app/models.py 변경
# 2. 마이그레이션 파일 자동 생성
docker compose exec itsm-api alembic revision --autogenerate -m "add_feature_x"

# 3. 생성 파일 검토 (itsm-api/alembic/versions/)
# 4. 적용
docker compose exec itsm-api alembic upgrade head
```

---

## 18. CI/CD 파이프라인

GitLab CI/CD로 린트 → 테스트 → 빌드 → 배포 단계가 자동화됩니다.

### 브랜치 전략

```
feature/xxx  →  main  →  release
```

| 브랜치 | 용도 | 파이프라인 |
|--------|------|-----------|
| `feature/*` | 기능 개발 | MR 생성 시 lint + test |
| `main` | 통합 브랜치 | lint + test + build |
| `release` | 운영 배포 기준 | lint + test + build |

### 태그 기반 환경 배포

| 태그 패턴 | 환경 | 실행 방식 | 예시 |
|-----------|------|---------|------|
| `dev-YYYYMMDD[-N]` | 개발기 | 자동 | `dev-20260313` |
| `stg-YYYYMMDD[-N]` | 테스트기 | 자동 | `stg-20260313` |
| `v*.*.*` | 운영기 | **수동 승인** | `v1.2.3` |

### 파이프라인 흐름

```
MR 생성/업데이트   ──→  lint + test
main/release push ──→  lint + test + build
dev-* 태그        ──→  build → deploy:dev → healthcheck
stg-* 태그        ──→  build → deploy:staging → healthcheck
v*.*.* 태그       ──→  build → deploy:production (수동 승인) → healthcheck
                              └→ rollback:production (수동, ROLLBACK_TAG 지정)
```

### 이미지 빌드 규칙

- 태그 이름 = `CI_COMMIT_TAG` (있으면) 또는 `CI_COMMIT_SHORT_SHA`
- `itsm-api` · `itsm-web` 두 이미지를 GitLab Container Registry에 푸시
- 빌드 레이블: `git.commit`, `git.ref`, `built.at` 자동 삽입

### GitLab CI/CD 변수 설정 (Settings → CI/CD → Variables)

| 변수 | 환경 | 설명 |
|------|------|------|
| `SSH_PRIVATE_KEY` | 공통 | 배포 서버 SSH 개인 키 |
| `DEPLOY_USER` | 공통 | 배포 서버 SSH 사용자 |
| `DEV_HOST` | dev | 개발기 서버 IP |
| `DEV_DEPLOY_PATH` | dev | 개발기 배포 경로 |
| `DEV_URL` | dev | 개발기 헬스체크 URL |
| `STG_HOST` | staging | 테스트기 서버 IP |
| `STG_DEPLOY_PATH` | staging | 테스트기 배포 경로 |
| `STG_URL` | staging | 테스트기 헬스체크 URL |
| `DEPLOY_HOST` | production | 운영기 서버 IP |
| `DEPLOY_PATH` | production | 운영기 배포 경로 |
| `PROD_URL` | production | 운영기 헬스체크 URL |

### 운영기 배포 절차

```bash
# 1. release 브랜치에서 태그 생성
git checkout release
git tag v1.2.3
git push origin v1.2.3

# 2. GitLab → CI/CD → Pipelines → deploy:production 수동 실행 (IT팀 승인)

# 3. 롤백 필요 시: rollback:production 잡 수동 실행 + ROLLBACK_TAG=v1.2.2 입력
```

---

## 19. 트러블슈팅

### GitLab 초기 기동이 느림

최초 기동 시 3~5분 소요됩니다.

```bash
docker compose logs -f gitlab | grep -E "Reconfigured|Error"
```

### OAuth 로그인 실패

```bash
# 1. Redirect URI 일치 여부 확인
grep GITLAB_OAUTH .env

# 2. GitLab OAuth 앱 설정 재확인
# GitLab → Admin Area → Applications → ZENITH → Edit

# 3. API 서버 재시작
docker compose restart itsm-api
docker compose logs itsm-api | grep -E "oauth|auth|error" | tail -20
```

### API 502 Bad Gateway

nginx가 이전 컨테이너 IP를 캐시한 경우:

```bash
docker compose exec nginx nginx -s reload
```

### label_sync 오류 (레이블 드리프트)

```bash
# 헬스체크로 상태 확인
curl http://localhost:8111/api/health

# API 로그에서 복구 여부 확인 (자동 복구됨)
docker compose logs itsm-api | grep "Label drift" | tail -5

# 수동 강제 복구
curl -X POST http://localhost:8111/api/admin/cleanup-labels \
  -H "Cookie: itsm_token=<admin_token>"
```

### Alembic 마이그레이션 실패

```bash
# 현재 상태 확인
docker compose exec itsm-api alembic current

# DB 직접 확인
docker compose exec postgres psql -U itsm -d itsm \
  -c "SELECT version_num FROM alembic_version;"

# 재시도
docker compose exec itsm-api alembic upgrade head
```

### ClamAV 연결 실패

ClamAV 미연결 시 **fail-open** (업로드 허용) 동작합니다.

```bash
docker compose ps clamav
docker compose logs clamav --tail=20
docker compose restart clamav

# ClamAV DB 업데이트 (용량 약 300 MB 다운로드)
docker compose exec clamav freshclam
```

### 메모리 부족

```bash
# 현재 메모리 사용량 확인
docker stats --no-stream

# GitLab 메모리 제한 (docker-compose.yml에 추가)
gitlab:
  mem_limit: 4g
  mem_reservation: 2g
```

### Redis 연결 오류

```bash
# Redis 컨테이너 상태
docker compose ps redis

# 비밀번호 확인
grep REDIS_PASSWORD .env

# Redis 직접 연결 테스트
docker compose exec redis redis-cli -a ${REDIS_PASSWORD} ping
```

### Grafana 비밀번호 분실

```bash
docker compose exec grafana grafana cli admin reset-admin-password <새비밀번호>
docker compose restart grafana
```

### 디스크 공간 부족

```bash
# Docker 이미지·컨테이너 정리 (미사용 항목만)
docker system prune -f

# 볼륨 크기 확인
docker system df -v

# GitLab 데이터 정리
docker compose exec gitlab gitlab-rake gitlab:cleanup:remote_uploads
```

---

## 20. 버전 이력

### 현재 버전 (2026-03-21)

- **스택**: Python 3.13 · FastAPI 0.135 · Next.js 15 · PostgreSQL 17 · Redis 7.4 · Nginx 1.27 · Node.js 22 · Celery 5
- **DB 마이그레이션**: 55단계 (0001~0055)
- **API 엔드포인트**: 160개+

### 마이그레이션 이력

| 버전 | 주요 변경 |
|------|---------|
| `0055` | `automation_logs` 테이블 — 자동화 규칙 실행 이력 (트리거·매칭 여부·액션·오류) |
| `0054` | `kb_revisions` 테이블 — KB 문서 버전 이력 자동 저장 |
| `0053` | CSV 일괄 티켓 생성 지원 스키마 (`ticket_import_rows`) |
| `0052` | SLA 일별 스냅샷 (`daily_stats_snapshots`) — 히트맵 데이터 소스 |
| `0051` | IP 허용 목록 (`ip_allowlist`) — 관리 API CIDR 제한 |
| `0050` | 서비스 카탈로그 추가 필드 스키마 확장 |
| `0049` | 업무 시간 설정 (`business_hours`) |
| `0048` | 승인 워크플로우 이메일 알림 추가 컬럼 |
| `0047` | `ticket_type_meta` · `service_catalog_items` · `user_dashboard_configs` 테이블 — 티켓 유형·서비스 카탈로그·대시보드 위젯 설정 |
| `0046` | `automation_rules` · `approval_requests` 테이블 — 자동화 규칙 엔진·티켓 승인 워크플로우 |
| `0045` | `sla_records.reopened_at` — MTTR 계산용 재오픈 시각 기록 |
| `0044` | 협력사 PL 역할 (`pl`) 추가 |
| `0043` | 테스트중(`testing`) 티켓 상태 추가 |
| `0042` | 티켓 병합 이력 감사 로그 |
| `0041` | 중복 DB 인덱스 17개 제거 (스토리지·쓰기 성능 개선) |
| `0040` | Sudo 토큰 (관리자 재인증) |
| `0039` | 사용자 아바타 URL 저장 |
| `0038` | 해결 노트 (티켓 종료·처리완료 시 상세 기록) |
| `0037` | API 키 인증 (`itsm_live_` prefix, SHA-256 해시) |
| `0036` | 감사 로그 Immutable (PostgreSQL 트리거로 수정·삭제 차단) |
| `0035` | 공지사항·배너 시스템 |
| `0034` | 개인 알림 설정 (이벤트별 이메일/인앱 토글) |
| `0033` | 세션 디바이스 추적, 최대 동시 세션 제한 |
| `0032` | 아웃바운드 웹훅 (Slack/Teams 연동) |
| `0031` | DB 인덱스 최적화 (KB FTS GIN, SLA, 알림) |
| `0030` | 이메일 템플릿 관리 UI (Jinja2) |
| `0029` | SLA 에스컬레이션 정책 |
| `0028` | 퇴사자 계정 자동 동기화 (`is_active`) |

### 최근 주요 개선

| 항목 | 내용 |
|------|------|
| **티켓 유형 분류** | ITIL 4가지 유형(incident·service_request·change·problem) 사이드바에서 설정, "문제" 선택 시 문제 관리 패널 활성화 |
| **문제 관리** | 문제 티켓에서 인시던트를 `problem_of` 링크로 연결·추적 |
| **서비스 카탈로그** | 관리자가 IT 서비스 항목 정의 → 고객 포털 카드 노출 + 서비스별 추가 필드 수집 |
| **자동화 규칙 엔진** | 티켓 이벤트 트리거·조건·액션 조합 규칙 — JSONB 배열로 유연한 확장 |
| **대시보드 위젯 커스터마이징** | 홈 화면 위젯 표시 여부를 서버에 저장 — 기기 간 설정 동기화 |
| **@멘션** | 댓글 에디터에서 `@username` 입력 시 멤버 자동완성 팝업 + 인앱 알림 발송 |
| **PII 마스킹** | 주민등록번호·전화번호·여권번호·신용카드 자동 탐지·마스킹 (user 역할만 적용) |
| **DORA 4대 지표** | 배포 빈도·리드타임·변경 실패율·MTTR 리포트 탭 추가 (Elite/High/Medium/Low 등급) |
| **티켓 병합** | 중복 티켓 병합 UI — 댓글 이전 + 소스 티켓 종료 자동 처리 |
| **GitLab 양방향 동기화** | GitLab 이슈 직접 수정 시 ITSM 감사 로그 + 신청자 인앱 알림 발행 |
| **협력사 PL 역할** | `pl` 역할 추가 — developer 권한 + 팀 내 티켓 병합·우선순위 조정 |
| **테스트중 상태** | `testing` 상태 추가 — 처리중 → 테스트중 → 처리완료 워크플로우 지원 |
| **업무 부하 현황** | 담당자별 할당·해결율·SLA 충족률·평점 일람 페이지 (`/admin/workload`) |
| **알림 채널 관리** | 이메일·Telegram 채널 상태 확인·전환 UI (`/admin/notification-channels`) |
| **SLA 위반 히트맵** | GitHub 스타일 12주 히트맵 — 날짜별 위반 건수를 5단계 색상으로 시각화 (`/reports` 전체 현황 탭) |
| **KB 문서 버전 이력** | KB 수정 시 이전 버전 자동 저장 → 상세 페이지 "버전 이력" 버튼으로 사이드바에서 버전 목록·본문 미리보기 (IT 개발자 이상) |
| **CSV 일괄 티켓 생성** | CSV 업로드로 다수 티켓을 한 번에 생성 (`POST /tickets/import/csv`, IT PL 이상) |
| **승인 이메일 알림** | 승인 요청 생성·승인·반려 시 신청자에게 자동 이메일 발송 |
| **자동화 규칙 실행 이력** | 규칙별 실행 로그 — 트리거 이벤트·조건 매칭·액션·오류 기록 (Admin, `/admin/automation-rules` → 이력 버튼) |
| **이메일 수신 모니터링** | IMAP 설정 상태 확인 + 수동 즉시 실행 버튼 (`/admin/email-ingest`) |
| **Celery 비동기 알림** | 티켓 생성·상태 변경·댓글·담당자 배정 알림을 Celery 워커로 비동기 처리 — API 응답 지연 없이 즉시 반환. Celery 미사용 환경에서는 BackgroundTasks 폴백 |
| **Slack 알림** | 티켓 생성·상태 변경 시 Slack Incoming Webhook으로 자동 알림 발송 (`SLACK_WEBHOOK_URL` 환경변수) |
| **Excel(XLSX) 내보내기** | 티켓 목록을 서식 있는 Excel 파일로 다운로드 (`GET /tickets/export/xlsx`) — 헤더 파란 배경·열 너비 자동 조정·Formula Injection 방어 |
| **업무 시간 기반 SLA** | 요일별 업무 시작·종료 시각 및 공휴일 설정 (`/admin/business-hours`) — 비업무 시간 제외 실제 업무 시간만 SLA 카운트 |
| **DB N+1 쿼리 최적화** | 티켓 목록 조회 시 `selectinload`/`joinedload` 적용 — 연관 데이터(SLA·레이블·담당자) 쿼리를 서브쿼리로 일괄 로드 |
| **라우터 모듈 분리** | `tickets.py` 단일 파일(2000+ 줄) → `crud`·`search`·`comments`·`helpers`·`links`·`bulk`·`export`·`stream`·`custom_fields`·`resolution` 10개 서브모듈 분리 |
| **통합 테스트 확대** | pytest 1562개 테스트 전량 통과 — 승인 워크플로우·자동화 규칙·Celery 폴백·XLSX 내보내기·KB FTS 폴백 등 신규 테스트 추가 |
| **브랜딩** | ITSM 포털 → **ZENITH** 리브랜딩 (아이콘·파비콘·README 포함) |
| **CPU 100% 수정** | SSE 스트림 tight loop 제거 → CPU 100% 고착 완전 해소 (0.24% 안정) |
| **성능** | `/health` GitLab 캐시 60초 → 2~8초 → 3ms |
| **성능** | 타임라인 Redis 캐시 60초 → 1.5~4초 → ~17ms |
| **병목 개선** | 티켓 목록 초기 로드: 272ms → 176ms (35% 단축) |
| **네트워크** | nginx gzip 압축 (JSON 응답 90% 압축, 53 KB → 5 KB) |
| **모니터링** | 비즈니스 KPI 27개 Prometheus 커스텀 메트릭 + Grafana 대시보드 4개 |
| **보안 (4차 감사)** | XFF 신뢰 프록시 처리 · DOMPurify 적용 · SECRET_KEY 기본값 차단 · Sudo 재인증 범위 확대 · CSV Formula Injection 방어 · 감사로그 필터 allowlist · 이메일 XSS 이스케이프 · Webhook 제어문자 제거 · KB LIKE 메타문자 이스케이프 · 인앱 알림 링크 검증 · Prometheus/Grafana localhost 전용 · CORS 와일드카드 프로덕션 차단 · Refresh Token 30일→7일 · nginx Metrics Token envsubst |
| **보안** | itsm-api 컨테이너 non-root 실행 (`appuser`) |
| **의존성 취약점 스캔** | GitHub Actions CI에서 pip-audit(Python) + npm audit(Node.js) + Trivy(Docker) 자동 스캔 — push/PR/주간 cron 실행. Dependabot으로 pip·npm·docker·Actions 의존성 주간 자동 PR 생성 |
| **통합 테스트 스위트** | pytest + FastAPI TestClient 기반 1562개 통합 테스트 전량 통과 — SQLite 인메모리 DB(StaticPool) + Redis Mock으로 외부 의존성 없이 실행 가능. RBAC 권한, CRUD 흐름, 보안 입력 검증 포함. GitHub Actions tests.yml에서 PR마다 자동 실행 |
| **CI/CD** | 3-환경 파이프라인 (개발기·테스트기·운영기) — 태그 기반 자동/수동 배포 |

### 주요 버그 수정 이력

| 항목 | 수정 내용 |
|------|---------|
| `problem_of` 링크 400 차단 | `templates.py` `allowed_types`에 `"problem_of"` 누락 → 추가, 문제 관리 정상 동작 |
| 대시보드 위젯 JSONB 저장 안됨 | `dashboard.py` PUT에 `flag_modified(config, "widgets")` 누락 → 추가 |
| 자동화 규칙 조건·액션 저장 안됨 | `automation.py` PATCH에 JSONB 필드별 `flag_modified()` 누락 → 추가 |
| 서비스 카탈로그 fields_schema 저장 안됨 | `service_catalog.py` PATCH에 `flag_modified(item, "fields_schema")` 누락 → 추가 |
| 티켓 유형·승인 패널 빈 projectId | URL `?project_id=` 없이 직접 접근 시 빈 문자열 전달 → `ticket?.project_id` 우선 사용 |
| 티켓 병합 500 에러 | `write_audit_log()` 잘못된 `extra=` kwarg → `new_value=` 수정 |
| 감사 로그 인자 순서 | `pipeline_trigger` · `merge` 이벤트의 `resource_type`/`resource_id` 순서 수정 |
| 티켓 카테고리 필터 | option value 숫자→English description 수정 / 기타 필터 not_labels 방식으로 전환 |
| KB 카테고리 불일치 | ServiceTypesContext value·label·description 3가지 모두 지원 / DB 이상 데이터 정정 |
| SLA 음수·0 입력 | `ge=1` 검증 추가 → API 422 반환 |
| 이메일 미리보기 XSS | `dangerouslySetInnerHTML` → `sandbox iframe` 교체 |
| 리포트 날짜 역방향 | `from > to` 시 HTTP 400 반환 / open·in_progress·resolved 날짜 필터 적용 |
| 감사 로그 actor 검색 | 클라이언트사이드 → 서버사이드 `ILIKE` 전환 |
| API 키 이름 중복 | 동일 이름 활성 키 중복 생성 차단 |
| 자기 자신 역할 변경 | `sub == gitlab_user_id` 일치 시 400 차단 |
| PDF 미리보기 CSP | `frame-ancestors 'none'` + `dangerouslySetInnerHTML` → Blob URL + sandbox iframe |
| 파일 미리보기 404 | 한국어 파일명 이중 URL 인코딩 → `unquote()` 추가 |
| PriorityEnum 오염 | `prio::PriorityEnum.MEDIUM` corrupt 라벨 정규화 |

---

## 21. 라이선스

이 프로젝트는 **Apache License 2.0** 하에 배포됩니다.

```
Copyright 2026 ZENITH Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

전체 라이선스 본문은 [LICENSE](LICENSE) 파일을 확인하세요.
