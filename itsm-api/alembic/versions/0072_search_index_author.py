"""DB 기반 티켓 목록 최적화: author_username + 복합 인덱스

- TicketSearchIndex에 author_username 추가 (사용자 티켓 필터용)
- AutomationLog 인덱스 최적화: 단일 → 복합 (rule_id, triggered_at)

Revision ID: 0072
Revises: 0071
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = '0072'
down_revision = '0071'
branch_labels = None
depends_on = None


def upgrade():
    # TicketSearchIndex: 작성자 필터 지원
    op.add_column('ticket_search_index', sa.Column('author_username', sa.String(100), nullable=True))
    op.create_index('ix_ticket_search_author', 'ticket_search_index', ['author_username'])

    # AutomationLog: 단일 인덱스 → 복합 인덱스 (rule별 시간순 조회 최적화)
    op.drop_index('ix_automation_logs_rule_id', table_name='automation_logs')
    op.drop_index('ix_automation_logs_triggered_at', table_name='automation_logs')
    op.create_index('ix_automation_logs_rule_triggered', 'automation_logs', ['rule_id', 'triggered_at'])


def downgrade():
    op.drop_index('ix_automation_logs_rule_triggered', table_name='automation_logs')
    op.create_index('ix_automation_logs_triggered_at', 'automation_logs', ['triggered_at'])
    op.create_index('ix_automation_logs_rule_id', 'automation_logs', ['rule_id'])
    op.drop_index('ix_ticket_search_author', table_name='ticket_search_index')
    op.drop_column('ticket_search_index', 'author_username')
