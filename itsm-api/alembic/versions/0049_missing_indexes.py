"""Add missing indexes for assignment_rules.enabled and kb_articles.published.

Revision ID: 0049
Revises: 0048
Create Date: 2026-03-17
"""
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import text
    op.execute(text("CREATE INDEX IF NOT EXISTS ix_assignment_rules_enabled ON assignment_rules (enabled)"))
    op.execute(text("CREATE INDEX IF NOT EXISTS ix_kb_articles_published ON kb_articles (published)"))


def downgrade():
    op.drop_index("ix_assignment_rules_enabled", table_name="assignment_rules")
    op.drop_index("ix_kb_articles_published", table_name="kb_articles")
