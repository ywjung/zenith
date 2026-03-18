"""
비즈니스 KPI Prometheus 메트릭
- DB 집계값을 Gauge로 노출 (5분 주기 갱신)
- /metrics 엔드포인트에 자동 포함됨
"""
import logging
import threading
import time

from prometheus_client import Gauge

logger = logging.getLogger(__name__)

# ── 티켓 지표 ──────────────────────────────────────────────────
itsm_kb_articles_total = Gauge(
    "itsm_kb_articles_total",
    "지식베이스 문서 수",
    ["status"],  # published | draft
)
itsm_kb_articles_views_total = Gauge(
    "itsm_kb_articles_views_total",
    "지식베이스 문서 누적 조회수 합계",
)

# ── 사용자 / 역할 ───────────────────────────────────────────────
itsm_users_total = Gauge(
    "itsm_users_total",
    "사용자 수",
    ["role"],  # admin | agent | developer | user
)

# ── SLA ────────────────────────────────────────────────────────
itsm_sla_records_total = Gauge(
    "itsm_sla_records_total",
    "SLA 레코드 수",
    ["breached"],  # true | false
)

# ── 감사 로그 ───────────────────────────────────────────────────
itsm_audit_events_total = Gauge(
    "itsm_audit_events_total",
    "감사 로그 이벤트 누적 수",
    ["action"],
)

# ── 알림 ───────────────────────────────────────────────────────
itsm_notifications_total = Gauge(
    "itsm_notifications_total",
    "알림 수",
    ["read"],  # true | false
)

# ── 기타 ───────────────────────────────────────────────────────
itsm_ratings_total = Gauge("itsm_ratings_total", "만족도 평가 제출 수")
itsm_ratings_avg_score = Gauge("itsm_ratings_avg_score", "만족도 평균 점수")
itsm_time_entries_total = Gauge("itsm_time_entries_total", "시간 기록 수")
itsm_time_entries_hours = Gauge("itsm_time_entries_hours_total", "총 기록 시간(h)")
itsm_ticket_links_total = Gauge("itsm_ticket_links_total", "티켓 링크(연관) 수")
itsm_quick_replies_total = Gauge("itsm_quick_replies_total", "빠른 답변 템플릿 수")
itsm_ticket_templates_total = Gauge("itsm_ticket_templates_total", "티켓 템플릿 수")
itsm_assignment_rules_total = Gauge(
    "itsm_assignment_rules_total", "자동 배정 규칙 수", ["enabled"]
)
itsm_watchers_total = Gauge("itsm_watchers_total", "티켓 구독자 수")
itsm_resolution_notes_total = Gauge("itsm_resolution_notes_total", "해결 노트 수")
itsm_escalation_records_total = Gauge(
    "itsm_escalation_records_total", "에스컬레이션 이력 수"
)

# ── 승인 워크플로우 ──────────────────────────────────────────────
itsm_approval_requests_total = Gauge(
    "itsm_approval_requests_total",
    "승인 요청 수",
    ["status"],  # pending | approved | rejected
)

# ── 자동화 규칙 ─────────────────────────────────────────────────
itsm_automation_rules_total = Gauge(
    "itsm_automation_rules_total", "자동화 규칙 수", ["enabled"]
)

# ── IP 허용 목록 ─────────────────────────────────────────────────
itsm_ip_allowlist_entries_total = Gauge(
    "itsm_ip_allowlist_entries_total", "IP 허용 목록 항목 수", ["enabled"]
)


