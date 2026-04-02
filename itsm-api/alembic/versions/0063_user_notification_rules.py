"""user_notification_rules table

Revision ID: 0063
Revises: 0062
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_notification_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(100), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        # 조건 — 모든 조건을 AND로 평가, 빈 배열은 "모두 해당"
        sa.Column("match_priorities", JSONB, nullable=False, server_default="[]"),   # e.g. ["high","critical"]
        sa.Column("match_categories", JSONB, nullable=False, server_default="[]"),   # e.g. ["hardware"]
        sa.Column("match_states", JSONB, nullable=False, server_default="[]"),       # e.g. ["open","in_progress"]
        sa.Column("match_sla_warning", sa.Boolean(), nullable=False, server_default="false"),  # SLA 임박
        # 알림 채널
        sa.Column("notify_in_app", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_email", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notify_push", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now()),
    )


def downgrade():
    op.drop_table("user_notification_rules")
