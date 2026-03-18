"""add reopened_at to sla_records for DORA MTTR tracking

Revision ID: 0045
Revises: 0044
Create Date: 2026-03-15
"""
import sqlalchemy as sa
from alembic import op


revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sla_records",
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sla_records", "reopened_at")
