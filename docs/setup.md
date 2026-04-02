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
| CPU | 4 vCPU | 8 vCPU 이상 |
| RAM | **8 GB** | 16 GB 이상 |
| 디스크 | 50 GB SSD | 100 GB SSD 이상 |
| Docker Engine | 24.0+ | 최신 |
| Docker Compose | v2.20+ (plugin) | 최신 |
| 네트워크 포트 | 8111, 8929 (필수) / 3001 (Grafana, 선택) | — |

> **GitLab CE 단독으로 최소 4 GB RAM을 소비합니다.** RAM 8 GB 미만 시 서비스 불안정이 발생할 수 있습니다.

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
git clone <REPO_URL> /opt/zenith
cd /opt/zenith
```

### 2-2. 설치 스크립트 실행

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

스크립트가 대화형으로 아래를 수행합니다.

1. Docker / Docker Compose 요구사항 확인
2. 서버 주소·포트·비밀번호 입력 → **시크릿 자동 생성** (openssl rand, Fernet)
3. `.env` 파일 자동 생성 (chmod 600)
4. GitLab 단독 기동 → 초기화 완료 대기 (최대 5분)
5. GitLab OAuth Application 등록 안내 → 입력값으로 `.env` 자동 업데이트
6. 전체 서비스 빌드·기동
7. Alembic 마이그레이션 실행 (0001~0067 전체)
8. 초기 데이터 시드 (업무시간·시스템설정·빠른답변·서비스카탈로그)
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

`.env`에서 아래 **REQUIRED** 항목을 반드시 설정합니다.

```dotenv
# ── 서버 주소 ────────────────────────────────
GITLAB_EXTERNAL_URL=http://<SERVER_IP>:8929
FRONTEND_URL=http://<SERVER_IP>:8111
NEXT_PUBLIC_API_BASE_URL=http://<SERVER_IP>:8111/api
NEXT_PUBLIC_GITLAB_URL=http://<SERVER_IP>:8929
GITLAB_OAUTH_REDIRECT_URI=http://<SERVER_IP>:8111/api/auth/callback

# ── PostgreSQL ───────────────────────────────
POSTGRES_PASSWORD=<강력한_비밀번호>          # openssl rand -hex 16

# ── Redis ────────────────────────────────────
REDIS_PASSWORD=<강력한_비밀번호>             # openssl rand -hex 16

# ── GitLab ───────────────────────────────────
GITLAB_ROOT_PASSWORD=<강력한_비밀번호>
GITLAB_WEBHOOK_SECRET=<랜덤_시크릿>          # openssl rand -hex 24
# ↓ Step 4 이후 채움
GITLAB_OAUTH_CLIENT_ID=
GITLAB_OAUTH_CLIENT_SECRET=
GITLAB_PROJECT_TOKEN=
GITLAB_PROJECT_ID=1

# ── ZENITH API ───────────────────────────────
SECRET_KEY=<최소 32자>                        # openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=<Fernet 키>              # 아래 명령으로 생성
METRICS_TOKEN=<랜덤>                          # openssl rand -hex 24

# ── Celery Flower ────────────────────────────
FLOWER_USER=admin
FLOWER_PASSWORD=<강력한_비밀번호>             # openssl rand -hex 12

# ── Grafana ──────────────────────────────────
GRAFANA_PASSWORD=<강력한_비밀번호>
```

**Fernet 키 생성:**

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Docker가 없으면: docker run --rm python:3.13-slim python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3-2. GitLab 먼저 기동

```bash
docker compose up -d gitlab
```

GitLab이 완전히 기동될 때까지 대기합니다 (3~5분).

```bash
# 초기화 완료 확인
docker compose logs -f gitlab | grep -m1 "GitLab is ready"
# 또는 HTTP 상태 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost:8929/-/health
# → 200 응답 시 준비 완료
```

### 3-3. GitLab OAuth 설정

[4. GitLab 초기 설정](#4-gitlab-초기-설정) 참고 후 `.env`에 입력

### 3-4. 전체 서비스 빌드 및 기동

```bash
docker compose build itsm-api itsm-web
docker compose up -d
```

### 3-5. DB 마이그레이션

```bash
# itsm-api 기동 확인 후
docker compose exec itsm-api alembic upgrade head
# → 0001~0067 전체 마이그레이션 적용
```

### 3-6. 초기 데이터 시드

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

---

## 4. GitLab 초기 설정

### 4-1. 관리자 로그인

브라우저에서 `http://<SERVER_IP>:8929` 접속:

