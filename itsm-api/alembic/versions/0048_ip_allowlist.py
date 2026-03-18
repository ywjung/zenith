"""Add ip_allowlist table.

Revision ID: 0048
Revises: 0047
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ip_allowlist",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cidr", sa.String(50), nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cidr"),
    )
    op.create_index("ix_ip_allowlist_id", "ip_allowlist", ["id"])


def downgrade():
    op.drop_index("ix_ip_allowlist_id", table_name="ip_allowlist")
    op.drop_table("ip_allowlist")
