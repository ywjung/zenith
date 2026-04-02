"""service_catalog approval fields

Revision ID: 0062
Revises: 0061
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("service_catalog_items",
        sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("service_catalog_items",
        sa.Column("approver_username", sa.String(100), nullable=True))
    op.add_column("service_catalog_items",
        sa.Column("approval_note", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("service_catalog_items", "approval_note")
    op.drop_column("service_catalog_items", "approver_username")
    op.drop_column("service_catalog_items", "requires_approval")
