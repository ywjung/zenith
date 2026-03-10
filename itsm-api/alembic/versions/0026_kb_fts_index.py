"""KB full-text search GIN index

Revision ID: 0026
Revises: 0025
Create Date: 2026-03-07

"""
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

# GIN 인덱스는 트랜잭션 외부에서 생성해야 CONCURRENTLY 사용 가능
# alembic에서는 transaction_per_migration=False 가 필요하므로
# 일반 CREATE INDEX(non-concurrent)를 사용한다.
def upgrade():
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_fts "
        "ON kb_articles USING GIN "
        "(to_tsvector('simple', title || ' ' || content))"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_kb_articles_fts")
