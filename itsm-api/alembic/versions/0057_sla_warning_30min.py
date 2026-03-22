"""sla_records 테이블에 warning_sent_30min 컬럼 추가

30분 임박 경고를 별도 플래그로 관리하여 60분/30분 이중 경고를 지원한다.

Revision ID: 0057_sla_warning_30min
Revises: 0056_ticket_search_index
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0057_sla_warning_30min"
down_revision = "0056_ticket_search_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sla_records",
        sa.Column(
            "warning_sent_30min",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.create_index(
        "ix_sla_records_warning_30min",
        "sla_records",
        ["warning_sent_30min"],
    )


def downgrade() -> None:
    op.drop_index("ix_sla_records_warning_30min", table_name="sla_records")
    op.drop_column("sla_records", "warning_sent_30min")
