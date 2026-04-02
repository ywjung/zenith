"""add cleanup-oriented indexes for guest_tokens and notifications

Revision ID: 0065
Revises: 0064
Create Date: 2026-03-26

인덱스 추가:
  - guest_tokens.expires_at     → 만료 토큰 정리 쿼리 (db-cleanup task)
  - notifications.created_at    → 오래된 알림 정리 쿼리
  - user_notification_rules(username, enabled)  → 규칙 조회 최적화
"""
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS 를 통해 이미 존재하는 인덱스에 대한 오류 방지
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_guest_tokens_expires_at
        ON guest_tokens (expires_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_notifications_created_at
        ON notifications (created_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_user_notification_rules_username_enabled
        ON user_notification_rules (username, enabled)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_user_notification_rules_username_enabled")
    op.execute("DROP INDEX IF EXISTS ix_notifications_created_at")
    op.execute("DROP INDEX IF EXISTS ix_guest_tokens_expires_at")
