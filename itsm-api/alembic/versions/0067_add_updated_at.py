"""add updated_at to sla_records and notifications

Revision ID: 0067
Revises: 0066
Create Date: 2026-03-26

SLA 상태 변경 및 알림 읽음 처리 시각을 추적하기 위한 updated_at 컬럼 추가.
기존 레코드는 created_at 값으로 초기화.
"""
from alembic import op
import sqlalchemy as sa

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # sla_records
    op.add_column(
        "sla_records",
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=True,
            server_default=sa.text("NOW()"),
        ),
    )
    # 기존 데이터: created_at 값 복사
    op.execute(
        "UPDATE sla_records SET updated_at = created_at WHERE updated_at IS NULL"
    )
    op.create_index("ix_sla_records_updated_at", "sla_records", ["updated_at"])

    # notifications
    op.add_column(
        "notifications",
        sa.Column(
            "updated_at",
            sa.DateTime,
            nullable=True,
            server_default=sa.text("NOW()"),
        ),
    )
    op.execute(
        "UPDATE notifications SET updated_at = created_at WHERE updated_at IS NULL"
    )
    op.create_index("ix_notifications_updated_at", "notifications", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_updated_at", table_name="notifications")
    op.drop_column("notifications", "updated_at")
    op.drop_index("ix_sla_records_updated_at", table_name="sla_records")
    op.drop_column("sla_records", "updated_at")
