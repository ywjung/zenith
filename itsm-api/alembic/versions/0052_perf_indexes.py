"""perf: 자주 사용되는 필터 패턴에 복합 인덱스 추가

Revision ID: 0052_perf_indexes
Revises: 0051_faq
Create Date: 2026-03-19
"""
from alembic import op

revision = "0052_perf_indexes"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # notifications: 미읽 알림 조회 (수신자 + 읽음 여부 + 생성일) — 이미 ix_notifications_recipient_unread 있음
    # AuditLog: action + resource_type 복합 (보고서 필터)
    op.create_index(
        "ix_audit_logs_action_resource",
        "audit_logs",
        ["action", "resource_type", "created_at"],
        if_not_exists=True,
    )
    # SLARecord: 기간별 SLA 위반 보고서 쿼리
    op.create_index(
        "ix_sla_records_breach",
        "sla_records",
        ["breached", "sla_deadline"],
        if_not_exists=True,
    )
    # ticket_watchers: 특정 이슈의 감시자 목록 조회
    op.create_index(
        "ix_ticket_watchers_issue_project",
        "ticket_watchers",
        ["ticket_iid", "project_id"],
        if_not_exists=True,
    )
    # time_entries: 기간별 집계
    op.create_index(
        "ix_time_entries_logged_at",
        "time_entries",
        ["logged_at"],
        if_not_exists=True,
    )
    # refresh_tokens: 만료 토큰 정리 쿼리
    op.create_index(
        "ix_refresh_tokens_expires_at",
        "refresh_tokens",
        ["expires_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_expires_at", table_name="refresh_tokens", if_exists=True)
    op.drop_index("ix_time_entries_logged_at", table_name="time_entries", if_exists=True)
    op.drop_index("ix_ticket_watchers_issue_project", table_name="ticket_watchers", if_exists=True)
    op.drop_index("ix_sla_records_breach", table_name="sla_records", if_exists=True)
    op.drop_index("ix_audit_logs_action_resource", table_name="audit_logs", if_exists=True)
