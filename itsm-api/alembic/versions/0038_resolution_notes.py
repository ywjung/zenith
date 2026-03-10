"""Add resolution_notes table for ticket close/resolve workflow

Revision ID: 0038
Revises: 0037
Create Date: 2026-03-09

resolved/closed 전환 시 해결 방법을 기록하고 KB 변환을 지원한다.
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "resolution_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticket_iid", sa.Integer(), nullable=False, index=True),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("resolution_type", sa.String(30), nullable=True),  # permanent_fix|workaround|...
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_by_name", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("kb_article_id", sa.Integer(), nullable=True),   # KB 변환 시 연결
    )
    op.create_index(
        "ix_resolution_notes_ticket",
        "resolution_notes", ["ticket_iid", "project_id"]
    )


def downgrade():
    op.drop_index("ix_resolution_notes_ticket", table_name="resolution_notes")
    op.drop_table("resolution_notes")
