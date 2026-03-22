"""feat: pg_trgm 확장 및 trigram GIN 인덱스 추가 (KB 한국어 부분 매칭 개선)

Revision ID: 0053_pg_trgm
Revises: 0052_perf_indexes
Create Date: 2026-03-20
"""
from alembic import op

revision = "0053_pg_trgm"
down_revision = "0052_perf_indexes"


def upgrade() -> None:
    # pg_trgm 확장 활성화
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # kb_articles title + content 트라이그램 GIN 인덱스
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_title_trgm "
        "ON kb_articles USING GIN (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kb_articles_content_trgm "
        "ON kb_articles USING GIN (content gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_articles_content_trgm")
    op.execute("DROP INDEX IF EXISTS ix_kb_articles_title_trgm")
    # 확장은 다른 오브젝트가 사용할 수 있으므로 제거하지 않음
