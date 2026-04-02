# ZENITH ITSM 설치 가이드

> 최종 업데이트: 2026-04-03 · v2.3

---

## 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [빠른 설치 — 자동 스크립트](#2-빠른-설치--자동-스크립트)
3. [수동 설치](#3-수동-설치)
4. [GitLab 초기 설정](#4-gitlab-초기-설정)
5. [초기 데이터 시드](#5-초기-데이터-시드)
6. [설치 후 필수 설정](#6-설치-후-필수-설정)
7. [선택적 기능 활성화](#7-선택적-기능-활성화)
8. [업그레이드](#8-업그레이드)
9. [문제 해결](#9-문제-해결)

---

## 1. 시스템 요구사항

### 하드웨어

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| OS | Ubuntu 22.04+ / Debian 12+ / RHEL 9+ | Ubuntu 24.04 LTS |
| CPU | 4 vCPU | 8 vCPU 이상 |
| RAM | **8 GB** | 16 GB 이상 |
| 디스크 | 50 GB SSD | 100 GB SSD 이상 |

> GitLab CE 단독으로 최소 4 GB RAM을 소비합니다. RAM 8 GB 미만 시 서비스가 불안정할 수 있습니다.

### 소프트웨어

| 항목 | 최소 버전 |
|------|---------|
| Docker Engine | 24.0+ |
| Docker Compose plugin | v2.20+ |
| Python 3 | 3.10+ (시크릿 키 생성용) |

**Docker 설치 (Ubuntu 기준):**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version   # 확인
```

### 필수 개방 포트

| 포트 | 서비스 | 외부 노출 |
|------|--------|---------|
| 8111 | ZENITH 포털 (Nginx) | ✅ 필수 |
| 8929 | GitLab 웹 UI | ✅ 필수 |
| 2224 | GitLab SSH | 선택 |
| 3001 | Grafana | 내부망 전용 권장 |
| 9090 | Prometheus | 내부망 전용 권장 |

---

## 2. 빠른 설치 — 자동 스크립트

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

스크립트가 대화형으로 아래 단계를 수행합니다:

| 단계 | 내용 |
|------|------|
| 1 | Docker · Docker Compose · Python3 요구사항 확인 |
| 2 | 서버 주소·포트·비밀번호 입력 → 시크릿 자동 생성 (openssl rand, Fernet) |
| 3 | `.env` 파일 생성 (chmod 600) |
| 4 | GitLab 단독 기동 → 초기화 완료 대기 (최대 5분) |
| 5 | GitLab OAuth Application 등록 안내 → 입력값으로 `.env` 자동 업데이트 |
| 6 | 전체 서비스 이미지 빌드 및 기동 |
| 7 | Alembic 마이그레이션 실행 (0001~0067) |
| 8 | 초기 데이터 시드 (업무시간·시스템설정·빠른답변·서비스카탈로그) |
| 9 | 헬스체크 검증 후 접속 정보 출력 |

> **무인 설치 (CI/CD):** `./scripts/setup.sh --non-interactive`
> `.env` 파일을 사전에 완성해 두면 대화 없이 실행됩니다.

### 2-3. 스크립트 실행 후 추가 필수 설정

`setup.sh`가 생성하는 `.env`에는 아래 항목이 포함되지 않습니다.
스크립트 완료 후 `.env`를 직접 열어 추가하세요:

```bash
vi /opt/zenith/.env
```

추가해야 할 항목:

```dotenv
# ── MinIO 파일 스토리지 (필수 — 미설정 시 서비스 기동 불가) ──
MINIO_ACCESS_KEY=<최소 8자>        # openssl rand -hex 8
MINIO_SECRET_KEY=<최소 16자>       # openssl rand -hex 16

# ── Celery Flower 인증 (필수 — 미설정 시 서비스 기동 불가) ──
FLOWER_USER=admin
FLOWER_PASSWORD=<강력한 비밀번호>   # openssl rand -hex 12

# ── Nginx Metrics 토큰 (필수 — 미설정 시 nginx 기동 불가) ──
METRICS_TOKEN=<랜덤 토큰>          # openssl rand -hex 24

# ── Grafana ──
GRAFANA_PASSWORD=<강력한 비밀번호>

# ── API 워커 수 (권장: CPU 코어 수 × 2 + 1) ──
WORKERS=2
```

추가 후 서비스를 재기동합니다:

```bash
docker compose up -d
```

---

## 3. 수동 설치

### 3-1. 저장소 클론

```bash
git clone <REPO_URL> /opt/zenith
cd /opt/zenith
```

### 3-2. `.env` 파일 생성

```bash
cp .env.example .env
chmod 600 .env
```

### 3-3. 시크릿 자동 생성 명령

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "REDIS_PASSWORD=$(openssl rand -hex 16)"
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "MINIO_ACCESS_KEY=$(openssl rand -hex 8)"
echo "MINIO_SECRET_KEY=$(openssl rand -hex 16)"
echo "FLOWER_PASSWORD=$(openssl rand -hex 12)"
echo "METRICS_TOKEN=$(openssl rand -hex 24)"
echo "GITLAB_WEBHOOK_SECRET=$(openssl rand -hex 24)"
echo "TOKEN_ENCRYPTION_KEY=$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
```

### 3-4. `.env` 필수 항목 설정

아래 항목을 모두 채워야 `docker compose up` 이 정상 실행됩니다.

```dotenv
# ── 서버 접속 주소 ────────────────────────────────────────────
GITLAB_EXTERNAL_URL=http://<SERVER_IP>:8929
FRONTEND_URL=http://<SERVER_IP>:8111
NEXT_PUBLIC_API_BASE_URL=http://<SERVER_IP>:8111/api
NEXT_PUBLIC_GITLAB_URL=http://<SERVER_IP>:8929
# GitLab OAuth App의 Redirect URI와 정확히 일치해야 합니다
GITLAB_OAUTH_REDIRECT_URI=http://<SERVER_IP>:8111/api/auth/callback

# ── PostgreSQL ────────────────────────────────────────────────
POSTGRES_PASSWORD=<생성한 값>

# ── Redis ─────────────────────────────────────────────────────
REDIS_PASSWORD=<생성한 값>

# ── GitLab ────────────────────────────────────────────────────
GITLAB_ROOT_PASSWORD=<생성한 값>
GITLAB_WEBHOOK_SECRET=<생성한 값>
# ↓ 4단계(GitLab 초기 설정) 후 채움
GITLAB_OAUTH_CLIENT_ID=
GITLAB_OAUTH_CLIENT_SECRET=
GITLAB_PROJECT_TOKEN=
GITLAB_PROJECT_ID=1

# ── ZENITH API ────────────────────────────────────────────────
SECRET_KEY=<생성한 값>            # 최소 32자
TOKEN_ENCRYPTION_KEY=<생성한 값>  # Fernet 키
METRICS_TOKEN=<생성한 값>         # nginx 기동 필수

# ── MinIO 파일 스토리지 ───────────────────────────────────────
MINIO_ACCESS_KEY=<생성한 값>      # 최소 8자, 기동 필수
MINIO_SECRET_KEY=<생성한 값>      # 최소 16자, 기동 필수

# ── Celery Flower ─────────────────────────────────────────────
FLOWER_USER=admin
FLOWER_PASSWORD=<생성한 값>       # 기동 필수

# ── Grafana ───────────────────────────────────────────────────
GRAFANA_PASSWORD=<생성한 값>

# ── API 워커 수 ───────────────────────────────────────────────
WORKERS=2
```

### 3-5. GitLab 먼저 기동

```bash
docker compose up -d gitlab
```

초기화 완료 확인 (3~5분 소요):

```bash
docker compose logs -f gitlab | grep -m1 "GitLab is ready"
# 또는 HTTP 응답 코드 확인
until curl -sf -o /dev/null -w "%{http_code}" http://localhost:8929/-/health | grep -q "200\|302"; do
  echo "대기 중..."; sleep 10
done && echo "GitLab 준비 완료"
```

### 3-6. GitLab OAuth 설정

[4. GitLab 초기 설정](#4-gitlab-초기-설정) 참고 후 `.env`를 업데이트합니다.

### 3-7. 전체 서비스 빌드 및 기동

```bash
docker compose build itsm-api itsm-web
docker compose up -d
```

### 3-8. DB 마이그레이션 실행

```bash
# itsm-api 기동 완료 대기 후 실행
docker compose exec itsm-api alembic upgrade head
```

### 3-9. 초기 데이터 시드

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

### 3-10. 환경변수 검증

```bash
chmod +x scripts/validate-env.sh
./scripts/validate-env.sh
```

6개 카테고리(필수 시크릿, GitLab 연동, 이메일, 모니터링, MinIO, 보안)를 자동 점검합니다.

---

## 4. GitLab 초기 설정

### 4-1. 관리자 로그인

브라우저에서 `http://<SERVER_IP>:8929` 접속:

- 사용자명: `root`
- 비밀번호: `.env`의 `GITLAB_ROOT_PASSWORD`

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

> **주의:** Redirect URI는 `.env`의 `GITLAB_OAUTH_REDIRECT_URI`와 **정확히 일치**해야 합니다.
> 형식: `http://<SERVER_IP>:8111/api/auth/callback` (끝에 슬래시 없음)

### 4-3. ITSM 전용 프로젝트 생성

GitLab에서 빈 **Private** 프로젝트를 생성합니다 (예: `itsm-tickets`).

`Project → Settings → Access Tokens → Add new token`

| 필드 | 값 |
|------|----|
| Token name | `zenith-bot` |
| Role | `Maintainer` |
| Scopes | `api` |

발급된 토큰과 프로젝트 ID를 `.env`에 입력:

```dotenv
GITLAB_PROJECT_TOKEN=<Access Token>
GITLAB_PROJECT_ID=<숫자 ID>   # Project → Settings → General 에서 확인
```

### 4-4. ITSM 서비스 재시작

```bash
docker compose restart itsm-api itsm-web
```

### 4-5. GitLab Webhook 등록 (실시간 동기화)

GitLab 이슈 변경사항을 ITSM에 실시간 반영하려면 웹훅을 등록합니다.

`GitLab Project → Settings → Webhooks → Add new webhook`

| 필드 | 값 |
|------|----|
| URL | `http://itsm-api:8000/webhooks/gitlab` |
| Secret token | `.env`의 `GITLAB_WEBHOOK_SECRET` |
| Trigger | Issues events, Comments |

> Docker 네트워크 내부 통신이므로 `itsm-api` 호스트명을 사용합니다.

---

## 5. 초기 데이터 시드

`scripts/seed.sql`은 `ON CONFLICT DO NOTHING`으로 작성되어 **중복 실행에 안전**합니다.

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

### 시드 데이터 상세

#### 업무 시간 (`business_hours_config`)

| 요일 | 시작 | 종료 | 활성 |
|------|------|------|------|
| 월~금 | 09:00 | 18:00 | ✅ |
| 토·일 | 09:00 | 18:00 | ❌ |

변경: `Admin → SLA → 업무 시간 설정`

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

변경: `Admin → SLA → SLA 정책`

#### 빠른 답변 (seed.sql — 7개 기본 템플릿)

접수 확인 / 처리 시작 / 추가 정보 요청 / 해결 완료 / 하드웨어 교체 / SW 설치 / 계정 생성 안내

관리: `Admin → 빠른 답변`

#### 서비스 카탈로그 (seed.sql — 4개 기본 항목)

PC 교체 요청 / 소프트웨어 설치 / 계정 신청 / 네트워크 연결

관리: `Admin → 서비스 카탈로그`

### Alembic 마이그레이션 요약 (v2.3 기준: 0001~0067)

| 범위 | 주요 내용 |
|------|---------|
| 0001~0020 | 티켓·댓글·첨부·SLA·KB·알림·세션 기본 스키마 |
| 0021~0040 | 자동 배정·에스컬레이션·감사 로그·OAuth·이메일 템플릿·API 키 |
| 0041~0057 | 승인 워크플로우·자동화 규칙·서비스 카탈로그·DORA·IP 허용목록·FTS |
| 0058 | `failed_notifications` — 알림 전송 실패 추적 |
| 0059 | `recurring_tickets` — Celery Beat 반복 티켓 스케줄 |
| 0060 | `change_requests` — ITIL 변경 관리 (RFC, CAB, 위험도) |
| 0061 | `web_push_subscriptions` — 브라우저 Web Push 구독 |
| 0062 | `service_catalog_items.approval_required` — 카탈로그 승인 플래그 |
| 0063 | `user_notification_rules` — 사용자별 알림 규칙 |
| 0064~0065 | 성능 인덱스 추가 및 중복 인덱스 제거 |
| 0066 | `recurring_tickets` 유니크 제약 |
| 0067 | `tickets.updated_at` 인덱스 |

---

## 6. 설치 후 필수 설정

### 6-1. 첫 번째 관리자 설정

```
1. ZENITH 접속: http://<SERVER_IP>:8111
2. GitLab root 계정으로 로그인
3. Admin → 사용자 관리 → root 계정에 admin 역할 부여
4. 이후 팀원이 GitLab 계정으로 로그인 시 ZENITH에 자동 등록
5. Admin → 사용자 관리 → 각 계정에 역할 배정
```

| 역할 | 주요 권한 |
|------|---------|
| `user` | 티켓 등록·조회, KB 열람, 만족도 평가 |
| `developer` | 티켓 수정·상태 변경, KB 작성, MR 조회 |
| `pl` | developer 권한 + 팀 내 티켓 병합·우선순위 조정 |
| `agent` | 전체 티켓 관리, 담당자 배정, 리포트, SLA 대시보드 |
| `admin` | 사용자 관리, SLA 정책, 에스컬레이션, API 키, 웹훅 등 전체 |

### 6-2. 공휴일 등록

`Admin → SLA → 업무 시간 설정`에서 해당 연도 공휴일을 입력합니다.
공휴일 기간은 SLA 시간 계산에서 제외됩니다.

### 6-3. 환경변수 최종 검증

```bash
./scripts/validate-env.sh
```

---

## 7. 선택적 기능 활성화

### 이메일 알림 (SMTP)

```dotenv
NOTIFICATION_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=helpdesk@company.com
SMTP_PASSWORD=<Gmail 앱 비밀번호>
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
TELEGRAM_BOT_TOKEN=<BotFather에서 발급>
TELEGRAM_CHAT_ID=<채팅방 ID>
```

```bash
docker compose restart itsm-api
```

### Web Push 알림 (브라우저 푸시)

VAPID 키 쌍을 생성하여 `.env`에 추가합니다:

```bash
pip install py-vapid 2>/dev/null || pip3 install py-vapid
python3 - <<'EOF'
from py_vapid import Vapid
import base64

v = Vapid()
v.generate_keys()
priv = base64.urlsafe_b64encode(v.private_key.private_bytes_raw()).rstrip(b'=').decode()
pub  = base64.urlsafe_b64encode(v.public_key.public_bytes_raw()).rstrip(b'=').decode()
print(f"VAPID_PRIVATE_KEY={priv}")
print(f"VAPID_PUBLIC_KEY={pub}")
EOF
```

```dotenv
VAPID_PRIVATE_KEY=<생성된 Private Key>
VAPID_PUBLIC_KEY=<생성된 Public Key>
VAPID_SUBJECT=mailto:admin@company.com
```

```bash
docker compose restart itsm-api itsm-web
```

### IMAP 이메일 → 티켓 자동 생성

```dotenv
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=helpdesk@company.com
IMAP_PASSWORD=<앱 비밀번호>
IMAP_FOLDER=INBOX
```

### 모니터링 (Prometheus + Grafana)

```bash
docker compose up -d prometheus grafana
```

| 서비스 | 접속 주소 | 계정 |
|--------|---------|------|
| Grafana | `http://<SERVER_IP>:8111/grafana/` | admin / `GRAFANA_PASSWORD` |
| Prometheus | `http://<SERVER_IP>:8111/prometheus/` | — |
| Celery Flower | `http://<SERVER_IP>:8111/flower/` | `FLOWER_USER` / `FLOWER_PASSWORD` |

Grafana 대시보드 7개가 자동 프로비저닝됩니다 (티켓 현황, SLA, 성능, Celery, 알림, Web Vitals, 문제 관리).

### ClamAV 비활성화 (테스트 환경)

기본 활성 상태이며, 비활성화할 경우 파일 첨부 바이러스 스캔이 생략됩니다.

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

### 8-2. 신규 환경변수 확인

버전 업에서 추가된 env 항목을 `.env`에 반영합니다:

```bash
# .env.example에는 있지만 현재 .env에 없는 항목 확인
diff <(grep -E "^[A-Z_]+=" .env.example | cut -d= -f1 | sort) \
     <(grep -E "^[A-Z_]+=" .env        | cut -d= -f1 | sort)
```

### 8-3. 이미지 재빌드 및 마이그레이션

```bash
docker compose build itsm-api itsm-web
docker compose up -d
docker compose exec itsm-api alembic upgrade head
```

> 시드 재실행은 불필요합니다 (`ON CONFLICT DO NOTHING`).

### 8-4. 서버 이전 (Blue-Green)

`docs/migration-plan.md`의 절차를 따릅니다. 핵심 순서:

```bash
# 1. 구 서버에서 DB 백업
pg_dump -U itsm itsm > backup.sql

# 2. 신 서버에서 데이터 복원 후 마이그레이션
psql -U itsm itsm < backup.sql
docker compose exec itsm-api alembic upgrade head   # 0001~0067

# 3. 서비스 기동 순서
docker compose up -d itsm-postgres itsm-redis clamav minio
docker compose up -d itsm-api
docker compose up -d itsm-celery itsm-celery-beat flower
docker compose up -d itsm-web nginx
docker compose up -d prometheus grafana              # 선택
```

---

## 9. 문제 해결

### 로그 확인

```bash
docker compose logs -f itsm-api       # API 서버
docker compose logs -f itsm-web       # 프론트엔드
docker compose logs -f gitlab          # GitLab
docker compose logs -f itsm-postgres   # PostgreSQL
docker compose logs -f itsm-celery     # Celery 워커
docker compose logs -f nginx           # Nginx
```

### 헬스체크

```bash
curl http://localhost:8111/api/health
# 정상: {"status":"ok","checks":{"db":"ok","redis":"ok","celery":"ok",...}}
```

### 자주 발생하는 오류

#### 서비스 기동 오류: `MINIO_ACCESS_KEY must be set`

`.env`에 MinIO 자격증명이 누락된 경우입니다.

```bash
echo "MINIO_ACCESS_KEY=$(openssl rand -hex 8)"  >> .env
echo "MINIO_SECRET_KEY=$(openssl rand -hex 16)" >> .env
docker compose up -d
```

#### 서비스 기동 오류: `FLOWER_PASSWORD must be set`

```bash
echo "FLOWER_USER=admin"                          >> .env
echo "FLOWER_PASSWORD=$(openssl rand -hex 12)"   >> .env
docker compose up -d
```

#### 서비스 기동 오류: `METRICS_TOKEN must be set`

```bash
echo "METRICS_TOKEN=$(openssl rand -hex 24)" >> .env
docker compose up -d
```

#### GitLab 로그인 후 리디렉션 오류

OAuth Redirect URI 불일치. GitLab Application 설정과 `.env` 값이 **정확히** 일치해야 합니다.

```
GitLab Application Redirect URI: http://<SERVER_IP>:8111/api/auth/callback
.env GITLAB_OAUTH_REDIRECT_URI:   http://<SERVER_IP>:8111/api/auth/callback
```

끝에 슬래시(`/`)가 있으면 불일치로 처리됩니다.

#### DB 마이그레이션 실패

```bash
# PostgreSQL 상태 확인
docker compose exec itsm-postgres pg_isready -U itsm

# 현재 마이그레이션 버전
docker compose exec itsm-api alembic current

# 수동 재실행
docker compose exec itsm-api alembic upgrade head
```

#### GitLab 초기화 타임아웃

최초 기동 시 5분 이상 소요될 수 있습니다.

```bash
docker compose logs -f gitlab | grep -E "Reconfigured|ready|ERROR"
```

#### Celery 태스크 처리 안됨

```bash
docker compose logs -f itsm-celery

# Redis 연결 테스트
REDIS_PW=$(grep REDIS_PASSWORD .env | cut -d= -f2)
docker compose exec itsm-redis redis-cli -a "$REDIS_PW" ping   # PONG 확인

# Flower UI에서 큐 상태 확인
open http://localhost:8111/flower/
```

#### 초기 데이터 없음 (빠른 답변·서비스 카탈로그 등)

```bash
docker compose exec -T itsm-postgres \
    psql -U itsm itsm < scripts/seed.sql
```

#### 디스크 공간 부족

```bash
docker system prune -f
docker compose exec gitlab gitlab-ctl tail   # GitLab 로그 정리
```

---

## 참고 리소스

| 리소스 | 경로 / URL |
|--------|----------|
| 환경변수 전체 목록 | `.env.example` |
| 환경변수 검증 스크립트 | `scripts/validate-env.sh` |
| 초기 데이터 시드 | `scripts/seed.sql` |
| 변경 관리 샘플 데이터 | `scripts/seed_changes.py` |
| 샘플 티켓 생성 | `scripts/seed_samples.py` |
| 운영 매뉴얼 | `docs/ops.md` |
| 서버 이전 가이드 | `docs/migration-plan.md` |
| 전체 컨테이너 구성 | `docker-compose.yml` |
| API 문서 (Swagger) | `http://<SERVER_IP>:8111/api/docs` |
| Grafana 대시보드 | `http://<SERVER_IP>:8111/grafana/` |
| Celery Flower | `http://<SERVER_IP>:8111/flower/` |
