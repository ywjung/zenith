"""add missing indexes: refresh_tokens, ticket_links, time_entries

Revision ID: 0043
Revises: 0042
Create Date: 2026-03-13
"""
from alembic import op

revision = '0043'
down_revision = '0042'
branch_labels = None
depends_on = None


def upgrade():
    # 토큰 갱신/로그인 시 사용자별 활성 세션 조회 경로 (매번 full scan 방지)
    op.create_index(
        'ix_refresh_tokens_user_active',
        'refresh_tokens',
        ['gitlab_user_id', 'revoked', 'expires_at'],
        if_not_exists=True,
    )
    # 티켓 상세에서 링크 조회 경로 (0011에서 이미 생성됐을 수 있으므로 IF NOT EXISTS)
    op.create_index(
        'ix_ticket_links_source',
        'ticket_links',
        ['source_iid', 'project_id'],
        if_not_exists=True,
    )
    # 티켓 상세에서 작업시간 조회 경로
    op.create_index(
        'ix_time_entries_issue_project',
        'time_entries',
        ['issue_iid', 'project_id'],
        if_not_exists=True,
    )


def downgrade():
    op.drop_index('ix_refresh_tokens_user_active', table_name='refresh_tokens')
    op.drop_index('ix_ticket_links_source', table_name='ticket_links')
    op.drop_index('ix_time_entries_issue_project', table_name='time_entries')
