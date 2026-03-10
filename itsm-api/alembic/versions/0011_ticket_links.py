"""ticket_links table

Revision ID: 0011
Revises: 0010
Create Date: 2024-01-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ticket_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_iid", sa.Integer(), nullable=False),
        sa.Column("target_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("link_type", sa.String(20), nullable=False),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_iid", "target_iid", "project_id", "link_type", name="uq_ticket_link"),
    )
    op.create_index("ix_ticket_links_id", "ticket_links", ["id"])
    op.create_index("ix_ticket_links_source", "ticket_links", ["source_iid", "project_id"])


def downgrade() -> None:
    op.drop_index("ix_ticket_links_source", table_name="ticket_links")
    op.drop_index("ix_ticket_links_id", table_name="ticket_links")
    op.drop_table("ticket_links")
