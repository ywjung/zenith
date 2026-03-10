"""Add missing performance indexes

Revision ID: 0031
Revises: 0030
Create Date: 2026-03-08

누락된 인덱스 추가로 테이블 풀스캔 제거:
- kb_articles: published, category (목록 조회 필터)
- kb_articles: FTS GIN 인덱스 (전문검색 성능)
- notifications: created_at (최신 알림 조회)
- assignment_rules: enabled (활성 규칙만 조회)
- sla_records: breached, resolved_at, warning_sent (SLA 체커 쿼리)
- escalation_records: policy_id (중복 실행 방지 조회)

모든 인덱스를 IF NOT EXISTS로 멱등 처리.
"""
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    # IF NOT EXISTS DDL 직접 사용 — 멱등 보장
    stmts = [
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_published ON kb_articles (published)",
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_category ON kb_articles (category)",
        # FTS GIN 인덱스 — to_tsvector 연산을 인덱스 시점에 수행해 조회 성능 향상
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_fts "
        "ON kb_articles USING gin(to_tsvector('simple', title || ' ' || content))",
        "CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at)",
        "CREATE INDEX IF NOT EXISTS ix_assignment_rules_enabled ON assignment_rules (enabled)",
        "CREATE INDEX IF NOT EXISTS ix_sla_records_breached_resolved ON sla_records (breached, resolved_at)",
        "CREATE INDEX IF NOT EXISTS ix_sla_records_warning_sent ON sla_records (warning_sent)",
        "CREATE INDEX IF NOT EXISTS ix_escalation_records_policy_ticket ON escalation_records (policy_id, ticket_iid)",
    ]
    for stmt in stmts:
        op.execute(stmt)


def downgrade():
    drops = [
        "ix_escalation_records_policy_ticket",
        "ix_sla_records_warning_sent",
        "ix_sla_records_breached_resolved",
        "ix_assignment_rules_enabled",
        "ix_notifications_created_at",
        "ix_kb_articles_fts",
        "ix_kb_articles_category",
        "ix_kb_articles_published",
    ]
    for idx in drops:
        op.execute(f"DROP INDEX IF EXISTS {idx}")