- 사용자명: `root`
- 비밀번호: `.env`의 `GITLAB_ROOT_PASSWORD` 값

### 4-2. OAuth Application 등록

`Admin Area (왼쪽 상단 스패너 아이콘) → Applications → New application`

| 필드 | 값 |
|------|----|
| Name | `ZENITH` |
| Redirect URI | `http://<SERVER_IP>:8111/api/auth/callback` |
| Confidential | ✅ 체크 |
| Scopes | `api`, `read_user`, `openid`, `profile`, `email` |

저장 후 발급된 **Application ID**와 **Secret**을 `.env`에 입력:

```dotenv
GITLAB_OAUTH_CLIENT_ID=<Application ID>
GITLAB_OAUTH_CLIENT_SECRET=<Secret>
```

### 4-3. ITSM 전용 프로젝트 생성

GitLab에서 빈 Private 프로젝트를 생성합니다 (예: `itsm-tickets`).

`Project → Settings → Access Tokens → Add new token`

| 필드 | 값 |
|------|----|
| Token name | `zenith-bot` |
| Role | `Maintainer` |
| Scopes | `api` |

발급된 토큰과 프로젝트 ID를 `.env`에 입력:

```dotenv
GITLAB_PROJECT_TOKEN=<Access Token>
GITLAB_PROJECT_ID=<Project ID>   # Project → Settings → General 에서 확인
```

### 4-4. 서비스 재시작

`.env` 변경 후 ITSM 컨테이너를 재시작합니다.

```bash
docker compose restart itsm-api itsm-web
```

### 4-5. (권장) GitLab Webhook 등록

GitLab 이슈 변경사항을 ITSM에 실시간으로 반영하려면 웹훅을 등록합니다.

`GitLab Project → Settings → Webhooks → Add new webhook`

| 필드 | 값 |
|------|----|
| URL | `http://itsm-api:8000/webhooks/gitlab` |
| Secret token | `.env`의 `GITLAB_WEBHOOK_SECRET` |
| Trigger | Issues events, Comments |

---

## 5. 초기 데이터 시드

`scripts/seed.sql`은 `ON CONFLICT DO NOTHING`으로 작성되어 중복 실행에 안전합니다.

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

#### 시스템 설정 (`system_settings`)

| 키 | 기본값 |
|----|-------|
| site_name | ZENITH ITSM |
| max_attachment_mb | 20 |
| session_timeout_min | 480 |
| ticket_prefix | ITSM |
| enable_guest_portal | true |

#### SLA 정책 (Alembic 0014 자동 생성)

| 우선순위 | 첫 응답 | 해결 목표 |
|---------|--------|---------|
| Critical | 4시간 | 8시간 |
| High | 8시간 | 24시간 |
| Medium | 24시간 | 72시간 |
| Low | 48시간 | 168시간 |

> 변경: `Admin → SLA → SLA 정책`

#### 서비스 유형 (Alembic 0018 자동 생성)

| 값 | 표시명 |
|----|-------|
| hardware | 하드웨어 🖥️ |
| software | 소프트웨어 💻 |
| network | 네트워크 🌐 |
| account | 계정/권한 👤 |
| other | 기타 📋 |

#### 빠른 답변 (`quick_replies`) — seed.sql

7개 기본 템플릿: 접수 확인, 처리 시작, 추가 정보 요청, 해결 완료, 하드웨어 교체, SW 설치, 계정 생성 안내

> 관리: `Admin → 빠른 답변`

#### 서비스 카탈로그 (`service_catalog_items`) — seed.sql

4개 기본 항목: PC 교체 요청, 소프트웨어 설치, 계정 신청, 네트워크 연결

> 관리: `Admin → 서비스 카탈로그`

#### 이메일 템플릿 (Alembic 0030 자동 생성)

> 관리: `Admin → 이메일 템플릿`

### Alembic 마이그레이션 이력 요약 (v2.3 기준: 0001~0067)

| 범위 | 주요 내용 |
|------|---------|
| 0001~0020 | 티켓·댓글·첨부·SLA·KB·알림·세션 기본 스키마 |
| 0021~0040 | 자동 배정·에스컬레이션·감사 로그·OAuth·이메일 템플릿·API 키 |
| 0041~0057 | 승인·자동화 규칙·서비스 카탈로그·대시보드·IP 허용목록·FTS·DORA |
| 0058~0059 | failed_notifications, recurring_tickets |
| 0060 | change_requests (변경 관리) |
| 0061 | web_push_subscriptions |
| 0062 | service_catalog_items.approval_required |
| 0063 | user_notification_rules |
| 0064~0065 | 성능 인덱스 추가 및 중복 제거 |
| 0066 | recurring_tickets 유니크 제약 |
| 0067 | tickets.updated_at 인덱스 |

