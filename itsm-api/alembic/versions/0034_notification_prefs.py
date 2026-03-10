"""Add notification preferences

Revision ID: 0034
Revises: 0033
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "notification_prefs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(50), nullable=False, unique=True),
        sa.Column("prefs", JSONB, nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

def downgrade():
    op.drop_table("notification_prefs")
