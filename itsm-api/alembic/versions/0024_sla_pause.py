"""add sla pause columns

Revision ID: 0024
Revises: 0023
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sla_records", sa.Column("paused_at", sa.DateTime(), nullable=True))
    op.add_column(
        "sla_records",
        sa.Column("total_paused_seconds", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("sla_records", "total_paused_seconds")
    op.drop_column("sla_records", "paused_at")
