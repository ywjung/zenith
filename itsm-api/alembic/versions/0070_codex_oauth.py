"""OpenAI Codex OAuth 필드 추가 (refresh_token, account_id)

Revision ID: 0070
Revises: 0069
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = '0070'
down_revision = '0069'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ai_settings', sa.Column('openai_oauth_refresh_token', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_account_id', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('ai_settings', 'openai_oauth_account_id')
    op.drop_column('ai_settings', 'openai_oauth_refresh_token')
