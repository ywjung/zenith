"""변경요청 샘플 데이터 시드 스크립트."""
import os, sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", os.environ.get("DATABASE_URL", ""))

from app.database import SessionLocal
from app.models import ChangeRequest

db = SessionLocal()

NOW = datetime.now(timezone.utc)

SAMPLES = [
    # ── 정형 (standard) ──────────────────────────────────────────────────
    {
        "title": "[정형] 월간 OS 보안 패치 적용 — 서버팜 전체",
        "description": (
            "매월 정기 유지보수 창(2번째 토요일 02:00~06:00)에 맞춰 "
            "서버팜 전체(운영 서버 42대)의 OS 보안 패치를 적용합니다.\n\n"
            "**대상 시스템:** WAS 서버 18대, DB 서버 8대, 배치 서버 16대\n"
            "**패치 내용:** CVE-2026-12345 등 High 이상 취약점 12건 해소\n"
            "**영향 범위:** 패치 적용 서버별 약 15분 재시작 소요"
        ),
        "change_type": "standard",
        "risk_level": "low",
        "status": "approved",
        "impact": "패치 적용 서버별 15분 서비스 단절, 순차 적용으로 전체 영향 최소화",
        "rollback_plan": "이전 커널 버전으로 grub 부팅 옵션 변경 후 재시작 (5분 이내 복구 가능)",
        "scheduled_start_at": NOW + timedelta(days=5, hours=2),
        "scheduled_end_at": NOW + timedelta(days=5, hours=6),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(days=1),
        "approval_comment": "정기 패치 절차에 따라 승인합니다. 패치 전 스냅샷 백업 확인 바랍니다.",
        "project_id": "1",
    },
    {
        "title": "[정형] SSL/TLS 인증서 갱신 — 외부 연동 도메인 3종",
        "description": (
            "만료 예정(D-14) 인증서를 갱신합니다.\n\n"
            "**대상:** api.example.com, auth.example.com, cdn.example.com\n"
            "**인증기관:** DigiCert EV SSL (3년 갱신)\n"
            "**작업 방식:** 무중단 갱신(Hot-swap) — nginx reload만 수행"
        ),
        "change_type": "standard",
        "risk_level": "low",
        "status": "implemented",
        "impact": "nginx reload 시 <1초 미만 연결 끊김 발생 가능",
        "rollback_plan": "이전 인증서 파일 복원 후 nginx reload",
        "scheduled_start_at": NOW - timedelta(days=3, hours=10),
        "scheduled_end_at": NOW - timedelta(days=3, hours=10, minutes=30),
        "actual_start_at": NOW - timedelta(days=3, hours=10),
        "actual_end_at": NOW - timedelta(days=3, hours=9, minutes=45),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(days=5),
        "result_note": "3개 도메인 인증서 갱신 완료. 만료일 2029-03-26으로 연장 확인.",
        "project_id": "1",
    },

    # ── 일반 (normal) ──────────────────────────────────────────────────
    {
        "title": "[일반] PostgreSQL 17 → 17.2 마이너 업그레이드",
        "description": (
            "PostgreSQL 17.2 릴리스에 포함된 쿼리 플래너 버그 수정 및 성능 개선 사항을 반영합니다.\n\n"
            "**배경:** 현재 버전(17.0)에서 특정 CTE 쿼리 플랜 오류(#8821) 확인\n"
            "**예상 개선:** 통계 집계 쿼리 약 30% 성능 향상\n"
            "**사전 검증:** 스테이징 환경에서 72시간 운영 검증 완료"
        ),
        "change_type": "normal",
        "risk_level": "medium",
        "status": "reviewing",
        "impact": "DB 재시작으로 인해 약 2~3분 서비스 중단 예상",
        "rollback_plan": (
            "pg_upgrade --revert 또는 스냅샷 복원(RTO 15분).\n"
            "롤백 시 17.0 바이너리 유지 필요 → /opt/pg17.0 경로 보존"
        ),
        "scheduled_start_at": NOW + timedelta(days=10, hours=1),
        "scheduled_end_at": NOW + timedelta(days=10, hours=3),
        "requester_username": "root",
        "requester_name": "관리자",
        "project_id": "1",
    },
    {
        "title": "[일반] 헬프데스크 시스템 신규 기능 배포 — v1.9.0",
        "description": (
            "ZENITH ITSM v1.9.0 릴리스 배포.\n\n"
            "**주요 변경사항:**\n"
            "- 변경관리 모듈 UI 개선 (현재 작업)\n"
            "- 티켓 일괄 처리 성능 최적화 (기존 대비 2배)\n"
            "- SLA 예측 알림 정확도 향상\n"
            "- 접근성(WCAG 2.1 AA) 개선 23건\n\n"
            "**배포 방식:** Blue-Green, 자동 롤백 트리거 설정"
        ),
        "change_type": "normal",
        "risk_level": "medium",
        "status": "approved",
        "impact": "배포 중 5분 내 서비스 전환, 사용자 세션 유지",
        "rollback_plan": "Blue 환경으로 트래픽 전환 (1분 이내). 이전 버전(v1.8.0) 이미지 보존.",
        "scheduled_start_at": NOW + timedelta(days=2, hours=22),
        "scheduled_end_at": NOW + timedelta(days=2, hours=23, minutes=30),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(hours=6),
        "approval_comment": "스테이징 QA 결과 확인 완료. 배포 전 DB 마이그레이션 순서 재확인 바랍니다.",
        "project_id": "1",
    },
    {
        "title": "[일반] Redis 캐시 서버 클러스터링 전환 (Standalone → Cluster 3-node)",
        "description": (
            "단일 Redis 인스턴스를 3-node Cluster 구성으로 전환하여 고가용성을 확보합니다.\n\n"
            "**현황:** Redis 7.4 Standalone, 메모리 14GB 사용(80%)\n"
            "**전환 후:** Primary 3 + Replica 3, 자동 failover\n"
            "**예상 효과:** 장애 복구 시간 30분 → 30초 이내로 단축"
        ),
        "change_type": "normal",
        "risk_level": "high",
        "status": "submitted",
        "impact": "마이그레이션 중 10~15분 캐시 무효화. 이 기간 DB 부하 증가 예상.",
        "rollback_plan": (
            "Cluster 전환 실패 시 Standalone 인스턴스 재활성화.\n"
            "애플리케이션 REDIS_URL 환경변수만 변경하면 즉시 적용 가능."
        ),
        "scheduled_start_at": NOW + timedelta(days=14, hours=3),
        "scheduled_end_at": NOW + timedelta(days=14, hours=7),
        "requester_username": "root",
        "requester_name": "관리자",
        "project_id": "1",
    },
    {
        "title": "[일반] Nginx 설정 변경 — WAF 규칙 강화 및 Rate-limit 조정",
        "description": (
            "최근 DDoS 시도 대응으로 Nginx 레이어에서 WAF 규칙을 강화합니다.\n\n"
            "**변경 내용:**\n"
            "1. ModSecurity CRS 3.3 → 3.4 업그레이드\n"
            "2. /api/auth 엔드포인트 Rate-limit: 10r/m → 5r/m\n"
            "3. 봇 차단 규칙 추가 (User-Agent 기반)\n"
            "4. Slow HTTP 공격 방어 타임아웃 조정"
        ),
        "change_type": "normal",
        "risk_level": "medium",
        "status": "draft",
        "impact": "일부 자동화 스크립트가 Rate-limit에 걸릴 수 있음. 사전 공지 필요.",
        "rollback_plan": "이전 nginx.conf 백업본 복원 후 nginx reload (2분 이내)",
        "requester_username": "root",
        "requester_name": "관리자",
        "project_id": "1",
    },
    {
        "title": "[일반] 직원 포털 디자인 시스템 전면 개편 (v2.0)",
        "description": (
            "사용자 만족도 조사(4.8점/10점) 결과를 반영해 직원 포털 UI를 전면 개편합니다.\n\n"
            "**주요 변경:**\n"
            "- 글로벌 네비게이션 재구성 (메뉴 11개 → 7개 그룹화)\n"
            "- 대시보드 위젯 커스터마이징 기능 추가\n"
            "- 다크모드 기본 지원\n"
            "- 모바일 반응형 완전 지원\n\n"
            "**A/B 테스트:** 2주간 20% 사용자 대상 검증 완료, 만족도 7.9점 달성"
        ),
        "change_type": "normal",
        "risk_level": "low",
        "status": "implementing",
        "impact": "UI 변경으로 인한 사용자 적응 기간 약 1주일 예상. 교육자료 사전 배포.",
        "rollback_plan": "Feature flag 비활성화로 구 버전 즉시 복원",
        "scheduled_start_at": NOW - timedelta(days=1),
        "scheduled_end_at": NOW + timedelta(days=1),
        "actual_start_at": NOW - timedelta(hours=8),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(days=3),
        "implementer_username": "root",
        "project_id": "1",
    },
    {
        "title": "[일반] 외부 연동 API 인증 방식 변경 — API Key → OAuth 2.0",
        "description": (
            "레거시 API Key 인증을 OAuth 2.0 Client Credentials로 전환합니다.\n\n"
            "**배경:** 보안 감사에서 API Key 관리 취약점 지적 (소스코드 하드코딩 사례 발견)\n"
            "**영향 시스템:** ERP 연동 3종, 그룹웨어 연동 1종\n"
            "**마이그레이션 기간:** 구 API Key와 병행 운영 후 3개월 후 완전 전환"
        ),
        "change_type": "normal",
        "risk_level": "high",
        "status": "rejected",
        "impact": "연동 시스템 코드 변경 필요. 각 팀 개발 일정 조율 필수.",
        "rollback_plan": "API Key 방식으로 즉시 복원 가능 (병행 운영 기간 활용)",
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(days=7),
        "approval_comment": (
            "각 연동 시스템 팀과의 사전 협의가 부족합니다. "
            "ERP 팀 일정 확인 후 재제출 바랍니다."
        ),
        "project_id": "1",
    },

    # ── 긴급 (emergency) ──────────────────────────────────────────────────
    {
        "title": "[긴급] 결제 서비스 장애 — Stripe Webhook 서명 검증 실패 핫픽스",
        "description": (
            "**장애 발생:** 2026-03-25 14:37 KST\n"
            "**증상:** 결제 완료 웹훅 처리 실패로 주문 상태 미갱신\n"
            "**원인:** Stripe SDK 7.1.0 업그레이드 후 서명 검증 로직 breaking change\n\n"
            "**임시조치:** 웹훅 처리 큐 수동 처리 중 (ops 팀)\n"
            "**영구조치:** SDK 7.0.3으로 다운그레이드 또는 검증 로직 수정 배포"
        ),
        "change_type": "emergency",
        "risk_level": "critical",
        "status": "implemented",
        "impact": "핫픽스 배포 2분 재시작. 미처리 웹훅 1,247건 배치 재처리 실행.",
        "rollback_plan": "SDK 이전 버전으로 즉시 revert. 배포 시간 3분 이내.",
        "scheduled_start_at": NOW - timedelta(days=1, hours=3),
        "scheduled_end_at": NOW - timedelta(days=1, hours=2, minutes=45),
        "actual_start_at": NOW - timedelta(days=1, hours=3),
        "actual_end_at": NOW - timedelta(days=1, hours=2, minutes=48),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(days=1, hours=3, minutes=10),
        "approval_comment": "긴급 승인. 배포 완료 후 사후 분석 보고서 제출 요망.",
        "implementer_username": "root",
        "result_note": (
            "핫픽스 배포 완료(v2.4.1-hotfix). Stripe SDK 7.0.3 다운그레이드.\n"
            "미처리 웹훅 1,247건 모두 재처리 완료. 주문 상태 정상화 확인."
        ),
        "project_id": "1",
    },
    {
        "title": "[긴급] Zero-day 취약점 대응 — Log4j 유사 RCE 패치 즉시 배포",
        "description": (
            "**CVE-2026-99991 (CVSS 9.8 Critical)**\n"
            "사내 사용 중인 오픈소스 라이브러리에서 원격 코드 실행 취약점 발견.\n\n"
            "**KISA 긴급 권고:** 즉시 패치 적용\n"
            "**취약 버전:** libexample < 2.3.1\n"
            "**패치 버전:** libexample 2.3.1\n\n"
            "**영향 시스템:** 외부 공개 API 서버 전체 (인터넷 노출)"
        ),
        "change_type": "emergency",
        "risk_level": "critical",
        "status": "approved",
        "impact": "시스템별 약 5분 재시작. 가용성보다 보안 우선.",
        "rollback_plan": "패치 후 기능 이상 발생 시 이전 버전 복원 (스냅샷 30분 이내 복구 가능)",
        "scheduled_start_at": NOW + timedelta(hours=2),
        "scheduled_end_at": NOW + timedelta(hours=4),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(minutes=30),
        "approval_comment": "CISO 지시사항. 즉시 착수 요청.",
        "project_id": "1",
    },
    {
        "title": "[긴급] 운영 DB 디스크 사용률 95% 초과 — 긴급 용량 확장",
        "description": (
            "**발견:** 2026-03-26 09:12 모니터링 알림\n"
            "**현황:** /var/lib/postgresql 디스크 95.3% 사용 (1.9TB/2TB)\n"
            "**원인 분석:**\n"
            "- WAL 아카이브 정리 스크립트 오동작 (3주 누적)\n"
            "- 대용량 JSONB 컬럼 인덱스 비대화\n\n"
            "**즉시 조치:**\n"
            "1. WAL 아카이브 7일 초과분 즉시 삭제 (여유공간 +200GB)\n"
            "2. 불필요 인덱스 REINDEX CONCURRENTLY"
        ),
        "change_type": "emergency",
        "risk_level": "high",
        "status": "implementing",
        "impact": "REINDEX 작업 중 쿼리 지연 약 20% 증가 예상 (CONCURRENTLY 사용으로 최소화)",
        "rollback_plan": "아카이브 삭제는 비가역적. 삭제 전 S3 백업 완료 필수.",
        "actual_start_at": NOW - timedelta(hours=1),
        "requester_username": "root",
        "requester_name": "관리자",
        "approver_username": "root",
        "approver_name": "관리자",
        "approved_at": NOW - timedelta(hours=1, minutes=10),
        "approval_comment": "즉시 승인. WAL 삭제 전 백업 스냅샷 확인 필수.",
        "implementer_username": "root",
        "project_id": "1",
    },
]

created = 0
for s in SAMPLES:
    # 이미 같은 제목이 있으면 스킵
    exists = db.query(ChangeRequest).filter(ChangeRequest.title == s["title"]).first()
    if exists:
        print(f"  SKIP (exists): {s['title'][:60]}")
        continue

    cr = ChangeRequest(**s)
    db.add(cr)
    created += 1
    print(f"  ADD [{s['change_type']:9s}][{s['status']:12s}][{s['risk_level']:8s}]: {s['title'][:60]}")

db.commit()
db.close()
print(f"\n✓ {created}건 생성 완료.")
