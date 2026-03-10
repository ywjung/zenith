"""Add escalation_policies and escalation_records tables

Revision ID: 0029
Revises: 0028
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "escalation_policies",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("priority", sa.String(20), nullable=True),
        sa.Column("trigger", sa.String(20), nullable=False),
        sa.Column("delay_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("target_user_id", sa.String(50), nullable=True),
        sa.Column("target_user_name", sa.String(100), nullable=True),
        sa.Column("notify_email", sa.String(255), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "escalation_records",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("ticket_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("ticket_iid", "policy_id", "project_id",
                            name="uq_escalation_records_ticket_policy"),
    )


def downgrade():
    op.drop_table("escalation_records")
    op.drop_table("escalation_policies")