def _refresh(session_factory):
    """DB 집계 → Gauge 갱신 (예외 발생 시 로그만 남김)."""
    try:
        from sqlalchemy import text

        with session_factory() as db:

            def scalar(sql: str, **kw):
                return db.execute(text(sql), kw).scalar() or 0

            # KB
            itsm_kb_articles_total.labels(status="published").set(
                scalar("SELECT COUNT(*) FROM kb_articles WHERE published=true")
            )
            itsm_kb_articles_total.labels(status="draft").set(
                scalar("SELECT COUNT(*) FROM kb_articles WHERE published=false")
            )
            itsm_kb_articles_views_total.set(
                scalar("SELECT COALESCE(SUM(view_count),0) FROM kb_articles")
            )

            # 사용자
            rows = db.execute(
                text("SELECT role, COUNT(*) FROM user_roles WHERE is_active=true GROUP BY role")
            ).all()
            for role, cnt in rows:
                itsm_users_total.labels(role=role).set(cnt)

            # SLA
            itsm_sla_records_total.labels(breached="true").set(
                scalar("SELECT COUNT(*) FROM sla_records WHERE breached=true")
            )
            itsm_sla_records_total.labels(breached="false").set(
                scalar("SELECT COUNT(*) FROM sla_records WHERE breached=false")
            )

            # 감사 로그 (최근 상위 10개 액션)
            rows = db.execute(
                text("SELECT action, COUNT(*) FROM audit_logs GROUP BY action ORDER BY COUNT(*) DESC LIMIT 10")
            ).all()
            for action, cnt in rows:
                itsm_audit_events_total.labels(action=action).set(cnt)

            # 알림
            itsm_notifications_total.labels(read="true").set(
                scalar("SELECT COUNT(*) FROM notifications WHERE is_read=true")
            )
            itsm_notifications_total.labels(read="false").set(
                scalar("SELECT COUNT(*) FROM notifications WHERE is_read=false")
            )

            # 평가
            itsm_ratings_total.set(scalar("SELECT COUNT(*) FROM ratings"))
            avg = scalar("SELECT COALESCE(AVG(score),0) FROM ratings")
            itsm_ratings_avg_score.set(round(float(avg), 2))

            # 시간 기록
            itsm_time_entries_total.set(scalar("SELECT COUNT(*) FROM time_entries"))
            hrs = scalar("SELECT COALESCE(SUM(minutes)/60.0, 0) FROM time_entries")
            itsm_time_entries_hours.set(round(float(hrs), 2))

            # 기타
            itsm_ticket_links_total.set(scalar("SELECT COUNT(*) FROM ticket_links"))
            itsm_quick_replies_total.set(scalar("SELECT COUNT(*) FROM quick_replies"))
            itsm_ticket_templates_total.set(scalar("SELECT COUNT(*) FROM ticket_templates"))
            itsm_assignment_rules_total.labels(enabled="true").set(
                scalar("SELECT COUNT(*) FROM assignment_rules WHERE enabled=true")
            )
            itsm_assignment_rules_total.labels(enabled="false").set(
                scalar("SELECT COUNT(*) FROM assignment_rules WHERE enabled=false")
            )
            itsm_watchers_total.set(scalar("SELECT COUNT(*) FROM ticket_watchers"))
            itsm_resolution_notes_total.set(scalar("SELECT COUNT(*) FROM resolution_notes"))
            itsm_escalation_records_total.set(scalar("SELECT COUNT(*) FROM escalation_records"))

            # 승인 워크플로우
            rows = db.execute(
                text("SELECT status, COUNT(*) FROM approval_requests GROUP BY status")
            ).all()
            seen_statuses = set()
            for status, cnt in rows:
                itsm_approval_requests_total.labels(status=status).set(cnt)
                seen_statuses.add(status)
            for s in ("pending", "approved", "rejected"):
                if s not in seen_statuses:
                    itsm_approval_requests_total.labels(status=s).set(0)

            # 자동화 규칙 (컬럼명: is_active)
            itsm_automation_rules_total.labels(enabled="true").set(
                scalar("SELECT COUNT(*) FROM automation_rules WHERE is_active=true")
            )
            itsm_automation_rules_total.labels(enabled="false").set(
                scalar("SELECT COUNT(*) FROM automation_rules WHERE is_active=false")
            )

            # IP 허용 목록 (컬럼명: is_active)
            itsm_ip_allowlist_entries_total.labels(enabled="true").set(
                scalar("SELECT COUNT(*) FROM ip_allowlist WHERE is_active=true")
            )
            itsm_ip_allowlist_entries_total.labels(enabled="false").set(
                scalar("SELECT COUNT(*) FROM ip_allowlist WHERE is_active=false")
            )

    except Exception as e:
        logger.warning("business_metrics refresh error: %s", e)


def start_background_refresh(session_factory, interval: int = 300):
    """daemon 스레드로 주기적 갱신 시작."""

    def _loop():
        time.sleep(30)  # 기동 직후 30초 대기 — 스타트업 부하 분산
        while True:
            try:
                _refresh(session_factory)
            except Exception as e:
                logger.warning("business_metrics loop error: %s", e)
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name="biz-metrics-refresh")
    t.start()
    logger.info("Business metrics background refresh started (interval=%ds)", interval)
