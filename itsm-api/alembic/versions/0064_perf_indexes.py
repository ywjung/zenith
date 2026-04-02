"""performance indexes — recurring_tickets, sla_records, user_roles, ticket_search_index

누락된 복합 인덱스 추가:
  1. recurring_tickets  (is_active, next_run_at) — Celery beat 1분마다 실행 쿼리 최적화
  2. sla_records        (breached, sla_deadline) — SLA 위반 감지 쿼리 최적화
  3. user_roles         (username), (role, is_active) — 사용자 조회/필터 최적화
  4. ticket_search_index (state, project_id), (assignee_username) — 내 티켓 쿼리 최적화

Revision ID: 0064
Revises: 0063
Create Date: 2026-03-26
"""
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade():
    # 1. recurring_tickets — Celery beat이 매분 쿼리: WHERE is_active=true AND next_run_at <= NOW()
    op.create_index(
        "ix_recurring_tickets_active_next_run",
        "recurring_tickets",
        ["is_active", "next_run_at"],
    )

    # 2. sla_records — SLA 체커가 주기적으로 쿼리: WHERE breached=false AND sla_deadline < NOW()
    op.create_index(
        "ix_sla_records_breach_check",
        "sla_records",
        ["breached", "sla_deadline"],
    )

    # 3. user_roles — username 조회는 모든 인증된 요청에서 발생
    op.create_index(
        "ix_user_roles_username",
        "user_roles",
        ["username"],
    )
    # role + is_active: 담당자 목록 조회 (GET /admin/users?role=agent)
    op.create_index(
        "ix_user_roles_role_active",
        "user_roles",
        ["role", "is_active"],
    )

    # 4. ticket_search_index — 상태별/담당자별 티켓 목록 (대시보드·내 티켓)
    op.create_index(
        "ix_ticket_search_state_project",
        "ticket_search_index",
        ["state", "project_id"],
    )
    op.create_index(
        "ix_ticket_search_assignee",
        "ticket_search_index",
        ["assignee_username"],
    )


def downgrade():
    op.drop_index("ix_ticket_search_assignee", "ticket_search_index")
    op.drop_index("ix_ticket_search_state_project", "ticket_search_index")
    op.drop_index("ix_user_roles_role_active", "user_roles")
    op.drop_index("ix_user_roles_username", "user_roles")
    op.drop_index("ix_sla_records_breach_check", "sla_records")
    op.drop_index("ix_recurring_tickets_active_next_run", "recurring_tickets")