---

## 6. 설치 후 필수 설정

### 6-1. 첫 번째 관리자 계정 설정

```
1. GitLab root 계정으로 ZENITH 첫 로그인 (http://<SERVER_IP>:8111)
2. Admin → 사용자 관리 → root 계정에 admin 역할 부여
3. 이후 팀원이 GitLab 로그인 시 ZENITH 자동 등록
4. Admin → 사용자 관리 → 각 계정에 역할 설정
```

| 역할 | 주요 권한 |
|------|---------|
| `user` | 티켓 등록·조회, KB 열람, 만족도 평가 |
| `developer` | 티켓 수정·상태 변경, KB 작성, MR 조회 |
| `pl` | developer 권한 + 티켓 병합·우선순위 조정 |
| `agent` | 전체 티켓 관리, 리포트, DORA 지표, SLA 대시보드 |
| `admin` | 전체 시스템 관리 |

### 6-2. 공휴일 등록

`Admin → SLA → 업무 시간 설정`에서 해당 연도 공휴일을 입력합니다. 공휴일은 SLA 시간 계산에서 제외됩니다.

### 6-3. 환경변수 검증

```bash
chmod +x scripts/validate-env.sh
./scripts/validate-env.sh
```

필수 환경변수 누락 여부와 형식을 자동 점검합니다.

---

## 7. 선택적 기능 활성화

### 이메일 알림 (SMTP)

```dotenv
NOTIFICATION_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=<앱 비밀번호>
SMTP_FROM=ZENITH ITSM <noreply@company.com>
SMTP_TLS=true
IT_TEAM_EMAIL=it@company.com
```

```bash
docker compose restart itsm-api
```

### Telegram 알림

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<Bot Token>
TELEGRAM_CHAT_ID=<Chat ID>
```

### Web Push 알림 (브라우저 푸시)

VAPID 키 쌍을 생성하여 `.env`에 추가합니다.

```bash
# py-vapid 설치 후
pip install py-vapid
python3 -c "
from py_vapid import Vapid
import base64, json
v = Vapid()
v.generate_keys()
priv = base64.urlsafe_b64encode(v.private_key.private_bytes_raw()).rstrip(b'=').decode()
pub  = base64.urlsafe_b64encode(v.public_key.public_bytes_raw()).rstrip(b'=').decode()
print(f'VAPID_PRIVATE_KEY={priv}')
print(f'VAPID_PUBLIC_KEY={pub}')
"
```

```dotenv
VAPID_PRIVATE_KEY=<생성된 Private Key (base64url)>
VAPID_PUBLIC_KEY=<생성된 Public Key (base64url)>
VAPID_SUBJECT=mailto:admin@company.com
```

```bash
docker compose restart itsm-api itsm-web
```

### 모니터링 (Prometheus + Grafana)

`docker-compose.yml`에 prometheus, grafana 서비스가 포함되어 있습니다.

```bash
docker compose up -d prometheus grafana
```

접속:
- Grafana: `http://<SERVER_IP>:3001` (admin / `.env`의 `GRAFANA_PASSWORD`)
- Prometheus: `http://<SERVER_IP>:9090`
- nginx를 통한 접속: `http://<SERVER_IP>:8111/grafana/` · `http://<SERVER_IP>:8111/prometheus/`

Grafana 대시보드 7개가 자동 프로비저닝됩니다 (티켓 현황, SLA, 성능, Celery, 알림, Web Vitals, 문제 관리).

### Celery Flower 모니터링

Celery 큐 상태는 Flower UI에서 확인합니다.

- 접속: `http://<SERVER_IP>:8111/flower/`
- 계정: `.env`의 `FLOWER_USER` / `FLOWER_PASSWORD`

### IMAP 이메일 → 티켓 자동 생성

```dotenv
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=helpdesk@company.com
IMAP_PASSWORD=<앱 비밀번호>
IMAP_FOLDER=INBOX
IMAP_POLL_INTERVAL=60
```

### ClamAV 바이러스 스캔 비활성화

기본 활성화 상태입니다. 비활성화 시:

```dotenv
CLAMAV_ENABLED=false
```

---

## 8. 업그레이드

### 8-1. 코드 업데이트

```bash
cd /opt/zenith
git pull origin main
```

### 8-2. 이미지 재빌드 및 서비스 갱신

```bash
docker compose build itsm-api itsm-web
docker compose up -d
docker compose exec itsm-api alembic upgrade head
```

