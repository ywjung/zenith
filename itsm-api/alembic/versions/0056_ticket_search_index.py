"""ticket_search_index 테이블 생성 — 전문검색 색인 (pg_trgm GIN)

Revision ID: 0056_ticket_search_index
Revises: 0055_automation_logs
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0056_ticket_search_index"
down_revision = "0055_automation_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticket_search_index",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("description_text", sa.Text(), nullable=True),
        sa.Column("state", sa.String(20), nullable=False, server_default="opened"),
        sa.Column("labels_json", JSONB, nullable=False, server_default="[]"),
        sa.Column("assignee_username", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_index(
        "uq_ticket_search_iid_project",
        "ticket_search_index",
        ["iid", "project_id"],
        unique=True,
    )

    # pg_trgm GIN 인덱스 (0053 마이그레이션에서 pg_trgm 확장이 이미 설치됨)
    op.execute(
        "CREATE INDEX ix_ticket_search_title_trgm "
        "ON ticket_search_index USING gin(title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_ticket_search_desc_trgm "
        "ON ticket_search_index USING gin(description_text gin_trgm_ops)"
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_search_desc_trgm", "ticket_search_index")
    op.drop_index("ix_ticket_search_title_trgm", "ticket_search_index")
    op.drop_index("uq_ticket_search_iid_project", "ticket_search_index")
    op.drop_table("ticket_search_index")
