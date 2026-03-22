# ZENITH ITSM 서버 이전 계획서

**작성일**: 2026-03-17
**버전**: v1.0
**대상 시스템**: ZENITH ITSM (Docker Compose 기반)

---

## 목차

1. [현황 요약](#1-현황-요약)
2. [이전 전략 및 목표](#2-이전-전략-및-목표)
3. [사전 준비 (D-7 ~ D-3)](#3-사전-준비-d-7--d-3)
4. [데이터 이전 절차](#4-데이터-이전-절차)
5. [GitLab 연동 재설정](#5-gitlab-연동-재설정)
6. [컷오버 — 트래픽 전환](#6-컷오버--트래픽-전환)
7. [이전 후 검증 체크리스트](#7-이전-후-검증-체크리스트)
8. [롤백 계획](#8-롤백-계획)
9. [이전 후 정리 작업 (D+3 ~ D+7)](#9-이전-후-정리-작업-d3--d7)
10. [담당자 역할 분담](#10-담당자-역할-분담)
11. [주요 위험 요소 및 대응](#11-주요-위험-요소-및-대응)
12. [점검 공지 템플릿](#12-점검-공지-템플릿)
13. [부록: 핵심 명령어 빠른 참조](#부록-핵심-명령어-빠른-참조)

---

## 1. 현황 요약

### 1.1 서비스 구성

| 컨테이너 | 이미지 | 역할 | 외부 포트 | 영속 볼륨 |
|----------|--------|------|-----------|-----------|
| nginx | nginx:1.27-alpine | 리버스 프록시 / 단일 진입점 | **8111** | — |
| itsm-web | itsm-web:latest | Next.js 15 프론트엔드 | 3000 (내부) | — |
| itsm-api | itsm-api:latest | FastAPI 백엔드 | 8000 (내부) | gitlab_data (읽기전용) |
| postgres | postgres:17 | 주 데이터베이스 | — | **itsm_pgdata** |
| redis | redis:7.4-alpine | SSE Pub/Sub · 캐시 | — | **itsm_redis** |
| clamav | clamav/clamav:1.4 | 바이러스 스캔 | — | itsm_clamav |
| prometheus | prom/prometheus | 메트릭 수집 | 9090 | itsm_prometheus |
| grafana | grafana/grafana | 대시보드 | 3001 | itsm_grafana |
| gitlab | gitlab-ce | OAuth SSO / 이슈 저장소 | 8929, 2224 | gitlab_config/logs/data |

### 1.2 이전 대상 데이터

| 데이터 | 위치 | 중요도 | 비고 |
|--------|------|--------|------|
| PostgreSQL DB | Docker 볼륨 `itsm_pgdata` | 🔴 최고 | 티켓·사용자·SLA 등 전체 |
| 업로드 파일 | itsm-api 컨테이너 `/app/uploads` | 🔴 최고 | 첨부파일 원본 |
| 환경변수 (.env) | 서버 로컬 파일 | 🔴 최고 | 시크릿 포함 — 암호화 전송 필수 |
| Redis 데이터 | Docker 볼륨 `itsm_redis` | 🟠 중간 | 캐시 성격 — 재시작 시 재구성 가능 |
| GitLab 데이터 | Docker 볼륨 `gitlab_*` 3개 | ⚠️ 별도 판단 | GitLab 공식 절차로 별도 이전 |
| Grafana 볼륨 | Docker 볼륨 `itsm_grafana` | 🟡 낮음 | 대시보드는 코드로 프로비저닝됨 |
| Prometheus TSDB | Docker 볼륨 `itsm_prometheus` | 🟡 낮음 | 이전 후 새로 수집 가능 |

> **GitLab 이전 별도 검토 필요**
> GitLab은 독립적인 대형 서비스이므로 ITSM 이전과 분리하여 GitLab 공식 백업/복원 절차를 사용합니다.
> 본 계획서는 **GitLab을 현재 서버에 유지하거나 별도 이전한다고 가정**합니다.

---

## 2. 이전 전략 및 목표

### 2.1 전략: Blue-Green 이전

```
[구 서버]                         [신규 서버]
  ↓ 트래픽 100%                     ↓ 트래픽 0%
  운영 중                           준비 / 검증 중

              ↓ 컷오버 (DNS 또는 IP 전환)

[구 서버]                         [신규 서버]
  ↓ 트래픽 0%                       ↓ 트래픽 100%
  대기 (롤백 후보, 30일 보관)        운영 중
```

| 항목 | 목표 |
|------|------|
| 다운타임 | **30분 이내** (DB 동결 → 복사 → 검증 → 전환) |
| 데이터 유실 | 0건 (최종 스냅샷 기준) |
| 롤백 기준 시간 | 컷오버 후 **1시간 이내** 이상 발견 시 즉시 복귀 |

### 2.2 컷오버 전 신규 서버에서 변경 필요한 항목

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| `GITLAB_OAUTH_REDIRECT_URI` | `http://old-server:8111/auth/callback` | `http://new-server:8111/auth/callback` |
| `FRONTEND_URL` | `http://old-server:8111` | `http://new-server:8111` |
| `ITSM_WEBHOOK_URL` | `http://old-server:8111/api/webhooks/gitlab` | `http://new-server:8111/api/webhooks/gitlab` |
| `CORS_ORIGINS` | `http://old-server` | `http://new-server` |
| GitLab OAuth 앱 Redirect URI | 구 서버 URL | 신규 서버 URL |
| GitLab 프로젝트 웹훅 URL | 구 서버 URL | 신규 서버 URL |

---

## 3. 사전 준비 (D-7 ~ D-3)

### 3.1 신규 서버 요구 사항

| 항목 | 최소 사양 | 권장 사양 |
|------|-----------|-----------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 4코어 | 8코어 이상 |
| RAM | 8 GB | 16 GB 이상 |
| 디스크 | 100 GB SSD | 500 GB SSD |
| Docker | 24.x 이상 | 최신 |
| Docker Compose | v2.x | 최신 |
| 네트워크 | 구 서버 SSH 접근 가능 | 방화벽 8111 오픈 |

### 3.2 신규 서버 초기 설정

```bash
# Docker 설치
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# Docker Compose v2 확인
docker compose version

# 방화벽 설정
sudo ufw allow 8111/tcp    # ITSM 웹 (외부 접근)
sudo ufw allow 9090/tcp    # Prometheus (내부망만 권장)
sudo ufw allow 3001/tcp    # Grafana   (내부망만 권장)
sudo ufw enable

# 작업 디렉토리 생성
mkdir -p /opt/itsm /opt/itsm-uploads
```

### 3.3 소스코드 준비

```bash
# 방법 A: Git clone
cd /opt/itsm
git clone <ITSM 저장소 URL> .

# 방법 B: 구 서버에서 rsync
rsync -avz --exclude='.git' \
  old-server:/path/to/itsm/ \
  /opt/itsm/
```

### 3.4 환경변수 파일 준비

```bash
# 구 서버 .env 복사 (민감 정보 포함 — 암호화 전송 권장)
scp old-server:/path/to/itsm/.env /opt/itsm/.env

# 신규 서버 주소로 수정 필요한 항목 확인
grep -E \
  "GITLAB_OAUTH_REDIRECT_URI|FRONTEND_URL|ITSM_WEBHOOK_URL|CORS_ORIGINS|ADMIN_ALLOWED_CIDRS" \
  /opt/itsm/.env
```

### 3.5 D-1 리허설 목적

| 확인 항목 | 목적 |
|-----------|------|
| DB 덤프 + 복원 소요 시간 | 실제 다운타임 산정 |
| rsync 전송 속도 | 업로드 파일 전송 시간 예측 |
| 서비스 전체 기동 시간 | 점검 시간 확정 |
| 데이터 정합성 검증 | 복원 절차 이상 유무 확인 |

---

## 4. 데이터 이전 절차

### 4.1 [D-1] 리허설 이전 (서비스 중단 없음)

#### PostgreSQL 사전 스냅샷

```bash
# 구 서버 — 운영 중 실행 가능 (pg_dump 무잠금)
docker compose exec -T postgres pg_dump \
  -U ${POSTGRES_USER} \
  -d ${POSTGRES_DB} \
  --format=custom \
  --compress=9 \
  > /tmp/itsm_premigration_$(date +%Y%m%d_%H%M%S).dump

ls -lh /tmp/itsm_premigration_*.dump
```

#### 업로드 파일 사전 동기화

```bash
# 구 서버에서 업로드 파일 위치 및 크기 확인
docker compose exec itsm-api du -sh /app/uploads/

# 신규 서버로 rsync
rsync -avz --progress \
  old-server:/path/to/uploads/ \
  /opt/itsm-uploads/

# 컨테이너 내부에 저장된 경우
docker cp itsm-itsm-api-1:/app/uploads /tmp/itsm-uploads
rsync -avz /tmp/itsm-uploads/ new-server:/opt/itsm-uploads/
```

#### 신규 서버 복원 테스트

```bash
# 신규 서버
cd /opt/itsm
docker compose up -d postgres redis
sleep 15

cat /tmp/itsm_premigration_*.dump | \
  docker compose exec -T postgres pg_restore \
    -U ${POSTGRES_USER} \
    -d ${POSTGRES_DB} \
    --clean --if-exists --no-owner

# 데이터 건수 검증
docker compose exec postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c "
SELECT
  (SELECT COUNT(*) FROM issues)      AS tickets,
  (SELECT COUNT(*) FROM user_roles)  AS users,
  (SELECT COUNT(*) FROM kb_articles) AS kb;
"
```

---

### 4.2 [D-Day] 실제 이전 절차

#### 타임라인

| 시각 | 작업 | 담당 |
|------|------|------|
| T-60분 | 사용자 점검 공지 발송 | 공지 담당 |
| T-30분 | 구 서버 nginx 점검 페이지 활성화 | 인프라 담당 |
| T-20분 | 최종 DB 스냅샷 생성 | DB 담당 |
| T-15분 | 스냅샷 신규 서버 전송 | DB 담당 |
| T-10분 | 신규 서버 DB 복원 완료 | DB 담당 |
| T-05분 | 신규 서버 전체 서비스 기동 및 헬스체크 | 앱 담당 |
| T+00분 | DNS / IP 전환 (컷오버) | 인프라 담당 |
| T+10분 | 핵심 기능 검증 | 검증 담당 |
| T+30분 | 완료 공지 **또는** 롤백 결정 | 이전 총괄 |

---

#### Step 1. 구 서버 트래픽 차단

```bash
# 구 서버
cat > /tmp/maintenance.conf << 'EOF'
server {
  listen 80;
  return 503 '{"error": "점검 중입니다. 잠시 후 다시 시도해주세요."}';
  add_header Content-Type application/json;
}
EOF

docker cp /tmp/maintenance.conf itsm-nginx-1:/etc/nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload
echo "✅ 구 서버 점검 모드 진입"
```

---

#### Step 2. 최종 PostgreSQL 백업

```bash
# 구 서버
DUMP_FILE="/tmp/itsm_final_$(date +%Y%m%d_%H%M%S).dump"

docker compose exec -T postgres pg_dump \
  -U ${POSTGRES_USER} \
  -d ${POSTGRES_DB} \
  --format=custom \
  --compress=9 \
  > ${DUMP_FILE}

md5sum ${DUMP_FILE} > ${DUMP_FILE}.md5
echo "✅ 최종 덤프 완료: $(ls -lh ${DUMP_FILE} | awk '{print $5}')"
```

---

#### Step 3. Redis 최종 스냅샷 (선택)

```bash
# 구 서버
docker compose exec redis redis-cli -a ${REDIS_PASSWORD} BGSAVE
sleep 5

docker cp itsm-redis-1:/data/dump.rdb /tmp/redis_final.rdb
docker cp itsm-redis-1:/data/appendonly.aof /tmp/redis_final.aof 2>/dev/null || true
```

> **참고**: Redis는 SSE 알림 스트림, 이메일 Message-ID TTL 등 캐시성 데이터를 저장합니다.
> 영속 데이터는 PostgreSQL에 있으므로 Redis 이전 실패 시 서비스 영향은 낮습니다.

---

#### Step 4. 신규 서버로 데이터 전송

```bash
# 구 서버에서 신규 서버로 전송
NEW_SERVER="user@new-server-ip"

# DB 덤프
rsync -avz --progress \
  ${DUMP_FILE} ${DUMP_FILE}.md5 \
  ${NEW_SERVER}:/tmp/

# 업로드 파일 최종 증분 동기화
rsync -avz --progress --checksum \
  /path/to/uploads/ \
  ${NEW_SERVER}:/opt/itsm-uploads/

# Redis (선택)
rsync -avz \
  /tmp/redis_final.rdb /tmp/redis_final.aof \
  ${NEW_SERVER}:/tmp/ 2>/dev/null || true

echo "✅ 데이터 전송 완료"
```

---

#### Step 5. 신규 서버 DB 복원

```bash
# 신규 서버
cd /opt/itsm && source .env

docker compose up -d postgres
sleep 15

# MD5 검증
cd /tmp && md5sum -c itsm_final_*.dump.md5 && echo "✅ MD5 일치"

# 복원
cat itsm_final_*.dump | \
  docker compose exec -T postgres pg_restore \
    -U ${POSTGRES_USER} \
    -d ${POSTGRES_DB} \
    --clean --if-exists \
    --no-owner \
    --no-acl \
    -v 2>&1 | tail -30

# 복원 검증
docker compose exec postgres psql \
  -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c "
SELECT
  (SELECT COUNT(*) FROM issues)       AS total_tickets,
  (SELECT COUNT(*) FROM notes)        AS total_comments,
  (SELECT COUNT(*) FROM sla_records)  AS sla_records,
  (SELECT COUNT(*) FROM user_roles)   AS users,
  (SELECT COUNT(*) FROM kb_articles)  AS kb_articles,
  (SELECT COUNT(*) FROM audit_logs)   AS audit_logs,
  (SELECT MAX(iid) FROM issues)       AS latest_iid;
"
```

---

#### Step 6. 업로드 파일 볼륨 마운트 설정

```yaml
# 신규 서버: docker-compose.override.yml 추가 또는 수정
services:
  itsm-api:
    volumes:
      - /opt/itsm-uploads:/app/uploads
```

---

#### Step 7. 전체 서비스 기동

```bash
# 신규 서버
cd /opt/itsm

# 기반 서비스 먼저
docker compose up -d postgres redis clamav
sleep 20

# API (Alembic 마이그레이션 자동 실행 — 0048까지)
docker compose up -d itsm-api

# API 헬스체크 대기
until docker compose exec itsm-api \
  python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" \
  2>/dev/null; do
  echo "API 기동 대기 중..."; sleep 5
done
echo "✅ API 기동 완료"

# 프론트·프록시·모니터링
docker compose up -d itsm-web nginx prometheus grafana
echo "✅ 전체 서비스 기동 완료"

docker compose ps
```

---

## 5. GitLab 연동 재설정

### 5.1 GitLab OAuth 앱 수정

**GitLab 관리자 로그인 → Admin Area → Applications → ITSM 앱 편집**

```
변경 전: Redirect URI = http://old-server:8111/auth/callback
변경 후: Redirect URI = http://new-server:8111/auth/callback
```

### 5.2 GitLab 웹훅 엔드포인트 수정

**GitLab → 이슈 저장 프로젝트 → Settings → Webhooks**

```
변경 전: URL = http://old-server:8111/api/webhooks/gitlab
변경 후: URL = http://new-server:8111/api/webhooks/gitlab
```

그룹 웹훅이 있는 경우 **Admin Area → Groups → Settings → Webhooks**에서도 동일하게 수정.

### 5.3 웹훅 연동 확인

GitLab Webhooks 설정 페이지 → **Test → Push events** 전송 후
신규 서버 API 로그에서 수신 확인:

```bash
docker compose logs itsm-api --tail=30 | grep webhook
```

---

## 6. 컷오버 — 트래픽 전환

### 방법 A: DNS 변경 (도메인 사용 시)

```
# D-3 시점에 미리 TTL을 300초로 단축
# D-Day 컷오버 시: A 레코드를 new-server-ip 로 변경
# TTL 300초 설정 시 약 5분 이내 반영
```

### 방법 B: nginx upstream 교체 (내부 로드밸런서 사용 시)

```nginx
upstream itsm_backend {
  server new-server-ip:8111;   # 신규 서버
  # server old-server-ip:8111; # 구 서버 제거
}
```

### 방법 C: 구 서버 nginx → 신규 서버 301 리다이렉트

```bash
cat > /tmp/redirect.conf << 'EOF'
server {
  listen 80;
  return 301 http://new-server:8111$request_uri;
}
EOF

docker cp /tmp/redirect.conf itsm-nginx-1:/etc/nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload
```

### 컷오버 직후 필수 실행

```bash
# 신규 서버 nginx DNS 캐시 새로고침 (재빌드 후 502 방지)
docker compose exec nginx nginx -s reload
```

---

## 7. 이전 후 검증 체크리스트

### 7.1 시스템 헬스체크

```bash
BASE="http://localhost:8111"

# API 헬스
curl -s ${BASE}/api/health | python3 -m json.tool

# 전체 컨테이너 상태
docker compose ps
```

### 7.2 핵심 기능 검증 (수동)

| # | 항목 | 경로 | 기대 결과 |
|---|------|------|-----------|
| 1 | GitLab OAuth 로그인 | `/` → 로그인 버튼 | OAuth 리다이렉트 정상 |
| 2 | 티켓 목록 | `/tickets` | 기존 티켓 목록 표시 |
| 3 | 티켓 상세 | `/tickets/1` | 댓글·첨부파일 정상 |
| 4 | 파일 업로드 | 댓글에 이미지 첨부 | 썸네일 표시, 라이트박스 동작 |
| 5 | 실시간 알림 SSE | 헤더 🔔 아이콘 | 실시간 알림 수신 |
| 6 | 칸반 보드 | `/kanban` | 9열 표시 정상 |
| 7 | 지식베이스 | `/kb` | 아티클 목록 및 검색 |
| 8 | 리포트 | `/reports` | 차트·통계 정상 |
| 9 | 관리자 메뉴 | `/admin` | 전체 탭 접근 가능 |
| 10 | SLA 배지 | 티켓 목록 | 🟢/🟡/🟠/🔴 배지 표시 |
| 11 | 글로벌 검색 | `Ctrl+K` | 검색 결과 반환 |
| 12 | GitLab 웹훅 | GitLab에서 테스트 전송 | 200 응답, API 로그 확인 |
| 13 | Prometheus | `:9090` | 메트릭 스크래핑 정상 |
| 14 | Grafana | `:3001` | 대시보드 4개 접근 |

### 7.3 데이터 정합성 검증

구 서버와 신규 서버에서 동일 쿼리를 실행하여 수치가 일치하는지 확인합니다.

```sql
SELECT
  (SELECT COUNT(*) FROM issues)       AS total_tickets,
  (SELECT COUNT(*) FROM notes)        AS total_comments,
  (SELECT COUNT(*) FROM sla_records)  AS sla_records,
  (SELECT COUNT(*) FROM user_roles)   AS users,
  (SELECT COUNT(*) FROM kb_articles)  AS kb_articles,
  (SELECT COUNT(*) FROM audit_logs)   AS audit_logs,
  (SELECT MAX(iid) FROM issues)       AS latest_ticket_iid;
```

---

## 8. 롤백 계획

### 8.1 롤백 기준

컷오버 후 아래 중 하나 발생 시 즉시 롤백:

| 조건 | 판단 기준 |
|------|-----------|
| GitLab OAuth 로그인 전체 실패 | 5분 이상 지속 |
| DB 데이터 유실 또는 정합성 오류 | 1건 이상 발견 |
| API 에러율 | 5분 기준 > 10% |
| 파일 업로드·다운로드 전체 실패 | 즉시 |
| 알 수 없는 원인의 서비스 불안정 | 총괄 판단 |

### 8.2 롤백 절차

```bash
# ── 신규 서버: 트래픽 차단 ──────────────────────
cat > /tmp/maintenance.conf << 'EOF'
server {
  listen 80;
  return 503 '{"error":"긴급 점검 중입니다."}';
  add_header Content-Type application/json;
}
EOF
docker cp /tmp/maintenance.conf itsm-nginx-1:/etc/nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload

# ── 구 서버: 정상 설정 복원 ─────────────────────
# 구 서버에서 실행
git checkout nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload

# ── DNS / IP 원복 ────────────────────────────────
# A 레코드를 old-server-ip 로 변경

# ── GitLab OAuth Redirect URI 원복 ───────────────
# GitLab Admin → Application → 구 서버 URL 으로 수정

# ── 구 서버 정상화 확인 ──────────────────────────
curl -s http://old-server:8111/api/health
```

### 8.3 롤백 후 데이터 처리

컷오버 이후 신규 서버에서 변경된 데이터(신규 생성·수정된 티켓 등)를 구 서버로 재적용해야 합니다.

```bash
# 신규 서버 — 롤백 직전 덤프
docker compose exec -T postgres pg_dump \
  -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  --format=custom \
  > /tmp/itsm_rollback_$(date +%Y%m%d_%H%M%S).dump

# 변경 데이터가 소규모라면 수동 비교 후 구 서버에 재적용
```

---

## 9. 이전 후 정리 작업 (D+3 ~ D+7)

### 9.1 구 서버 처리

```bash
# 트래픽 없음 확인 후 서비스 중단
docker compose down

# 최종 백업 수행
./scripts/backup_db.sh

# 30일 보관 후 볼륨 삭제
# docker volume rm itsm_pgdata itsm_redis itsm_clamav
```

### 9.2 신규 서버 정기 백업 설정

```bash
# pg-backup 프로파일 활성화
docker compose --profile backup up -d pg-backup

# 또는 cron으로 직접 스케줄 (매일 02:00)
echo "0 2 * * * root cd /opt/itsm && \
  ./scripts/backup_db.sh >> /var/log/itsm-backup.log 2>&1" \
  | sudo tee -a /etc/crontab
```

### 9.3 모니터링 정상화 확인

```bash
# Prometheus target 상태 확인
curl -s http://localhost:9090/api/v1/targets \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in d['data']['activeTargets']:
    print(t['labels'].get('job','?'), '→', t['health'])
"

# Grafana 대시보드 접근 확인
curl -s -u admin:${GRAFANA_PASSWORD} \
  http://localhost:3001/api/dashboards/home | python3 -m json.tool | head -10
```

---

## 10. 담당자 역할 분담

| 역할 | 주요 책임 | 비고 |
|------|-----------|------|
| **이전 총괄** | 일정 조율, 의사결정, 롤백 결정 권한 | Go/No-Go 최종 판단 |
| **인프라 담당** | 신규 서버 준비, Docker 설치, 네트워크·방화벽 설정, DNS 전환 | |
| **DB 담당** | pg_dump/restore 실행, MD5 검증, 데이터 정합성 확인 | |
| **애플리케이션 담당** | .env 수정, Docker 빌드, 서비스 기동, 헬스체크 | |
| **GitLab 관리자** | OAuth 앱 Redirect URI 수정, 웹훅 엔드포인트 수정 | GitLab 접근 권한 필요 |
| **검증 담당** | 핵심 기능 수동 검증, 체크리스트 확인, 결과 보고 | |
| **공지 담당** | 점검 사전 공지, 이전 완료 안내 | |

---

## 11. 주요 위험 요소 및 대응

| 위험 | 가능성 | 영향 | 대응 방안 |
|------|--------|------|-----------|
| DB 복원 실패 | 낮음 | 🔴 높음 | D-1 리허설로 사전 검증, 원본 덤프 보관 |
| GitLab OAuth 실패 | 중간 | 🔴 높음 | GitLab 관리자 동반 컷오버, 즉시 롤백 |
| 업로드 파일 누락 | 중간 | 🟠 중간 | rsync `--checksum` 으로 정합성 보장 |
| Redis 데이터 소실 | 낮음 | 🟡 낮음 | 재시작 시 캐시 자동 재구성 |
| 다운타임 초과 | 중간 | 🟠 중간 | D-1 리허설로 정확한 소요 시간 측정 |
| nginx DNS 캐시 502 | 높음 | 🟡 낮음 | 컷오버 직후 `nginx -s reload` 필수 실행 |
| Alembic 마이그레이션 실패 | 낮음 | 🔴 높음 | DB 버전 호환성 사전 확인, 수동 적용 준비 |
| .env 환경변수 미수정 | 중간 | 🔴 높음 | 컷오버 전 변경 항목 체크리스트 재확인 |

---

## 12. 점검 공지 템플릿

```
[ZENITH ITSM 서버 이전 안내]

안녕하세요, IT 팀입니다.

ZENITH ITSM 시스템이 서버 이전 작업으로 인해
아래 일정 동안 일시적으로 이용이 제한됩니다.

📅 점검 일정: YYYY-MM-DD (요일) HH:MM ~ HH:MM (약 30분)
🔧 작업 내용: 서버 이전 및 인프라 환경 개선
🌐 이전 후 접속 URL: http://new-server:8111

점검 완료 후 별도 공지를 드리겠습니다.
긴급 문의: IT 팀 이메일 또는 Slack #it-support
```

---

## 부록: 핵심 명령어 빠른 참조

### 백업

```bash
# 구 서버 — 최종 DB 덤프
docker compose exec -T postgres pg_dump \
  -U $POSTGRES_USER -d $POSTGRES_DB \
  --format=custom --compress=9 \
  > /tmp/itsm_final.dump

# MD5 체크섬 생성
md5sum /tmp/itsm_final.dump > /tmp/itsm_final.dump.md5
```

### 복원

```bash
# 신규 서버 — DB 복원
cat /tmp/itsm_final.dump | \
  docker compose exec -T postgres pg_restore \
    -U $POSTGRES_USER -d $POSTGRES_DB \
    --clean --if-exists --no-owner
```

### 서비스 제어

```bash
# 전체 기동
docker compose up -d

# 전체 중단
docker compose down

# nginx DNS 캐시 새로고침 (컷오버 직후 필수)
docker compose exec nginx nginx -s reload

# 로그 실시간 확인
docker compose logs -f itsm-api --tail=50
```

### 데이터 정합성 빠른 확인

```bash
docker compose exec postgres psql \
  -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT COUNT(*) AS tickets FROM issues;
      SELECT COUNT(*) AS users FROM user_roles;"
```

### 롤백 — 구 서버 즉시 복원

```bash
# 구 서버에서 실행
git checkout nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload
curl -s http://old-server:8111/api/health
```
