"""Add sudo_tokens table for admin re-authentication

Revision ID: 0040
Revises: 0039
Create Date: 2026-03-09

고위험 관리자 작업(역할 변경, API 키 발급 등) 시 추가 인증을 요구한다.
"""
from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sudo_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True, index=True),
        sa.Column("user_id", sa.String(50), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
    )


def downgrade():
    op.drop_table("sudo_tokens")
