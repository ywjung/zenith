"""add unique constraint on recurring_tickets(project_id, title)

Revision ID: 0066
Revises: 0065
Create Date: 2026-03-26

같은 프로젝트에서 동일한 제목의 반복 티켓 일정이 중복 생성되는 것을 방지.
"""
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 기존 중복 데이터가 있을 경우 먼저 최신 1건만 남기고 제거
    op.execute("""
        DELETE FROM recurring_tickets rt
        WHERE rt.id NOT IN (
            SELECT MAX(id)
            FROM recurring_tickets
            GROUP BY project_id, title
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_tickets_project_title
        ON recurring_tickets (project_id, title)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_recurring_tickets_project_title")
