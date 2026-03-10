"""sla_records table

Revision ID: 0004
Revises: 0003
Create Date: 2024-01-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sla_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gitlab_issue_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("sla_deadline", sa.DateTime(), nullable=False),
        sa.Column("first_response_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("breached", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("breach_notified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gitlab_issue_iid", "project_id", name="uq_sla_issue_project"),
    )
    op.create_index("ix_sla_records_id", "sla_records", ["id"])
    op.create_index(
        "ix_sla_deadline",
        "sla_records",
        ["sla_deadline"],
        postgresql_where=sa.text("NOT breached"),
    )


def downgrade() -> None:
    op.drop_index("ix_sla_deadline", table_name="sla_records")
    op.drop_index("ix_sla_records_id", table_name="sla_records")
    op.drop_table("sla_records")
