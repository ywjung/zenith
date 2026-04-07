"""SLA 대시보드 성능 최적화: 복합 인덱스 추가

Revision ID: 0071
Revises: 0070
Create Date: 2026-04-07
"""
from alembic import op

revision = '0071'
down_revision = '0070'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_sla_records_active_project",
        "sla_records",
        ["project_id", "resolved_at", "breached"],
    )


def downgrade():
    op.drop_index("ix_sla_records_active_project", table_name="sla_records")
