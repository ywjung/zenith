"""Saved filters: 사용자 필터 즐겨찾기

Revision ID: 0016
Revises: 0015
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_filters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("filters", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("username", "name", name="uq_saved_filters_username_name"),
    )
    op.create_index("ix_saved_filters_username", "saved_filters", ["username"])


def downgrade() -> None:
    op.drop_index("ix_saved_filters_username")
    op.drop_table("saved_filters")
