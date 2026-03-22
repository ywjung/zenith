"""feat: KB 문서 버전 이력 테이블 추가

Revision ID: 0054_kb_revisions
Revises: 0053_pg_trgm
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0054_kb_revisions"
down_revision = "0053_pg_trgm"


def upgrade() -> None:
    op.create_table(
        "kb_revisions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("article_id", sa.Integer, sa.ForeignKey("kb_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_number", sa.Integer, nullable=False, default=1),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("tags", sa.JSON, nullable=True),
        sa.Column("editor_name", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_kb_revisions_article_id", "kb_revisions", ["article_id"])
    op.create_index("ix_kb_revisions_article_rev", "kb_revisions", ["article_id", "revision_number"])


def downgrade() -> None:
    op.drop_index("ix_kb_revisions_article_rev", "kb_revisions")
    op.drop_index("ix_kb_revisions_article_id", "kb_revisions")
    op.drop_table("kb_revisions")
