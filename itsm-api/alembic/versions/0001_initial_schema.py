"""initial schema

Revision ID: 0001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ratings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gitlab_issue_iid", sa.Integer(), nullable=False),
        sa.Column("employee_name", sa.String(100), nullable=False),
        sa.Column("employee_email", sa.String(200), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ratings_id", "ratings", ["id"])
    op.create_index("ix_ratings_gitlab_issue_iid", "ratings", ["gitlab_issue_iid"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_ratings_gitlab_issue_iid", table_name="ratings")
    op.drop_index("ix_ratings_id", table_name="ratings")
    op.drop_table("ratings")
