"""Add web_push_subscriptions table.

Revision ID: 0061
Revises: 0060
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0061"
down_revision = "0060_change_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_push_subscriptions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("endpoint", sa.Text, nullable=False, unique=True),
        sa.Column("p256dh", sa.Text, nullable=False),
        sa.Column("auth", sa.Text, nullable=False),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_web_push_subscriptions_username",
        "web_push_subscriptions",
        ["username"],
    )


def downgrade() -> None:
    op.drop_index("ix_web_push_subscriptions_username", "web_push_subscriptions")
    op.drop_table("web_push_subscriptions")
