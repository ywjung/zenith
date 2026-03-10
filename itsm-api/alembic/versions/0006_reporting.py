"""daily_stats_snapshots table

Revision ID: 0006
Revises: 0005
Create Date: 2024-01-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_stats_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("total_open", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_in_progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_closed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_new", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_breached", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_date", "project_id", name="uq_daily_stats"),
    )
    op.create_index("ix_daily_stats_date", "daily_stats_snapshots", ["snapshot_date"])


def downgrade() -> None:
    op.drop_index("ix_daily_stats_date", table_name="daily_stats_snapshots")
    op.drop_table("daily_stats_snapshots")
