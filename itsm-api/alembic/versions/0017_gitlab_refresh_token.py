"""add gitlab_refresh_token to refresh_tokens

Revision ID: 0017
Revises: 0016
Create Date: 2026-03-05 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column("gitlab_refresh_token", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("refresh_tokens", "gitlab_refresh_token")
