"""Add is_active and last_seen_at to user_roles for GitLab sync

Revision ID: 0028
Revises: 0027
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user_roles", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("user_roles", sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    op.create_index("ix_user_roles_is_active", "user_roles", ["is_active"])


def downgrade():
    op.drop_index("ix_user_roles_is_active", table_name="user_roles")
    op.drop_column("user_roles", "last_seen_at")
    op.drop_column("user_roles", "is_active")
