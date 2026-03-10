"""add warning_sent to sla_records

Revision ID: 0022
Revises: 0021
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sla_records", sa.Column("warning_sent", sa.Boolean(), nullable=False, server_default="false"))


def downgrade():
    op.drop_column("sla_records", "warning_sent")
