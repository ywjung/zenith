"""add guest_tokens table

Revision ID: 0023
Revises: 0022
Create Date: 2026-03-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "guest_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("ticket_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_guest_tokens_token", "guest_tokens", ["token"], unique=True)


def downgrade():
    op.drop_index("ix_guest_tokens_token", "guest_tokens")
    op.drop_table("guest_tokens")
