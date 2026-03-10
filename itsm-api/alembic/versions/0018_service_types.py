"""service types table

Revision ID: 0018
Revises: 0017
Create Date: 2026-03-05 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "service_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("value", sa.String(50), nullable=False, unique=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("emoji", sa.String(10), nullable=False, server_default="📋"),
        sa.Column("color", sa.String(20), nullable=False, server_default="#6699cc"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.execute("""
        INSERT INTO service_types (value, label, emoji, color, sort_order, enabled) VALUES
        ('hardware', '하드웨어',  '🖥️', '#e67e22', 10, true),
        ('software', '소프트웨어','💻', '#3498db', 20, true),
        ('network',  '네트워크',  '🌐', '#27ae60', 30, true),
        ('account',  '계정/권한', '👤', '#9b59b6', 40, true),
        ('other',    '기타',      '📋', '#95a5a6', 50, true)
    """)


def downgrade() -> None:
    op.drop_table("service_types")
