# ZENITH ITSM 운영 매뉴얼

> 최종 업데이트: 2026-04-07 · v2.4

---

## 목차

1. [운영 환경 개요](#1-운영-환경-개요)
2. [일상 운영 체크리스트](#2-일상-운영-체크리스트)
3. [서비스 재시작 절차](#3-서비스-재시작-절차)
4. [로그 분석 가이드](#4-로그-분석-가이드)
5. [장애 대응 플레이북](#5-장애-대응-플레이북)
6. [DB 백업 및 복구](#6-db-백업-및-복구)
7. [성능 튜닝 체크리스트](#7-성능-튜닝-체크리스트)
8. [보안 운영](#8-보안-운영)
9. [모니터링 대시보드](#9-모니터링-대시보드)
10. [정기 유지보수](#10-정기-유지보수)

---

## 1. 운영 환경 개요

### 서비스 컴포넌트

| 서비스 | 컨테이너명 | 포트 | 역할 |
|--------|------------|------|------|
| ITSM Frontend | `itsm-web` | 3000 (내부) | Next.js 15 웹 UI |
| ITSM API | `itsm-api` | 8000 (내부) | FastAPI 백엔드 |
| Celery Worker | `celery-worker` | — | 비동기 태스크 (알림, 바이러스 스캔 등) |
| Celery Beat | `celery-beat` | — | 스케줄 태스크 (자동 백업, SLA 체크 등) |
| Celery Flower | `flower` | 127.0.0.1:5555 | Celery 큐 모니터링 UI |
| PostgreSQL | `postgres` | 5432 (내부) | 주 데이터베이스 (Alembic 72단계) |
| Redis | `redis` | 6379 (내부) | 캐시 / 세션 / Celery 큐 / JWT 블랙리스트 |
| MinIO | `minio` | 127.0.0.1:9000/9001 | S3 오브젝트 스토리지 (파일 첨부) |
| GitLab | `gitlab` | 8929, 2224 | 이슈 트래커 / OAuth |
| Nginx | `nginx` | **8111**, 127.0.0.1:1455 | 리버스 프록시 / OAuth 루프백 |
| ClamAV | `clamav` | 3310 (내부) | 바이러스 스캔 |
| Prometheus | `prometheus` | 127.0.0.1:9090 | 메트릭 수집 |
| Grafana | `grafana` | 127.0.0.1:3001 | 대시보드 |

**선택적 프로필**: Ollama (AI, `--profile ollama`), pg-backup (`--profile backup`), OTel Collector (`--profile tracing`)

### 헬스체크 엔드포인트

```bash
# API 전체 상태
curl http://localhost:8111/api/health

# 정상 응답 예시
{
  "status": "ok",
  "checks": {
    "db": "ok",
    "redis": "ok",
    "gitlab": "ok",
    "clamav": "ok"
  }
}
```

---

## 2. 일상 운영 체크리스트

### 매일 아침 (09:00)

```bash
# 1. 서비스 상태 확인
docker compose ps

# 2. 헬스체크
curl -s http://localhost:8111/api/health | python3 -m json.tool

# 3. 오류 로그 확인 (최근 24시간)
docker compose logs --since 24h itsm-api | grep -E "ERROR|CRITICAL"

# 4. Celery 큐 상태
docker compose exec itsm-celery celery -A app.celery_app inspect active

# 5. 실패 알림 건수 확인 (Admin → 실패 알림 추적)
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT COUNT(*) AS unretried FROM failed_notification_log WHERE retried_at IS NULL;
"

# 6. 디스크 사용량
df -h
docker system df
```

### 매주 월요일

```bash
# 백업 파일 확인 (자동 백업: 매일 02:00)
ls -lh /opt/itsm/backups/

# DB 크기 확인
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT pg_size_pretty(pg_database_size('itsm')) AS db_size;
"

# 오래된 감사 로그 확인 (90일 이상)
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT COUNT(*) FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
"
```

---

## 3. 서비스 재시작 절차

### 전체 재시작

```bash
cd /opt/itsm
docker compose down
docker compose up -d
# 헬스체크가 OK가 될 때까지 대기
watch -n 5 'curl -s http://localhost:8111/api/health'
```

### 개별 서비스 재시작 (무중단)

```bash
# API만 재시작
docker compose restart itsm-api

# 웹 UI만 재시작
docker compose restart itsm-web

# Celery worker 재시작 (큐 작업 완료 후)
docker compose exec itsm-celery celery -A app.celery_app control shutdown
docker compose restart itsm-celery
```

### 업데이트 배포

```bash
cd /opt/itsm
git pull origin main

# 이미지 재빌드
docker compose build itsm-api itsm-web

# 무중단 롤링 재시작
docker compose up -d --no-deps itsm-api
docker compose up -d --no-deps itsm-web

# DB 마이그레이션 (있을 경우)
docker compose exec itsm-api alembic upgrade head
```

---

## 4. 로그 분석 가이드

### 실시간 로그 스트리밍

```bash
# API 오류만 필터링
docker compose logs -f itsm-api | grep -E "ERROR|WARNING|CRITICAL"

# 특정 사용자 활동 추적
docker compose logs -f itsm-api | grep "username=<USERNAME>"

# DB 슬로우 쿼리 (1초 이상)
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND (now() - query_start) > interval '1 second';
"
```

### 주요 로그 패턴

| 패턴 | 의미 | 조치 |
|------|------|------|
| `ERROR:app.tasks` | Celery 태스크 실패 | `Admin → 실패 알림 추적` 확인 |
| `WARNING:app.sla` | SLA 위반 임박 | 해당 티켓 우선 처리 |
| `ERROR:app.gitlab_client` | GitLab 연동 실패 | GitLab 상태 및 토큰 확인 |
| `WARNING:app.notifications` | 알림 발송 실패 | SMTP/텔레그램 설정 확인 |
| `ERROR:uvicorn.error` | API 서버 오류 | 스택 트레이스 분석 |
| `ERROR:app.recurring` | 반복 티켓 생성 실패 | `Admin → 반복 티켓` 규칙 확인 |
| `ERROR:app.change` | 변경 관리 처리 실패 | 변경 요청 상태 확인 |

### 감사 로그 조회

```bash
# 관리자 권한 변경 이력
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT actor_username, action, resource_type, resource_id, created_at
FROM audit_logs
WHERE action IN ('role_change', 'user_deactivate')
ORDER BY created_at DESC
LIMIT 20;
"

# 특정 티켓에 대한 모든 변경
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT actor_username, action, old_value, new_value, created_at
FROM audit_logs
WHERE resource_type = 'ticket' AND resource_id = '<ISSUE_IID>'
ORDER BY created_at;
"
```

---

## 5. 장애 대응 플레이북

### P1: API 서버 다운

**증상**: 헬스체크 실패, 503 응답, 웹 UI 접근 불가

```bash
# 1. 컨테이너 상태 확인
docker compose ps itsm-api

# 2. 최근 오류 로그
docker compose logs --tail=100 itsm-api | grep -E "ERROR|Traceback"

# 3. 즉시 재시작
docker compose restart itsm-api

# 4. 재시작 후 헬스체크
sleep 10 && curl -s http://localhost:8111/api/health

# 5. 여전히 실패하면 전체 재빌드
docker compose build itsm-api && docker compose up -d itsm-api
```

**에스컬레이션**: 재빌드 후에도 실패 시 → DB 연결 문제 확인 (항목 5-3)

---

### P1: DB 연결 실패

**증상**: 헬스체크에서 `"db": "error"`, `SQLAlchemy` 오류

```bash
# 1. PostgreSQL 상태
docker compose ps itsm-postgres
docker compose exec itsm-postgres pg_isready -U itsm

# 2. 연결 테스트
docker compose exec itsm-postgres psql -U itsm itsm -c "SELECT 1;"

# 3. PostgreSQL 재시작 (데이터 손실 없음)
docker compose restart itsm-postgres

# 4. 재시작 후 API 재시작
sleep 15 && docker compose restart itsm-api
```

---

### P2: Redis 다운

**증상**: 세션 오류, 캐시 미스 급증, Celery 태스크 큐잉 실패

```bash
# 1. Redis 상태
docker compose exec itsm-redis redis-cli ping

# 2. 재시작
docker compose restart itsm-redis

# 3. Celery도 재시작 (큐 재연결)
docker compose restart itsm-celery
```

> ⚠️ Redis 재시작 시 세션이 초기화됩니다. 사용자는 재로그인해야 합니다.

---

### P2: GitLab 연동 오류

**증상**: 티켓 생성 실패, `"gitlab": "error"`, OAuth 로그인 실패

```bash
# 1. GitLab 상태 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost:8929/-/health

# 2. GitLab 재시작 (시간 소요: 3~5분)
docker compose restart gitlab

# 3. 토큰 유효성 확인
curl -H "PRIVATE-TOKEN: <GITLAB_PROJECT_TOKEN>" \
  http://localhost:8929/api/v4/user

# 4. 토큰 만료 시 재발급 후 .env 업데이트
nano /opt/itsm/.env   # GITLAB_PROJECT_TOKEN 업데이트
docker compose restart itsm-api
```

---

### P3: Celery 태스크 쌓임

**증상**: 알림 지연, 백업 미실행, 큐 길이 증가

```bash
# 1. 큐 길이 확인
docker compose exec itsm-redis redis-cli llen celery

# 2. 활성 태스크 확인
docker compose exec itsm-celery celery -A app.celery_app inspect active

# 3. Worker 재시작
docker compose restart itsm-celery

# 4. 실패한 태스크 확인
# 웹 UI: Admin → 실패 알림 추적
```

---

### P3: 디스크 공간 부족

**증상**: `No space left on device`, 로그 쓰기 실패

```bash
# 1. 사용량 분석
df -h
du -sh /var/lib/docker/*

# 2. 미사용 Docker 리소스 정리
docker system prune -f

# 3. 오래된 백업 정리 (30일 이상)
find /opt/itsm/backups -name "*.sql.gz" -mtime +30 -delete

# 4. GitLab 로그 정리
docker compose exec gitlab gitlab-ctl tail
docker compose exec gitlab find /var/log/gitlab -name "*.log" -size +100M -delete
```

---

## 6. DB 백업 및 복구

### 자동 백업 (Celery Beat)

매일 02:00에 자동 실행됩니다.

- 위치: 컨테이너 내부 `/tmp/itsm_backups/`
- 보관: 7일 (자동 삭제)
- 암호화: AES-256-GCM

### 수동 백업

```bash
# 즉시 백업 실행
docker compose exec itsm-api python3 -c "
from app.tasks import periodic_db_backup
periodic_db_backup.apply_async()
"

# 또는 직접 pg_dump
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker compose exec -T itsm-postgres \
  pg_dump -U itsm itsm | gzip > /opt/itsm/backups/itsm_manual_${TIMESTAMP}.sql.gz

echo "백업 완료: itsm_manual_${TIMESTAMP}.sql.gz"
```

### 복구 절차

> ⚠️ 복구는 서비스를 중단합니다. 유지보수 창을 확보하세요.

```bash
# 1. 서비스 중단
docker compose stop itsm-api itsm-web itsm-celery itsm-celery-beat itsm-flower

# 2. 백업 파일 확인
ls -lh /opt/itsm/backups/

# 3. DB 초기화 (주의: 모든 데이터 삭제!)
docker compose exec itsm-postgres psql -U itsm -c "DROP DATABASE itsm;"
docker compose exec itsm-postgres psql -U itsm -c "CREATE DATABASE itsm;"

# 4. 복구 실행
gunzip -c /opt/itsm/backups/<BACKUP_FILE>.sql.gz | \
  docker compose exec -T itsm-postgres psql -U itsm itsm

# 5. 마이그레이션 확인 (최신 상태인지)
docker compose up -d itsm-api
docker compose exec itsm-api alembic current

# 6. 전체 서비스 재시작
docker compose up -d
```

### 특정 테이블만 복구

```bash
# 특정 테이블 추출
docker compose exec -T itsm-postgres \
  pg_dump -U itsm itsm -t <TABLE_NAME> | gzip > /tmp/<TABLE_NAME>_backup.sql.gz

# 복구
gunzip -c /tmp/<TABLE_NAME>_backup.sql.gz | \
  docker compose exec -T itsm-postgres psql -U itsm itsm
```

---

## 7. 성능 튜닝 체크리스트

### PostgreSQL 튜닝

```bash
# 현재 설정 확인
docker compose exec itsm-postgres psql -U itsm itsm -c "
SHOW shared_buffers; SHOW work_mem; SHOW max_connections;
"

# 슬로우 쿼리 분석
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT query, mean_exec_time, calls, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
"

# 미사용 인덱스 확인
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY tablename;
"

# VACUUM 실행 (주기적으로)
docker compose exec itsm-postgres psql -U itsm itsm -c "VACUUM ANALYZE;"
```

### Redis 메모리 관리

```bash
# 메모리 사용량
docker compose exec itsm-redis redis-cli info memory | grep used_memory_human

# 만료 키 정리
docker compose exec itsm-redis redis-cli OBJECT HELP

# 캐시 전체 삭제 (긴급 시)
docker compose exec itsm-redis redis-cli FLUSHDB
```

> ⚠️ `FLUSHDB` 실행 시 모든 세션이 초기화됩니다.

### API 응답 시간 분석

```bash
# OpenTelemetry 메트릭 (모니터링 활성화 시)
curl http://localhost:8111/api/metrics | grep http_request_duration

# Nginx 액세스 로그에서 느린 요청 확인
docker compose logs itsm-api | grep "HTTP/1" | awk '$NF > 1000 {print}' | tail -20
```

---

## 8. 보안 운영

### 정기 점검 (월 1회)

```bash
# 1. 만료된 GitLab 토큰 확인
curl -H "PRIVATE-TOKEN: $(grep GITLAB_PROJECT_TOKEN /opt/itsm/.env | cut -d= -f2)" \
  http://localhost:8929/api/v4/personal_access_tokens/self

# 2. 비활성 사용자 목록
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT username, role, last_seen_at
FROM user_roles
WHERE is_active = true AND last_seen_at < NOW() - INTERVAL '90 days'
ORDER BY last_seen_at;
"

# 3. 관리자 계정 목록 확인
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT username, name, created_at FROM user_roles WHERE role = 'admin';
"

# 4. 감사 로그 이상 접근 확인
docker compose exec itsm-postgres psql -U itsm itsm -c "
SELECT ip_address, COUNT(*) as count, actor_username
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY ip_address, actor_username
ORDER BY count DESC
LIMIT 10;
"
```

### IP 허용 목록 관리

`Admin → IP 허용 목록`에서 관리합니다.

```bash
# API로 조회
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8111/api/admin/ip-allowlist

# 긴급 차단: 특정 IP 비활성화
curl -X PATCH -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"is_active": false}' \
  http://localhost:8111/api/admin/ip-allowlist/<ENTRY_ID>
```

### 비밀 키 교체

```bash
# 1. 새 SECRET_KEY 생성
openssl rand -hex 32

# 2. .env 업데이트 (기존 세션 무효화됨)
nano /opt/itsm/.env

# 3. API 재시작
docker compose restart itsm-api
# ⚠️ 모든 사용자가 재로그인 필요
```

---

## 9. 모니터링 대시보드

### Prometheus + Grafana (선택 기능)

```bash
# 모니터링 스택 시작
docker compose --profile monitoring up -d

# Grafana 접속: http://<SERVER_IP>:3001
# 계정: admin / .env의 GRAFANA_PASSWORD
```

### 주요 대시보드

| 대시보드 | 내용 |
|----------|------|
| ITSM Overview | 티켓 현황, SLA 준수율, 신규/해결 추이 |
| API Performance | 응답시간, 오류율, 처리량 |
| Celery Tasks | 큐 길이, 처리율, 실패율 |
| DB Performance | 쿼리 시간, 연결 수, 캐시 히트율 |
| Web Vitals | LCP, FID, CLS, TTFB |
| System Resources | CPU, 메모리, 디스크, 네트워크 |

### 알림 임계값

| 메트릭 | 경고 | 위험 |
|--------|------|------|
| API 응답시간 (P95) | > 1초 | > 3초 |
| 오류율 | > 1% | > 5% |
| Celery 큐 길이 | > 100 | > 500 |
| DB 연결 수 | > 80% | > 95% |
| 디스크 사용률 | > 70% | > 85% |
| SLA 위반율 | > 5% | > 15% |

---

## 10. 정기 유지보수

### 주간

- [ ] 서비스 로그 오류 검토
- [ ] SLA 위반 티켓 검토 및 원인 분석
- [ ] 미해결 실패 알림 확인 (`Admin → 실패 알림 추적`)
- [ ] 반복 티켓 규칙 실행 이력 확인 (`Admin → 반복 티켓`)
- [ ] 디스크 사용량 확인

### 월간

- [ ] DB VACUUM ANALYZE 실행
- [ ] 90일 이상 감사 로그 아카이브 (`Admin → DB 정리`)
- [ ] 비활성 사용자 계정 비활성화
- [ ] 만료 임박 GitLab 토큰 교체
- [ ] IP 허용 목록 검토
- [ ] 보안 패치 확인 및 업데이트

### 분기별

- [ ] 전체 백업 복구 테스트
- [ ] 부하 테스트 (k6 또는 locust)
- [ ] 보안 감사 (OWASP ZAP)
- [ ] 용량 계획 검토 (디스크, DB 크기 추이)
- [ ] 의존성 취약점 스캔 (`pip-audit`, `npm audit`)

### 연간

- [ ] SSL 인증서 갱신 (HTTPS 사용 시)
- [ ] DR(재해복구) 훈련
- [ ] 아키텍처 검토 및 개선 계획 수립

---

## 참고

- **설치 가이드**: `docs/setup.md`
- **API 문서**: `http://<SERVER_IP>:8111/api/docs`
- **GitLab**: `http://<SERVER_IP>:8929`
- **이슈 신고**: GitLab Issues
