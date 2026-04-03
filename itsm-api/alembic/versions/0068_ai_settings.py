"""ai_settings table

Revision ID: 0068
Revises: 0067
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("provider", sa.String(20), nullable=False, server_default="openai"),
        sa.Column("openai_api_key", sa.Text(), nullable=True),
        sa.Column("openai_model", sa.String(100), nullable=False, server_default="gpt-4o-mini"),
        sa.Column("ollama_base_url", sa.String(200), nullable=False, server_default="http://ollama:11434"),
        sa.Column("ollama_model", sa.String(100), nullable=False, server_default="llama3.2"),
        sa.Column("feature_classify", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("feature_summarize", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("feature_kb_suggest", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO ai_settings (id, enabled) VALUES (1, false)")


def downgrade():
    op.drop_table("ai_settings")
