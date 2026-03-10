"""refresh_tokens table

Revision ID: 0009
Revises: 0008
Create Date: 2024-01-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("gitlab_user_id", sa.String(50), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_tokens_id", "refresh_tokens", ["id"])
    op.create_index("ix_refresh_tokens_hash", "refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_refresh_tokens_user", "refresh_tokens", ["gitlab_user_id"])


def downgrade() -> None:
    op.drop_index("ix_refresh_tokens_user", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_hash", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
