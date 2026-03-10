"""kb_articles table

Revision ID: 0005
Revises: 0004
Create Date: 2024-01-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kb_articles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("slug", sa.String(300), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("author_id", sa.String(50), nullable=False),
        sa.Column("author_name", sa.String(100), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_kb_articles_id", "kb_articles", ["id"])
    op.create_index("ix_kb_articles_slug", "kb_articles", ["slug"], unique=True)
    op.create_index("ix_kb_articles_published", "kb_articles", ["published"])


def downgrade() -> None:
    op.drop_index("ix_kb_articles_published", table_name="kb_articles")
    op.drop_index("ix_kb_articles_slug", table_name="kb_articles")
    op.drop_index("ix_kb_articles_id", table_name="kb_articles")
    op.drop_table("kb_articles")
