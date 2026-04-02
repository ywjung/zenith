"""recurring_tickets 테이블 생성

반복 티켓 스케줄 정의 — 정기적으로 GitLab 이슈를 자동 생성.

Revision ID: 0059_recurring_tickets
Revises: 0058_failed_notifications
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0059_recurring_tickets"
down_revision = "0058_failed_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recurring_tickets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(50), nullable=False, server_default="other"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("cron_expr", sa.String(100), nullable=False),
        sa.Column("cron_label", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recurring_tickets_id", "recurring_tickets", ["id"])
    op.create_index("ix_recurring_tickets_is_active", "recurring_tickets", ["is_active"])
    op.create_index("ix_recurring_tickets_next_run_at", "recurring_tickets", ["next_run_at"])


def downgrade() -> None:
    op.drop_index("ix_recurring_tickets_next_run_at", table_name="recurring_tickets")
    op.drop_index("ix_recurring_tickets_is_active", table_name="recurring_tickets")
    op.drop_index("ix_recurring_tickets_id", table_name="recurring_tickets")
    op.drop_table("recurring_tickets")
