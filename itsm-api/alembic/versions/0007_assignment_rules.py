"""assignment_rules table

Revision ID: 0007
Revises: 0006
Create Date: 2024-01-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assignment_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("match_category", sa.String(50), nullable=True),
        sa.Column("match_priority", sa.String(20), nullable=True),
        sa.Column("match_keyword", sa.String(200), nullable=True),
        sa.Column("assignee_gitlab_id", sa.Integer(), nullable=False),
        sa.Column("assignee_name", sa.String(100), nullable=False),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assignment_rules_id", "assignment_rules", ["id"])
    op.create_index("ix_assignment_rules_enabled", "assignment_rules", ["enabled", "priority"])


def downgrade() -> None:
    op.drop_index("ix_assignment_rules_enabled", table_name="assignment_rules")
    op.drop_index("ix_assignment_rules_id", table_name="assignment_rules")
    op.drop_table("assignment_rules")
