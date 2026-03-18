"""Add ticket_type_meta, service_catalog_items, user_dashboard_configs tables.

Revision ID: 0047
Revises: 0046
Create Date: 2026-03-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ticket_type_meta",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_iid", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("ticket_type", sa.String(30), nullable=False, server_default="incident"),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.Column("updated_by", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_type_meta_id", "ticket_type_meta", ["id"])
    op.create_index(
        "ix_ticket_type_meta_ticket", "ticket_type_meta",
        ["ticket_iid", "project_id"], unique=True,
    )

    op.create_table(
        "service_catalog_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column(
            "fields_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default="[]",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(100), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_service_catalog_items_id", "service_catalog_items", ["id"])
    op.create_index(
        "ix_service_catalog_items_active", "service_catalog_items",
        ["is_active", "order"],
    )

    op.create_table(
        "user_dashboard_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column(
            "widgets",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default="[]",
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_dashboard_configs_id", "user_dashboard_configs", ["id"])
    op.create_index(
        "ix_user_dashboard_configs_username", "user_dashboard_configs",
        ["username"], unique=True,
    )


def downgrade():
    op.drop_table("user_dashboard_configs")
    op.drop_table("service_catalog_items")
    op.drop_table("ticket_type_meta")
