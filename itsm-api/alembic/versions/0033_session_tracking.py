"""Add device tracking to refresh_tokens

Revision ID: 0033
Revises: 0032
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("refresh_tokens", sa.Column("device_name", sa.String(255), nullable=True))
    op.add_column("refresh_tokens", sa.Column("ip_address", sa.String(45), nullable=True))
    op.add_column("refresh_tokens", sa.Column("last_used_at", sa.DateTime(), nullable=True))

def downgrade():
    op.drop_column("refresh_tokens", "last_used_at")
    op.drop_column("refresh_tokens", "ip_address")
    op.drop_column("refresh_tokens", "device_name")
