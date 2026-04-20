# 기존 GitLab에 ZENITH ITSM 연동 설치

이미 회사/조직에서 운영 중인 GitLab CE/EE 인스턴스가 있다면, **ITSM의 번들 GitLab 컨테이너를 기동하지 않고** 외부 GitLab을 재사용할 수 있습니다. 디스크 4GB+, RAM 2GB+ 절약 및 계정·권한 통합의 장점이 있습니다.

> 최종 업데이트: 2026-04-20 · v2.6

---

## 목차

1. [요구사항 확인](#1-요구사항-확인)
2. [GitLab 측 사전 준비](#2-gitlab-측-사전-준비)
3. [ITSM 설치](#3-itsm-설치)
4. [컨테이너 → 외부 GitLab 네트워크](#4-컨테이너--외부-gitlab-네트워크)
5. [웹훅 등록](#5-웹훅-등록)
6. [검증](#6-검증)
7. [트러블슈팅](#7-트러블슈팅)

---

## 1. 요구사항 확인

외부 GitLab 인스턴스가 아래 조건을 만족해야 합니다.

| 항목 | 요구사항 |
|------|---------|
| GitLab 버전 | **CE/EE 15.0 이상** (18.x 권장) |
| API 접근 | ITSM API 컨테이너가 HTTP(S)로 GitLab `/api/v4`에 도달 가능 |
| OAuth 앱 | Admin 권한으로 OAuth Application 생성 가능 |
| 프로젝트 | ITSM 전용 GitLab 프로젝트 1개 (기존 프로젝트 활용 가능) |
| 웹훅 | GitLab → ITSM 방향 HTTP POST 도달 가능 (방화벽 확인) |

> 💡 **폐쇄망/사설 GitLab**: ITSM 서버에서 `curl https://gitlab.corp/api/v4/version -H "PRIVATE-TOKEN: xxx"`가 성공해야 합니다.

---

## 2. GitLab 측 사전 준비

### 2.1 OAuth Application 생성

1. **Admin Area** → **Applications** → **New Application**
2. 입력:
   - **Name**: `ZENITH ITSM`
   - **Redirect URI**: `https://itsm.corp/auth/callback` (운영 URL로 교체)
   - **Trusted**: ✅ (선택, 관리자용)
   - **Scopes**: ☑ `openid`  ☑ `read_user`  ☑ `api`
3. **Save application** → 발급된 **Application ID**와 **Secret** 기록

### 2.2 ITSM 전용 프로젝트 생성 (선택)

기존 프로젝트를 재사용해도 되지만, 티켓 이슈와 코드 이슈를 분리하려면 전용 프로젝트 권장.

1. **New project** → **Create blank project**
2. 이름: `zenith-itsm` (임의)
3. **Visibility**: Private 권장
4. 생성 후 **Project ID**를 기록 (프로젝트 페이지 상단 숫자)

### 2.3 프로젝트 액세스 토큰

1. **Project → Settings → Access Tokens**
2. 입력:
   - **Name**: `zenith-itsm-service`
   - **Expiration**: 1년 이상 권장 (만료 시 교체 필요)
   - **Role**: **Maintainer**
   - **Scopes**: ☑ `api`
3. **Create project access token** → `glpat-...` 토큰 기록 (재표시 불가)

### 2.4 그룹 액세스 토큰 (선택)

여러 프로젝트에서 공통 라벨을 공유하려면 그룹 레벨 토큰 발급.

1. **Group → Settings → Access Tokens** → 동일하게 Maintainer + `api` scope

---

## 3. ITSM 설치

### 3.1 소스 체크아웃

```bash
git clone <repository-url> zenith-itsm
cd zenith-itsm
```

### 3.2 원클릭 설치 런처

```bash
./scripts/install.sh --mode external
```

- 필수 secrets(`SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, DB/Redis 비밀번호 등)를 자동 생성해 `.env`에 채웁니다.
- 나머지 값은 `.env`를 열어 직접 입력:

```dotenv
# ── GitLab 연동 (외부 GitLab 모드) ──────────────────────
GITLAB_API_URL=https://gitlab.corp
GITLAB_EXTERNAL_URL=https://gitlab.corp
GITLAB_OAUTH_CLIENT_ID=<2.1에서 발급>
GITLAB_OAUTH_CLIENT_SECRET=<2.1에서 발급>
GITLAB_OAUTH_REDIRECT_URI=https://itsm.corp/auth/callback

GITLAB_PROJECT_TOKEN=glpat-<2.3에서 발급>
GITLAB_PROJECT_ID=<2.2에서 기록한 ID>

GITLAB_GROUP_ID=<선택, 2.4>
GITLAB_GROUP_TOKEN=<선택, 2.4>

# ── ITSM 공개 주소 (브라우저·GitLab 웹훅이 접근) ────────
FRONTEND_URL=https://itsm.corp
NEXT_PUBLIC_API_BASE_URL=https://itsm.corp/api
ITSM_WEBHOOK_URL=https://itsm.corp/api/webhooks/gitlab
```

### 3.3 자동 기동 / 수동 기동

대화형 런처가 docker compose를 자동 기동합니다. 수동으로 제어하려면:

```bash
docker compose -f docker-compose.yml -f docker-compose.external-gitlab.yml up -d
docker compose exec itsm-api alembic upgrade head
```

---

## 4. 컨테이너 → 외부 GitLab 네트워크

ITSM API/Celery 컨테이너가 **사내 GitLab 호스트명**을 해석할 수 있어야 합니다.

### 4.1 공개 DNS로 접근 가능한 GitLab

특별한 설정 불필요. `GITLAB_API_URL=https://gitlab.corp` 그대로 사용.

### 4.2 도커 호스트에서 실행 중인 GitLab

macOS/Windows: `host.docker.internal` 사용 가능.
Linux: `docker-compose.external-gitlab.yml`에 이미 `extra_hosts: - "host.docker.internal:host-gateway"` 포함되어 있음.

```dotenv
GITLAB_API_URL=http://host.docker.internal:8080
```

### 4.3 사설 IP만 있는 내부 GitLab

사내 DNS가 Docker 내부에서 해석되지 않으면 `extra_hosts`로 수동 매핑.
`docker-compose.external-gitlab.yml`의 `extra_hosts` 블록 주석을 참고해 `itsm-api`·`celery-worker`·`celery-beat` 세 곳에 같은 줄을 추가:

```yaml
services:
  itsm-api:
    extra_hosts:
      - "gitlab.corp:10.0.1.42"
```

---

## 5. 웹훅 등록

실시간 티켓 상태 동기화를 위해 GitLab → ITSM 웹훅을 등록합니다.

1. ITSM 프로젝트 → **Settings → Webhooks**
2. 입력:
   - **URL**: `https://itsm.corp/api/webhooks/gitlab`
   - **Secret token**: `.env`의 `GITLAB_WEBHOOK_SECRET` 값과 동일
   - **Trigger**:
     - ☑ Issues events
     - ☑ Comments
     - ☑ Merge request events
     - ☑ Pipeline events
     - ☑ Push events
3. **Enable SSL verification** ✅ (HTTPS 권장)
4. **Add webhook** → **Test → Push events**로 200 응답 확인

> 💡 ITSM이 사설망에 있고 GitLab이 외부 클라우드라면 ITSM을 외부에서 접근 가능한 도메인(또는 Cloudflare Tunnel 등)에 노출해야 웹훅이 도달합니다.

---

## 6. 검증

### 6.1 ITSM 헬스체크

```bash
curl https://itsm.corp/api/health
```

정상 응답:
```json
{
  "status": "ok",
  "checks": {"db": "ok", "redis": "ok", "gitlab": "ok", "celery_broker": "ok", "label_sync": "ok"}
}
```

`checks.gitlab` 이 `"error"`이면 네트워크 또는 토큰 문제. 로그 확인:
```bash
docker compose logs itsm-api | grep -i gitlab
```

### 6.2 OAuth 로그인

브라우저에서 `https://itsm.corp` 접속 → **GitLab으로 로그인** 클릭 → 외부 GitLab으로 리다이렉트 → 동의 후 ITSM 홈으로 복귀.

### 6.3 웹훅 동작 확인

GitLab 프로젝트에서 이슈 1개 생성 → ITSM의 `/` (홈) 목록에 즉시 반영되는지 확인.

### 6.4 Prometheus 메트릭

```bash
curl -H "Authorization: Bearer ${METRICS_TOKEN}" https://itsm.corp/metrics | grep circuit_breaker
```

`circuit_breaker_open{name="gitlab"} 0` (정상) 확인.

---

## 7. 트러블슈팅

### 7.1 `checks.gitlab = "error"`

| 증상 | 원인 | 해결 |
|------|------|------|
| `Connection refused` | DNS 해석 실패 | 4.3 참조, extra_hosts 추가 |
| `401 Unauthorized` | `GITLAB_PROJECT_TOKEN` 오류/만료 | 새 토큰 발급 후 재기동 |
| `404 Not Found` | `GITLAB_PROJECT_ID` 오류 | 프로젝트 상단 숫자 재확인 |
| `Circuit open` | 최근 5회 연속 실패 누적 | GitLab 복구 확인 후 30초 대기 |

### 7.2 OAuth 로그인 루프

- `GITLAB_OAUTH_REDIRECT_URI`와 GitLab OAuth App의 Redirect URI가 **정확히 일치**하는지 확인 (trailing slash도).
- 브라우저 쿠키 삭제 후 재시도.

### 7.3 웹훅 테스트 실패

- ITSM 엔드포인트가 HTTPS여야 GitLab에서 정상 호출됨 (HTTP는 "SSL verification" 해제 필요).
- `GITLAB_WEBHOOK_SECRET` 불일치 시 ITSM 로그에 `Invalid webhook token`.
- GitLab 방화벽/프록시가 ITSM 도메인에 접근 가능한지 확인.

### 7.4 Celery 워커 재기동 필요

`.env`의 `GITLAB_*` 변경 후:
```bash
docker compose -f docker-compose.yml -f docker-compose.external-gitlab.yml \
  up -d --force-recreate itsm-api celery-worker celery-beat
```

---

## 관련 문서

- [전체 설치 가이드](setup.md)
- [운영 매뉴얼](ops.md)
- [서버 이전 계획](migration-plan.md)
- [README](../README.md)
