"""Add faq_items table.

Revision ID: 0049
Revises: 0048
Create Date: 2026-03-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "faq_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_faq_items_id", "faq_items", ["id"])
    op.create_index("ix_faq_items_active_order", "faq_items", ["is_active", "order_num"])


def downgrade():
    op.drop_index("ix_faq_items_active_order", table_name="faq_items")
    op.drop_index("ix_faq_items_id", table_name="faq_items")
    op.drop_table("faq_items")
