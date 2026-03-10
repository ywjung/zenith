"""audit_logs: add actor_name column

Revision ID: 0020
Revises: 0019
Create Date: 2026-03-05 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("actor_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "actor_name")
