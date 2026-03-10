"""rbac user_roles table

Revision ID: 0002
Revises: 0001
Create Date: 2024-01-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gitlab_user_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gitlab_user_id"),
    )
    op.create_index("ix_user_roles_id", "user_roles", ["id"])
    op.create_index("ix_user_roles_gitlab_user_id", "user_roles", ["gitlab_user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_user_roles_gitlab_user_id", table_name="user_roles")
    op.drop_index("ix_user_roles_id", table_name="user_roles")
    op.drop_table("user_roles")
