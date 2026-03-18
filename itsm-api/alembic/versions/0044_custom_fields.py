"""add custom_field_defs and ticket_custom_values tables

Revision ID: 0044
Revises: 0043
Create Date: 2026-03-15
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = '0044'
down_revision = '0043'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    existing = conn.execute(
        sa.text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='custom_field_defs'")
    ).fetchone()
    if existing:
        return  # tables already created; just mark migration as applied

    op.create_table(
        'custom_field_defs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False, unique=True),
        sa.Column('label', sa.String(200), nullable=False),
        sa.Column('field_type', sa.String(20), nullable=False, server_default='text'),
        sa.Column('options', ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('required', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.String(100), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'ticket_custom_values',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('gitlab_issue_iid', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.String(50), nullable=False),
        sa.Column('field_id', sa.Integer(), nullable=False),
        sa.Column('value', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        'ix_ticket_custom_values_issue',
        'ticket_custom_values',
        ['gitlab_issue_iid', 'project_id', 'field_id'],
        unique=True,
    )


def downgrade():
    op.drop_index('ix_ticket_custom_values_issue', table_name='ticket_custom_values')
    op.drop_table('ticket_custom_values')
    op.drop_table('custom_field_defs')
