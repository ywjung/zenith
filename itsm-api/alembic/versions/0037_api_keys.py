"""Add api_keys table

Revision ID: 0037
Revises: 0036
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("key_prefix", sa.String(16), nullable=False),       # itsm_live_xxxxxxxx
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),  # SHA-256
        sa.Column("scopes", JSONB, nullable=False, server_default="[]"),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"])
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"])


def downgrade():
    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.drop_index("ix_api_keys_key_prefix", table_name="api_keys")
    op.drop_table("api_keys")
