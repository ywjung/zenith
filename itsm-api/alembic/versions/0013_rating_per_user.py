"""rating per user: username 컬럼 추가, 유니크 제약 변경

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # username 컬럼 추가 (기존 행은 'unknown' 으로 채움)
    op.add_column("ratings", sa.Column("username", sa.String(100), nullable=True))
    op.execute("UPDATE ratings SET username = 'unknown' WHERE username IS NULL")
    op.alter_column("ratings", "username", nullable=False)

    # updated_at 컬럼 추가
    op.add_column("ratings", sa.Column("updated_at", sa.DateTime(), nullable=True))

    # 기존 gitlab_issue_iid 단독 unique 인덱스 제거
    op.drop_index("ix_ratings_gitlab_issue_iid", table_name="ratings")

    # (gitlab_issue_iid, username) 복합 unique 인덱스 추가
    op.create_index(
        "ix_ratings_issue_username",
        "ratings",
        ["gitlab_issue_iid", "username"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_ratings_issue_username", table_name="ratings")
    op.create_index("ix_ratings_gitlab_issue_iid", "ratings", ["gitlab_issue_iid"], unique=True)
    op.drop_column("ratings", "updated_at")
    op.drop_column("ratings", "username")
