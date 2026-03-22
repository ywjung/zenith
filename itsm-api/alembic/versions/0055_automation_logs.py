"""feat: 자동화 규칙 실행 이력 테이블 추가

Revision ID: 0055_automation_logs
Revises: 0054_kb_revisions
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0055_automation_logs"
down_revision = "0054_kb_revisions"


def upgrade() -> None:
    op.create_table(
        "automation_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "rule_id",
            sa.Integer,
            sa.ForeignKey("automation_rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rule_name", sa.String(200), nullable=False),
        sa.Column("ticket_iid", sa.Integer, nullable=False),
        sa.Column("project_id", sa.String(100), nullable=True),
        sa.Column("trigger_event", sa.String(50), nullable=False),
        # matched_conditions: 조건 충족 시 True/False 결과 목록
        sa.Column("matched", sa.Boolean, nullable=False, default=True),
        # actions_taken: [{"type": "set_status", "value": "in_progress", "ok": true}]
        sa.Column("actions_taken", sa.JSON, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_automation_logs_rule_id", "automation_logs", ["rule_id"])
    op.create_index("ix_automation_logs_ticket_iid", "automation_logs", ["ticket_iid"])
    op.create_index("ix_automation_logs_triggered_at", "automation_logs", ["triggered_at"])


def downgrade() -> None:
    op.drop_index("ix_automation_logs_triggered_at", "automation_logs")
    op.drop_index("ix_automation_logs_ticket_iid", "automation_logs")
    op.drop_index("ix_automation_logs_rule_id", "automation_logs")
    op.drop_table("automation_logs")
