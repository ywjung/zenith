"""ticket_templates table

Revision ID: 0010
Revises: 0009
Create Date: 2024-01-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ticket_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_templates_id", "ticket_templates", ["id"])


def downgrade() -> None:
    op.drop_index("ix_ticket_templates_id", table_name="ticket_templates")
    op.drop_table("ticket_templates")
