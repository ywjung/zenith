"""Quick reply templates and ticket watchers

Revision ID: 0027
Revises: 0026
Create Date: 2026-03-07

"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "quick_replies",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column("created_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "ticket_watchers",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("ticket_iid", sa.Integer, nullable=False),
        sa.Column("project_id", sa.String(50), nullable=False),
        sa.Column("user_id", sa.String(50), nullable=False),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("user_name", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_ticket_watchers_ticket", "ticket_watchers",
        ["ticket_iid", "project_id"],
    )
    op.create_index(
        "ix_ticket_watchers_user_ticket", "ticket_watchers",
        ["user_id", "ticket_iid", "project_id"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_ticket_watchers_user_ticket", "ticket_watchers")
    op.drop_index("ix_ticket_watchers_ticket", "ticket_watchers")
    op.drop_table("ticket_watchers")
    op.drop_table("quick_replies")
