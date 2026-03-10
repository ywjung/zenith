"""Add announcements table

Revision ID: 0035
Revises: 0034
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="info"),  # info|warning|critical
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

def downgrade():
    op.drop_table("announcements")
