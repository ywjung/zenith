"""failed_notifications 테이블 생성

알림 전송 최종 실패 기록 — max_retries 소진 후 추적.

Revision ID: 0058_failed_notifications
Revises: 0057_sla_warning_30min
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0058_failed_notifications"
down_revision = "0057_sla_warning_30min"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "failed_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_name", sa.String(100), nullable=False),
        sa.Column("task_id", sa.String(100), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_failed_notifications_id", "failed_notifications", ["id"])
    op.create_index("ix_failed_notifications_task_name", "failed_notifications", ["task_name"])
    op.create_index(
        "ix_failed_notifications_resolved_created",
        "failed_notifications",
        ["resolved", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_failed_notifications_resolved_created", table_name="failed_notifications")
    op.drop_index("ix_failed_notifications_task_name", table_name="failed_notifications")
    op.drop_index("ix_failed_notifications_id", table_name="failed_notifications")
    op.drop_table("failed_notifications")
