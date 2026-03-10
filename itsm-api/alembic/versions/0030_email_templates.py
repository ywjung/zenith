"""Add email_templates table with default templates

Revision ID: 0030
Revises: 0029
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from datetime import datetime

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

_DEFAULTS = [
    (
        "ticket_created",
        "[ITSM] 새 티켓이 등록됐습니다 - #{{ iid }}",
        """<h2>새 티켓이 등록됐습니다</h2>
<p><strong>티켓 번호:</strong> #{{ iid }}</p>
<p><strong>제목:</strong> {{ title }}</p>
<p><strong>신청자:</strong> {{ employee_name }}</p>
<p><strong>우선순위:</strong> {{ priority }}</p>
<p><strong>카테고리:</strong> {{ category }}</p>
{% if description %}
<p><strong>내용:</strong><br>{{ description }}</p>
{% endif %}
<p><a href="{{ portal_url }}">티켓 상세 보기</a></p>""",
    ),
    (
        "status_changed",
        "[ITSM] 티켓 #{{ iid }} 상태 변경: {{ old_status }} → {{ new_status }}",
        """<h2>티켓 상태가 변경됐습니다</h2>
<p><strong>티켓 번호:</strong> #{{ iid }}</p>
<p><strong>제목:</strong> {{ title }}</p>
<p><strong>변경 전:</strong> {{ old_status }}</p>
<p><strong>변경 후:</strong> {{ new_status }}</p>
<p><a href="{{ portal_url }}">티켓 상세 보기</a></p>""",
    ),
    (
        "comment_added",
        "[ITSM] 티켓 #{{ iid }}에 새 댓글이 달렸습니다",
        """<h2>새 댓글이 등록됐습니다</h2>
<p><strong>티켓 번호:</strong> #{{ iid }}</p>
<p><strong>제목:</strong> {{ title }}</p>
<p><strong>작성자:</strong> {{ author_name }}</p>
<p><strong>내용:</strong><br>{{ comment_preview }}</p>
<p><a href="{{ portal_url }}">티켓 상세 보기</a></p>""",
    ),
    (
        "sla_warning",
        "[ITSM] SLA 임박 경고 - 티켓 #{{ iid }} ({{ minutes_left }}분 남음)",
        """<h2>⏰ SLA 기한이 임박했습니다</h2>
<p><strong>티켓 번호:</strong> #{{ iid }}</p>
<p><strong>남은 시간:</strong> {{ minutes_left }}분</p>
<p>즉시 처리가 필요합니다.</p>
<p><a href="{{ portal_url }}">티켓 상세 보기</a></p>""",
    ),
    (
        "sla_breach",
        "[ITSM] SLA 위반 - 티켓 #{{ iid }}",
        """<h2>🚨 SLA 기한이 초과됐습니다</h2>
<p><strong>티켓 번호:</strong> #{{ iid }}</p>
<p>SLA 기한을 초과했습니다. 즉시 조치가 필요합니다.</p>
<p><a href="{{ portal_url }}">티켓 상세 보기</a></p>""",
    ),
]


def upgrade():
    op.create_table(
        "email_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_type", sa.String(50), nullable=False, unique=True),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("html_body", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("updated_by", sa.String(100), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    # 기본 템플릿 삽입
    now = datetime.utcnow()
    op.bulk_insert(
        sa.table(
            "email_templates",
            sa.column("event_type", sa.String),
            sa.column("subject", sa.String),
            sa.column("html_body", sa.Text),
            sa.column("enabled", sa.Boolean),
            sa.column("updated_at", sa.DateTime),
        ),
        [
            {"event_type": et, "subject": subj, "html_body": body, "enabled": True, "updated_at": now}
            for et, subj, body in _DEFAULTS
        ],
    )


def downgrade():
    op.drop_table("email_templates")
