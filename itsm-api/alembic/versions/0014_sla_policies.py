"""SLA policies: DB화 (하드코딩 제거)

Revision ID: 0014
Revises: 0013
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sla_policies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("priority", sa.String(20), nullable=False, unique=True),
        sa.Column("response_hours", sa.Integer(), nullable=False),
        sa.Column("resolve_hours", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.String(50), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.execute("""
        INSERT INTO sla_policies (priority, response_hours, resolve_hours) VALUES
            ('critical', 4, 8),
            ('high', 8, 24),
            ('medium', 24, 72),
            ('low', 48, 168)
    """)


def downgrade() -> None:
    op.drop_table("sla_policies")
