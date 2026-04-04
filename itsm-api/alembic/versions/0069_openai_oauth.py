"""OpenAI OAuth 2.0 설정 필드 추가

Revision ID: 0069
Revises: 0068
Create Date: 2026-04-04
"""
from alembic import op
import sqlalchemy as sa

revision = '0069'
down_revision = '0068'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ai_settings', sa.Column('openai_auth_method', sa.String(20), server_default='api_key', nullable=False))
    op.add_column('ai_settings', sa.Column('openai_oauth_client_id', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_client_secret', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_auth_url', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_token_url', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_scope', sa.String(500), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_access_token', sa.Text(), nullable=True))
    op.add_column('ai_settings', sa.Column('openai_oauth_token_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('ai_settings', 'openai_oauth_token_expires_at')
    op.drop_column('ai_settings', 'openai_oauth_access_token')
    op.drop_column('ai_settings', 'openai_oauth_scope')
    op.drop_column('ai_settings', 'openai_oauth_token_url')
    op.drop_column('ai_settings', 'openai_oauth_auth_url')
    op.drop_column('ai_settings', 'openai_oauth_client_secret')
    op.drop_column('ai_settings', 'openai_oauth_client_id')
    op.drop_column('ai_settings', 'openai_oauth_auth_method')
