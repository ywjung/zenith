"""Add outbound_webhooks table

Revision ID: 0032
Revises: 0031
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "outbound_webhooks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("secret", sa.String(200), nullable=True),   # HMAC 서명용
        sa.Column("events", JSONB, nullable=False),            # ["ticket_created", ...]
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(), nullable=True),
        sa.Column("last_status", sa.Integer(), nullable=True),  # HTTP 응답 코드
    )


def downgrade():
    op.drop_table("outbound_webhooks")
