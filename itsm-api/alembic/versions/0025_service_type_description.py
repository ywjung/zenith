"""service_type description field

Revision ID: 0025
Revises: 0024
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("service_types", sa.Column("description", sa.String(100), nullable=True))
    # Copy existing value (hardware, software, etc.) to description
    op.execute("UPDATE service_types SET description = value")
    # Re-generate value as sequential id string
    op.execute("UPDATE service_types SET value = CAST(id AS VARCHAR)")


def downgrade():
    op.drop_column("service_types", "description")
