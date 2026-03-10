"""add name column to user_roles

Revision ID: 0021
Revises: 0020
Create Date: 2026-03-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_roles", sa.Column("name", sa.String(200), nullable=True))


def downgrade():
    op.drop_column("user_roles", "name")
