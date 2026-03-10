"""Add avatar_url to user_roles

Revision ID: 0039
Revises: 0038
Create Date: 2026-03-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_roles", sa.Column("avatar_url", sa.String(500), nullable=True))


def downgrade():
    op.drop_column("user_roles", "avatar_url")
