"""KB articles: tags 컬럼 추가 + FTS 인덱스

Revision ID: 0015
Revises: 0014
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kb_articles",
        sa.Column("tags", ARRAY(sa.String()), nullable=False, server_default="{}"),
    )
    op.execute("CREATE INDEX ix_kb_tags ON kb_articles USING GIN(tags)")
    op.execute(
        "CREATE INDEX ix_kb_fts ON kb_articles "
        "USING GIN(to_tsvector('simple', title || ' ' || content))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_fts")
    op.execute("DROP INDEX IF EXISTS ix_kb_tags")
    op.drop_column("kb_articles", "tags")
