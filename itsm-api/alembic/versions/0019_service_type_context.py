"""service_types: add context_label and context_options

Revision ID: 0019
Revises: 0018
Create Date: 2026-03-05 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("service_types", sa.Column("context_label", sa.String(100), nullable=True))
    op.add_column("service_types", sa.Column("context_options", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"))

    # Seed existing default types with their hardcoded context values
    op.execute("""
        UPDATE service_types SET context_label = '장비 유형',
            context_options = ARRAY['데스크탑','노트북','프린터','모니터','키보드/마우스','기타']
        WHERE value = 'hardware'
    """)
    op.execute("""
        UPDATE service_types SET context_label = '프로그램',
            context_options = ARRAY['MS Office','ERP','CRM','그룹웨어','기타 소프트웨어']
        WHERE value = 'software'
    """)
    op.execute("""
        UPDATE service_types SET context_label = '증상',
            context_options = ARRAY['인터넷 연결 불가','VPN 접속 오류','공유폴더 접근 불가','속도 저하','기타']
        WHERE value = 'network'
    """)
    op.execute("""
        UPDATE service_types SET context_label = '시스템',
            context_options = ARRAY['Windows 로그인','그룹웨어','ERP','GitLab','이메일','기타']
        WHERE value = 'account'
    """)


def downgrade() -> None:
    op.drop_column("service_types", "context_options")
    op.drop_column("service_types", "context_label")
