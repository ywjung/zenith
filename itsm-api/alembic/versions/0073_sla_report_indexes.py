"""SLA 리포트 성능: created_at / resolved_at 단독 인덱스 추가

DORA·SLA준수·주간 리포트는 sla_records.created_at / resolved_at 단독 필터를
사용하는데, 기존 복합 인덱스(project_id, resolved_at, breached)는 선행 컬럼이
project_id라 이 필터를 못 탄다. 테이블이 커질수록 순차 스캔이 발생하므로
단독 인덱스를 추가한다.

Revision ID: 0073
Revises: 0072
Create Date: 2026-06-01
"""
from alembic import op

revision = '0073'
down_revision = '0072'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index('ix_sla_records_created_at', 'sla_records', ['created_at'])
    op.create_index('ix_sla_records_resolved_at', 'sla_records', ['resolved_at'])


def downgrade():
    op.drop_index('ix_sla_records_resolved_at', table_name='sla_records')
    op.drop_index('ix_sla_records_created_at', table_name='sla_records')
