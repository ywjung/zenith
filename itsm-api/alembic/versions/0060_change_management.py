"""change_management 테이블 생성

ITIL 기반 변경 관리 (RFC) 워크플로우.
상태: draft → submitted → reviewing → approved/rejected → implementing → implemented/failed/cancelled

Revision ID: 0060_change_management
Revises: 0059_recurring_tickets
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0060_change_management"
down_revision = "0059_recurring_tickets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "change_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # 변경 유형: standard(사전 승인된 정형 변경), normal(CAB 심의 필요), emergency(긴급)
        sa.Column("change_type", sa.String(20), nullable=False, server_default="normal"),
        # 위험도: low, medium, high, critical
        sa.Column("risk_level", sa.String(20), nullable=False, server_default="medium"),
        # 상태 머신
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        # 티켓 연결 (관련 인시던트/서비스 요청)
        sa.Column("related_ticket_iid", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.String(50), nullable=False),
        # 구현 일정
        sa.Column("scheduled_start_at", sa.DateTime(), nullable=True),
        sa.Column("scheduled_end_at", sa.DateTime(), nullable=True),
        sa.Column("actual_start_at", sa.DateTime(), nullable=True),
        sa.Column("actual_end_at", sa.DateTime(), nullable=True),
        # 롤백 계획
        sa.Column("rollback_plan", sa.Text(), nullable=True),
        # 영향 범위
        sa.Column("impact", sa.Text(), nullable=True),
        # 요청자
        sa.Column("requester_username", sa.String(100), nullable=False),
        sa.Column("requester_name", sa.String(200), nullable=True),
        # 승인자
        sa.Column("approver_username", sa.String(100), nullable=True),
        sa.Column("approver_name", sa.String(200), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("approval_comment", sa.Text(), nullable=True),
        # 구현 담당자
        sa.Column("implementer_username", sa.String(100), nullable=True),
        # 결과 메모 (implemented/failed 시 작성)
        sa.Column("result_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_requests_id", "change_requests", ["id"])
    op.create_index("ix_change_requests_status", "change_requests", ["status"])
    op.create_index("ix_change_requests_requester", "change_requests", ["requester_username"])
    op.create_index("ix_change_requests_created_at", "change_requests", ["created_at"])
    op.create_index("ix_change_requests_scheduled_start", "change_requests", ["scheduled_start_at"])


def downgrade() -> None:
    op.drop_index("ix_change_requests_scheduled_start", table_name="change_requests")
    op.drop_index("ix_change_requests_created_at", table_name="change_requests")
    op.drop_index("ix_change_requests_requester", table_name="change_requests")
    op.drop_index("ix_change_requests_status", table_name="change_requests")
    op.drop_index("ix_change_requests_id", table_name="change_requests")
    op.drop_table("change_requests")