> **시드 재실행 불필요**: `seed.sql`은 `ON CONFLICT DO NOTHING`으로 작성되어 안전합니다.

### 8-3. 환경변수 신규 항목 확인

업그레이드 시 `.env.example`과 현재 `.env`를 비교하여 누락된 항목을 추가합니다.

```bash
diff <(grep -E "^[A-Z_]+=" .env.example | cut -d= -f1 | sort) \
     <(grep -E "^[A-Z_]+=" .env        | cut -d= -f1 | sort)
```

### 서버 이전

기존 서버에서 새 서버로 이전할 때는 `docs/migration-plan.md`의 Blue-Green 이전 절차를 따릅니다.

핵심 단계: pg_dump → rsync → pg_restore → alembic upgrade head (0001~0067) → 서비스 기동 → 헬스체크

```bash
# 재시작 권장 순서
docker compose up -d itsm-postgres itsm-redis clamav
docker compose up -d itsm-api             # alembic 마이그레이션 자동 실행
docker compose up -d itsm-celery itsm-celery-beat itsm-flower
docker compose up -d itsm-web nginx prometheus grafana
```

---

## 9. 문제 해결

### 서비스 로그 확인

```bash
docker compose logs -f itsm-api      # API 서버
docker compose logs -f itsm-web      # 프론트엔드
docker compose logs -f gitlab         # GitLab
docker compose logs -f itsm-postgres  # PostgreSQL
docker compose logs -f itsm-celery    # Celery 워커
```

### 헬스체크 엔드포인트

```bash
curl http://localhost:8111/api/health
# 정상 응답: {"status":"ok","checks":{"db":"ok","redis":"ok","celery":"ok",...}}
```

### 자주 발생하는 오류

#### GitLab 로그인 후 리디렉션 오류

OAuth Redirect URI 불일치. GitLab Application 설정과 `.env` 값이 **정확히** 일치해야 합니다.

```
GitLab Application Redirect URI: http://<SERVER_IP>:8111/api/auth/callback
.env GITLAB_OAUTH_REDIRECT_URI:   http://<SERVER_IP>:8111/api/auth/callback
```

#### DB 마이그레이션 실패

```bash
# PostgreSQL 상태 확인
docker compose exec itsm-postgres pg_isready -U itsm

# 수동 마이그레이션
docker compose exec itsm-api alembic upgrade head

# 현재 버전 확인
docker compose exec itsm-api alembic current

# 이력 확인
docker compose exec itsm-api alembic history --verbose
```

#### 포트 충돌

기본 포트가 사용 중인 경우 `.env`에서 변경 후 재기동합니다.

```dotenv
APP_PORT=9111     # ITSM (기본 8111)
GRAFANA_PORT=3002  # Grafana (기본 3001)
```

#### GitLab 초기화 중 타임아웃

GitLab 최초 기동은 3~5분이 소요됩니다. 아래 명령으로 진행 상황을 확인합니다.

```bash
docker compose logs -f gitlab | grep -E "Reconfigured|ready|ERROR"
```

#### 초기 데이터가 없는 경우 (빠른 답변, 서비스 카탈로그 등)

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

#### 디스크 공간 부족

```bash
# 미사용 Docker 리소스 정리
docker system prune -f

# GitLab 로그 정리
docker compose exec gitlab gitlab-ctl tail
```

#### Celery 태스크가 처리되지 않음

```bash
# Celery 워커 상태 확인
docker compose logs -f itsm-celery

# Flower UI에서 큐 상태 확인
open http://localhost:8111/flower/

# Redis 연결 테스트
docker compose exec itsm-redis redis-cli -a "$REDIS_PASSWORD" ping
```

---

## 참고 리소스

| 리소스 | 경로/URL |
|--------|---------|
| 전체 서비스 구성 | `docker-compose.yml` |
| 환경변수 목록 | `.env.example` |
| 환경변수 검증 | `scripts/validate-env.sh` |
| DB 시드 | `scripts/seed.sql` |
| 변경 관리 시드 | `scripts/seed_changes.py` |
| 샘플 데이터 생성 | `scripts/seed_samples.py` |
| 운영 매뉴얼 | `docs/ops.md` |
| 서버 이전 가이드 | `docs/migration-plan.md` |
| API 문서 (Swagger) | `http://<SERVER_IP>:8111/api/docs` |
| Grafana 대시보드 | `http://<SERVER_IP>:8111/grafana/` |
| Celery Flower | `http://<SERVER_IP>:8111/flower/` |
