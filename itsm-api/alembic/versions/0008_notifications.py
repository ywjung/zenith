"""notifications table

Revision ID: 0008
Revises: 0007
Create Date: 2024-01-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("recipient_id", sa.String(50), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("link", sa.String(500), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notifications_recipient",
        "notifications",
        ["recipient_id", "is_read", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_recipient", table_name="notifications")
    op.drop_table("notifications")
