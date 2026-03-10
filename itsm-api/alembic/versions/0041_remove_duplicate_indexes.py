"""remove duplicate indexes

Revision ID: 0041
Revises: 0040
Create Date: 2026-03-09
"""
from alembic import op

revision = '0041'
down_revision = '0040'
branch_labels = None
depends_on = None


def upgrade():
    # pkey와 동일 컬럼을 중복 인덱싱하는 ix_xxx_id 계열 제거
    duplicate_id_indexes = [
        ('assignment_rules',    'ix_assignment_rules_id'),
        ('escalation_policies', 'ix_escalation_policies_id'),
        ('escalation_records',  'ix_escalation_records_id'),
        ('kb_articles',         'ix_kb_articles_id'),
        ('project_forwards',    'ix_project_forwards_id'),
        ('quick_replies',       'ix_quick_replies_id'),
        ('ratings',             'ix_ratings_id'),
        ('refresh_tokens',      'ix_refresh_tokens_id'),
        ('sla_records',         'ix_sla_records_id'),
        ('ticket_links',        'ix_ticket_links_id'),
        ('ticket_templates',    'ix_ticket_templates_id'),
        ('ticket_watchers',     'ix_ticket_watchers_id'),
        ('time_entries',        'ix_time_entries_id'),
        ('user_roles',          'ix_user_roles_id'),
    ]
    for table, idx in duplicate_id_indexes:
        op.drop_index(idx, table_name=table, if_exists=True)

    # api_keys: ix_api_keys_key_hash 중복 (api_keys_key_hash_key unique constraint가 이미 인덱스 제공)
    op.drop_index('ix_api_keys_key_hash', table_name='api_keys', if_exists=True)

    # guest_tokens: ix_guest_tokens_token 중복 (guest_tokens_token_key unique constraint)
    op.drop_index('ix_guest_tokens_token', table_name='guest_tokens', if_exists=True)

    # kb_articles: slug 중복 (kb_articles_slug_key unique constraint)
    op.drop_index('ix_kb_articles_slug', table_name='kb_articles', if_exists=True)

    # refresh_tokens: token_hash 3중 중복 → ix_refresh_tokens_hash 제거 (ix_refresh_tokens_token_hash 유지)
    op.drop_index('ix_refresh_tokens_hash', table_name='refresh_tokens', if_exists=True)

    # user_roles: gitlab_user_id 중복 (user_roles_gitlab_user_id_key unique constraint)
    op.drop_index('ix_user_roles_gitlab_user_id', table_name='user_roles', if_exists=True)


def downgrade():
    pass  # 중복 인덱스는 복구 불필요
