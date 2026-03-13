"""add unique index to daily_stats_snapshots

Revision ID: 0042
Revises: 0041
Create Date: 2026-03-13
"""
from alembic import op

revision = '0042'
down_revision = '0041'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_daily_snapshot_date_project',
        'daily_stats_snapshots',
        ['snapshot_date', 'project_id'],
        unique=True,
    )


def downgrade():
    op.drop_index('ix_daily_snapshot_date_project', table_name='daily_stats_snapshots')
