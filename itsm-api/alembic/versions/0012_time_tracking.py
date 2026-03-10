"""time_entries table

Revision ID: 0012
Revises: 0011
Create Date: 2024-01-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "time_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("issue_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("agent_id", sa.String(50), nullable=False),
        sa.Column("agent_name", sa.String(100), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("logged_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_time_entries_id", "time_entries", ["id"])
    op.create_index("ix_time_entries_issue", "time_entries", ["issue_iid", "project_id"])


def downgrade() -> None:
    op.drop_index("ix_time_entries_issue", table_name="time_entries")
    op.drop_index("ix_time_entries_id", table_name="time_entries")
    op.drop_table("time_entries")
