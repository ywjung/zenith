"""Make audit_logs table immutable via PostgreSQL trigger

Revision ID: 0036
Revises: 0035
Create Date: 2026-03-08

audit_logs 테이블에 UPDATE/DELETE를 차단하는 PostgreSQL 트리거를 추가한다.
감사 로그의 무결성을 보장하여 증거 인멸을 방지한다 (보안/규정 준수).
"""
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    # 트리거 함수: UPDATE/DELETE 시도 시 예외 발생
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'audit_logs 테이블은 수정/삭제할 수 없습니다. (무결성 정책)'
                USING ERRCODE = 'restrict_violation';
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # UPDATE 차단 트리거
    op.execute("""
        CREATE TRIGGER audit_logs_no_update
            BEFORE UPDATE ON audit_logs
            FOR EACH ROW
            EXECUTE FUNCTION prevent_audit_log_modification();
    """)

    # DELETE 차단 트리거
    op.execute("""
        CREATE TRIGGER audit_logs_no_delete
            BEFORE DELETE ON audit_logs
            FOR EACH ROW
            EXECUTE FUNCTION prevent_audit_log_modification();
    """)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;")
    op.execute("DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_log_modification();")
