# ZENITH ITSM 설치 가이드

> 최종 업데이트: 2026-04-02 · v2.3

---

## 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [빠른 설치 (자동 스크립트)](#2-빠른-설치-자동-스크립트)
3. [수동 설치](#3-수동-설치)
4. [GitLab 초기 설정](#4-gitlab-초기-설정)
5. [초기 데이터 시드](#5-초기-데이터-시드)
6. [설치 후 필수 설정](#6-설치-후-필수-설정)
7. [선택적 기능 활성화](#7-선택적-기능-활성화)
8. [업그레이드](#8-업그레이드)
9. [문제 해결](#9-문제-해결)

---

## 1. 시스템 요구사항

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| OS | Ubuntu 22.04+ / Debian 12+ / RHEL 9+ | Ubuntu 24.04 LTS |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| 디스크 | 50 GB | 100 GB SSD |
| Docker | 24.0+ | 최신 |
| Docker Compose | v2.20+ (plugin) | 최신 |
| Python | 3.13+ | 3.13 |
| 네트워크 포트 | 8111, 8929 (필수) / 3001 (Grafana, 선택) | — |

**Docker 설치 (Ubuntu 기준):**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. 빠른 설치 (자동 스크립트)

### 2-1. 저장소 클론

```bash
git clone <REPO_URL> /opt/itsm
cd /opt/itsm
```

### 2-2. 설치 스크립트 실행

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

스크립트가 대화형으로 아래를 수행합니다.

1. Docker / Python3 요구사항 확인
2. 서버 주소·포트·비밀번호 입력 → **시크릿 자동 생성** (openssl rand, Fernet)
3. `.env` 파일 자동 생성 (chmod 600)
4. GitLab 단독 기동 → 초기화 완료 대기 (최대 5분)
5. GitLab OAuth Application 등록 안내 → 입력값으로 `.env` 자동 업데이트
6. 전체 서비스 빌드·기동
7. Alembic 마이그레이션 실행
8. **초기 데이터 시드** (업무시간·시스템설정·빠른답변·서비스카탈로그)
9. 헬스체크 검증 후 접속 정보 출력

> **CI/CD / 무인 설치:** `./scripts/setup.sh --non-interactive`
> — 대화 없이 기본값으로 진행합니다. `.env`는 사전 준비 필요.

---

## 3. 수동 설치

자동 스크립트 없이 단계별로 직접 설치하는 방법입니다.

### 3-1. 환경변수 파일 생성

```bash
cp .env.example .env
chmod 600 .env
```

`.env`에서 아래 항목을 반드시 설정합니다.

```dotenv
# 서버 주소 (IP 또는 도메인)
GITLAB_EXTERNAL_URL=http://<SERVER_IP>:8929
FRONTEND_URL=http://<SERVER_IP>:8111
NEXT_PUBLIC_API_BASE_URL=http://<SERVER_IP>:8111/api
NEXT_PUBLIC_GITLAB_URL=http://<SERVER_IP>:8929
GITLAB_OAUTH_REDIRECT_URI=http://<SERVER_IP>:8111/api/auth/callback

# 비밀번호 / 시크릿 (각 항목 필히 변경)
POSTGRES_PASSWORD=<강력한_비밀번호>
REDIS_PASSWORD=<강력한_비밀번호>
GITLAB_ROOT_PASSWORD=<강력한_비밀번호>
SECRET_KEY=<32자 이상 랜덤>         # openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=<Fernet 키>    # python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# GitLab 연동 (Step 4 이후 채움)
GITLAB_OAUTH_CLIENT_ID=
GITLAB_OAUTH_CLIENT_SECRET=
GITLAB_PROJECT_TOKEN=
GITLAB_PROJECT_ID=1
```

### 3-2. GitLab 먼저 기동

```bash
docker compose up -d gitlab
```

GitLab이 완전히 기동될 때까지 대기합니다 (3~5분).

```bash
# 상태 확인
docker compose logs -f gitlab | grep "GitLab is ready"
# 또는 HTTP 응답 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost:8929/-/health
```

### 3-3. GitLab OAuth 설정

[4. GitLab 초기 설정](#4-gitlab-초기-설정) 참고

### 3-4. 전체 서비스 기동

```bash
docker compose build itsm-api itsm-web
docker compose up -d
```

### 3-5. DB 마이그레이션

```bash
# itsm-api가 기동될 때까지 잠시 대기 후
docker compose exec itsm-api alembic upgrade head
```

### 3-6. 초기 데이터 시드

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

---

## 4. GitLab 초기 설정

### 4-1. 관리자 로그인

브라우저에서 `http://<SERVER_IP>:8929` 접속 후:
- 사용자명: `root`
- 비밀번호: `.env`의 `GITLAB_ROOT_PASSWORD` 값

### 4-2. OAuth Application 등록

`Admin Area (왼쪽 상단 메뉴) → Applications → New Application`

| 필드 | 값 |
|------|----|
| Name | `ITSM Portal` |
| Redirect URI | `http://<SERVER_IP>:8111/api/auth/callback` |
| Confidential | ✅ 체크 |
| Scopes | `api`, `read_user`, `openid`, `profile`, `email` |

저장 후 발급된 **Application ID**와 **Secret**을 `.env`에 입력:

```dotenv
GITLAB_OAUTH_CLIENT_ID=<Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<Secret>
```

### 4-3. ITSM 전용 프로젝트 생성

GitLab에서 빈 프로젝트를 생성합니다 (예: `itsm-tickets`).

`Project → Settings → Access Tokens → Add new token`

| 필드 | 값 |
|------|----|
| Token name | `itsm-bot` |
| Role | `Maintainer` |
| Scopes | `api` |

발급된 토큰과 프로젝트 ID를 `.env`에 입력:

```dotenv
GITLAB_PROJECT_TOKEN=<Access Token>
GITLAB_PROJECT_ID=<Project ID>   # Project → Settings → General에서 확인
```

### 4-4. 서비스 재시작

`.env` 변경 후 ITSM API와 Web을 재시작합니다.

```bash
docker compose restart itsm-api itsm-web
```

---

## 5. 초기 데이터 시드

`scripts/seed.sql`은 마이그레이션 후 자동 실행되지만, 수동으로도 실행할 수 있습니다.

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

### 시드되는 기본 데이터

#### 업무 시간 (`business_hours_config`)

| 요일 | 시작 | 종료 | 활성 |
|------|------|------|------|
| 월~금 | 09:00 | 18:00 | ✅ |
| 토·일 | 09:00 | 18:00 | ❌ |

> 변경: `Admin → SLA → 업무 시간 설정`

#### SLA 정책 (`sla_policies`)

Alembic 마이그레이션(0014)에서 자동 생성됩니다.

| 우선순위 | 첫 응답 | 해결 목표 |
|---------|--------|---------|
| Critical | 4시간 | 8시간 |
| High | 8시간 | 24시간 |
| Medium | 24시간 | 72시간 |
| Low | 48시간 | 168시간 |

> 변경: `Admin → SLA → SLA 정책`

#### 서비스 유형 (`service_types`)

Alembic 마이그레이션(0018)에서 자동 생성됩니다.

| 값 | 표시명 | 아이콘 |
|----|-------|-------|
| hardware | 하드웨어 | 🖥️ |
| software | 소프트웨어 | 💻 |
| network | 네트워크 | 🌐 |
| account | 계정/권한 | 👤 |
| other | 기타 | 📋 |

#### 빠른 답변 (`quick_replies`)

7개의 기본 템플릿 (접수 확인, 처리 시작, 추가 정보 요청 등)

> 관리: `Admin → 빠른 답변`

#### 서비스 카탈로그 (`service_catalog_items`)

4개의 기본 항목 (PC 교체, SW 설치, 계정 신청, 네트워크 요청)

> 관리: `Admin → 서비스 카탈로그`

#### 이메일 템플릿 (`email_templates`)

Alembic 마이그레이션(0030)에서 자동 생성됩니다.

> 관리: `Admin → 이메일 템플릿`

#### 기타 자동 생성 항목 (Alembic v2.2 기준)

| 마이그레이션 | 생성 내용 |
|-------------|-----------|
| 0059 | `recurring_ticket_rules` — 반복 티켓 규칙 테이블 |
| 0060 | `change_requests`, `problems` — 변경 관리 / 문제 관리 테이블 |
| 0061 | `web_push_subscriptions` — 브라우저 Web Push 구독 테이블 |
| 0062 | `time_entries` — 시간 추적 테이블 |
| 0063 | `failed_notification_log` — 실패 알림 추적 테이블 |

---

## 6. 설치 후 필수 설정

### 6-1. 공휴일 등록

`Admin → SLA → 공휴일 관리`에서 해당 연도 공휴일을 입력합니다.

공휴일은 SLA 시간 계산에서 제외됩니다.

### 6-2. 첫 번째 사용자 역할 설정

GitLab로 처음 로그인한 사용자는 기본적으로 `user` 역할입니다.

관리자 계정으로 로그인 후 `Admin → 사용자 관리`에서 역할을 변경합니다.

- `admin` — 전체 시스템 관리
- `agent` — 티켓 처리 담당자
- `user` — 일반 사용자 (티켓 등록만 가능)

### 6-3. GitLab Webhook 설정 (실시간 동기화)

GitLab 이슈 변경사항을 ITSM에 실시간으로 반영하려면 웹훅을 등록합니다.

`GitLab Project → Settings → Webhooks → Add new webhook`

| 필드 | 값 |
|------|----|
| URL | `http://<itsm-api 내부주소>:8000/webhooks/gitlab` |
| Secret token | `.env`의 `GITLAB_WEBHOOK_SECRET` (선택) |
| Trigger | Issues events, Comments |

> Docker 네트워크 내부 통신: `http://itsm-api:8000/webhooks/gitlab`

---

## 7. 선택적 기능 활성화

### 이메일 알림 (SMTP)

`.env` 수정:

```dotenv
NOTIFICATION_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=app_password
SMTP_FROM=ITSM Portal <noreply@company.com>
SMTP_TLS=true
IT_TEAM_EMAIL=it@company.com
```

재시작: `docker compose restart itsm-api`

### 텔레그램 알림

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<Bot Token>
TELEGRAM_CHAT_ID=<Chat ID>
```

### Web Push 알림

브라우저 Web Push를 사용하려면 VAPID 키 쌍을 생성하여 `.env`에 추가합니다.

```bash
# VAPID 키 생성 (py-vapid 또는 web-push-py 사용)
python3 -c "
from py_vapid import Vapid
v = Vapid()
v.generate_keys()
print('VAPID_PRIVATE_KEY=', v.private_key.private_bytes_raw().hex())
print('VAPID_PUBLIC_KEY=',  v.public_key.public_bytes_raw().hex())
"
```

```dotenv
VAPID_PRIVATE_KEY=<생성된 Private Key>
VAPID_PUBLIC_KEY=<생성된 Public Key>
VAPID_SUBJECT=mailto:admin@company.com
```

### 모니터링 (Prometheus + Grafana)

```bash
docker compose --profile monitoring up -d
```

Grafana: `http://<SERVER_IP>:3001` (admin / `.env`의 `GRAFANA_PASSWORD`)

### ClamAV 바이러스 스캔

기본 활성화 상태 (`CLAMAV_ENABLED=true`). 비활성화하려면:

```dotenv
CLAMAV_ENABLED=false
```

---

## 8. 업그레이드

### 8-1. 코드 업데이트

```bash
cd /opt/itsm
git pull origin main
```

### 8-2. 이미지 재빌드 및 마이그레이션

```bash
docker compose build itsm-api itsm-web
docker compose up -d
docker compose exec itsm-api alembic upgrade head
```

> **시드 재실행 불필요**: `seed.sql`은 `ON CONFLICT DO NOTHING`으로 작성되어 있어 중복 실행해도 안전합니다.

### 서버 이전

기존 서버에서 새 서버로 이전할 때는 `docs/migration-plan.md`의 Blue-Green 이전 절차를 따릅니다.

핵심 단계: pg_dump → rsync → pg_restore → Alembic upgrade head (63단계) → 서비스 기동 → 헬스체크

```bash
# 주요 서비스 재시작 순서
docker compose up -d postgres redis clamav
docker compose up -d itsm-api          # Alembic 자동 실행
docker compose up -d itsm-celery itsm-celery-beat itsm-flower
docker compose up -d itsm-web nginx prometheus grafana
```

---

## 9. 문제 해결

### 서비스 로그 확인

```bash
docker compose logs -f itsm-api     # API 서버
docker compose logs -f itsm-web     # 프론트엔드
docker compose logs -f gitlab        # GitLab
docker compose logs -f itsm-postgres # PostgreSQL
```

### 헬스체크 엔드포인트

```bash
curl http://localhost:8111/api/health
# 정상 응답: {"status":"ok","checks":{"db":"ok","redis":"ok",...}}
```

### 자주 발생하는 오류

#### GitLab 로그인 후 리디렉션 오류

OAuth Redirect URI가 `.env`의 값과 GitLab Application 설정이 다를 때 발생합니다.

- GitLab Application의 Redirect URI: `http://<SERVER_IP>:8111/api/auth/callback`
- `.env`: `GITLAB_OAUTH_REDIRECT_URI=http://<SERVER_IP>:8111/api/auth/callback`

두 값이 **정확히** 일치해야 합니다.

#### DB 마이그레이션 실패

```bash
# PostgreSQL 상태 확인
docker compose exec itsm-postgres pg_isready -U itsm

# 수동 마이그레이션
docker compose exec itsm-api alembic upgrade head

# 마이그레이션 이력 확인
docker compose exec itsm-api alembic history
```

#### 포트 충돌

기본 포트가 사용 중인 경우 `.env`에서 변경 후 재기동합니다.

```dotenv
APP_PORT=9111       # ITSM (기본 8111)
GITLAB_PORT_SSH=2224  # GitLab SSH (기본 2224)
```

#### 디스크 공간 부족

```bash
# 미사용 Docker 리소스 정리
docker system prune -f

# GitLab 로그 정리
docker compose exec gitlab gitlab-ctl tail
```

#### 초기 데이터가 없는 경우

마이그레이션 후 시드가 실행되지 않은 경우 수동으로 실행합니다.

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

---

## 참고

- **DB 백업**: `scripts/backup_db.sh`
- **서버 이전**: `scripts/migrate.sh`
- **전체 서비스 목록**: `docker-compose.yml`
- **API 문서**: `http://<SERVER_IP>:8111/api/docs` (Swagger UI)
- **이슈/버그 신고**: 프로젝트 GitLab Issues
