from datetime import datetime, timezone
from sqlalchemy import Column, Index, Integer, BigInteger, String, Text, DateTime, Boolean, Date, Time, func
from sqlalchemy.dialects.postgresql import JSONB, INET, ARRAY
from .database import Base


class Rating(Base):
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, index=True)
    gitlab_issue_iid = Column(Integer, nullable=False, index=True)
    username = Column(String(100), nullable=False)
    employee_name = Column(String(100), nullable=False)
    employee_email = Column(String(200))
    score = Column(Integer, nullable=False)  # 1~5
    comment = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_ratings_issue_username", "gitlab_issue_iid", "username", unique=True),
    )


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    gitlab_user_id = Column(Integer, nullable=False, unique=True, index=True)
    username = Column(String(100), nullable=False)
    name = Column(String(200), nullable=True)
    role = Column(String(20), nullable=False, default="user")  # admin|agent|user
    is_active = Column(Boolean, nullable=False, default=True)  # GitLab 그룹 멤버 여부
    last_seen_at = Column(DateTime, nullable=True)  # 마지막 활동 시각
    avatar_url = Column(String(500), nullable=True)  # GitLab 프로필 사진 URL
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    actor_id = Column(String(50), nullable=False)
    actor_username = Column(String(100), nullable=False)
    actor_name = Column(String(200), nullable=True)
    actor_role = Column(String(20), nullable=False)
    action = Column(String(50), nullable=False)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(String(100), nullable=False)
    old_value = Column(JSONB, nullable=True)
    new_value = Column(JSONB, nullable=True)
    ip_address = Column(INET, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_actor_id", "actor_id"),
        Index("ix_audit_logs_resource_type", "resource_type"),
    )


class SLARecord(Base):
    __tablename__ = "sla_records"

    id = Column(Integer, primary_key=True, index=True)
    gitlab_issue_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    priority = Column(String(20), nullable=False)
    sla_deadline = Column(DateTime, nullable=False)
    first_response_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    reopened_at = Column(DateTime, nullable=True)
    breached = Column(Boolean, nullable=False, default=False)
    breach_notified = Column(Boolean, nullable=False, default=False)
    warning_sent = Column(Boolean, nullable=False, default=False)
    warning_sent_30min = Column(Boolean, nullable=False, default=False)
    paused_at = Column(DateTime, nullable=True)
    total_paused_seconds = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_sla_records_issue_project", "gitlab_issue_iid", "project_id", unique=True),
        Index("ix_sla_records_deadline_active", "sla_deadline"),
    )


class KBArticle(Base):
    __tablename__ = "kb_articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(300), nullable=False)
    slug = Column(String(300), nullable=False, unique=True, index=True)
    content = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)
    tags = Column(ARRAY(String), nullable=False, default=list, server_default="{}")  # F-8
    author_id = Column(String(50), nullable=False)
    author_name = Column(String(100), nullable=False)
    published = Column(Boolean, nullable=False, default=False)
    view_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class KBRevision(Base):
    """KB 문서 수정 이력 — update_article 호출 시 수정 전 내용 스냅샷."""
    __tablename__ = "kb_revisions"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, nullable=False, index=True)
    revision_number = Column(Integer, nullable=False, default=1)
    title = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(100), nullable=True)
    tags = Column(JSONB, nullable=True)
    editor_name = Column(String(200), nullable=True)
    change_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DailyStatsSnapshot(Base):
    __tablename__ = "daily_stats_snapshots"

    id = Column(Integer, primary_key=True)
    snapshot_date = Column(Date, nullable=False)
    project_id = Column(String(50), nullable=False)
    total_open = Column(Integer, nullable=False, default=0)
    total_in_progress = Column(Integer, nullable=False, default=0)
    total_closed = Column(Integer, nullable=False, default=0)
    total_new = Column(Integer, nullable=False, default=0)
    total_breached = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_daily_snapshot_date_project", "snapshot_date", "project_id", unique=True),
    )


class AssignmentRule(Base):
    __tablename__ = "assignment_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=0)
    match_category = Column(String(50), nullable=True)
    match_priority = Column(String(20), nullable=True)
    match_keyword = Column(String(200), nullable=True)
    assignee_gitlab_id = Column(Integer, nullable=False)
    assignee_name = Column(String(100), nullable=False)
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(BigInteger, primary_key=True)
    recipient_id = Column(String(50), nullable=False)
    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(500), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_notifications_recipient_unread", "recipient_id", "is_read", "created_at"),
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    gitlab_user_id = Column(String(50), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    gitlab_refresh_token = Column(Text, nullable=True)
    device_name = Column(String(255), nullable=True)   # User-Agent 기반
    ip_address = Column(String(45), nullable=True)
    last_used_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_refresh_tokens_user_active", "gitlab_user_id", "revoked", "expires_at"),
    )


class TicketTemplate(Base):
    __tablename__ = "ticket_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=True)
    description = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TicketLink(Base):
    __tablename__ = "ticket_links"

    id = Column(Integer, primary_key=True, index=True)
    source_iid = Column(Integer, nullable=False)
    target_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    link_type = Column(String(20), nullable=False)  # related|blocks|duplicate_of
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_ticket_links_source", "source_iid", "project_id"),
    )


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(Integer, primary_key=True, index=True)
    issue_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    agent_id = Column(String(50), nullable=False)
    agent_name = Column(String(100), nullable=False)
    minutes = Column(Integer, nullable=False)
    description = Column(String(500), nullable=True)
    logged_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_time_entries_issue_project", "issue_iid", "project_id"),
    )


class ProjectForward(Base):
    __tablename__ = "project_forwards"

    id = Column(Integer, primary_key=True, index=True)
    source_iid = Column(Integer, nullable=False)
    source_project_id = Column(String(50), nullable=False)
    target_project_id = Column(String(50), nullable=False)
    target_project_name = Column(String(200), nullable=False)
    target_iid = Column(Integer, nullable=False)
    target_web_url = Column(String(500), nullable=True)
    note = Column(Text, nullable=True)
    created_by = Column(String(50), nullable=False)
    created_by_name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_project_forwards_source", "source_iid", "source_project_id"),
    )


class SLAPolicy(Base):
    """F-1: SLA policy configuration stored in DB."""
    __tablename__ = "sla_policies"

    id = Column(Integer, primary_key=True, index=True)
    priority = Column(String(20), nullable=False, unique=True)
    response_hours = Column(Integer, nullable=False)
    resolve_hours = Column(Integer, nullable=False)
    updated_by = Column(String(50), nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SavedFilter(Base):
    """F-13: User-saved filter presets."""
    __tablename__ = "saved_filters"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False)  # index via __table_args__
    name = Column(String(100), nullable=False)
    filters = Column(JSONB, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_saved_filters_username", "username"),
    )


class GuestToken(Base):
    """Guest portal tracking token for non-GitLab users."""
    __tablename__ = "guest_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), nullable=False, unique=True, index=True)
    email = Column(String(255), nullable=False)
    ticket_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class QuickReply(Base):
    """Agent quick-reply (canned response) templates."""
    __tablename__ = "quick_replies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TicketWatcher(Base):
    """Users subscribed to ticket notifications."""
    __tablename__ = "ticket_watchers"

    id = Column(Integer, primary_key=True, index=True)
    ticket_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    user_id = Column(String(50), nullable=False)
    user_email = Column(String(255), nullable=True)
    user_name = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_ticket_watchers_ticket", "ticket_iid", "project_id"),
        Index("ix_ticket_watchers_user_ticket", "user_id", "ticket_iid", "project_id", unique=True),
    )


class EmailTemplate(Base):
    """관리자가 편집 가능한 이메일 알림 템플릿."""
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(50), nullable=False, unique=True)  # ticket_created 등
    subject = Column(String(300), nullable=False)
    html_body = Column(Text, nullable=False)   # Jinja2 템플릿 문자열
    enabled = Column(Boolean, nullable=False, default=True)
    updated_by = Column(String(100), nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class EscalationPolicy(Base):
    """SLA 에스컬레이션 정책 — SLA 위반 전/후 자동 에스컬레이션 규칙."""
    __tablename__ = "escalation_policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    priority = Column(String(20), nullable=True)   # 특정 우선순위에만 적용 (None=전체)
    trigger = Column(String(20), nullable=False)   # "warning" | "breach"
    delay_minutes = Column(Integer, nullable=False, default=0)  # 트리거 후 지연 분
    action = Column(String(20), nullable=False)    # "notify" | "reassign" | "upgrade_priority"
    target_user_id = Column(String(50), nullable=True)   # reassign 대상 gitlab_user_id
    target_user_name = Column(String(100), nullable=True)
    notify_email = Column(String(255), nullable=True)    # 외부 이메일 알림 대상
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class EscalationRecord(Base):
    """에스컬레이션 실행 이력 — 중복 실행 방지 및 감사용."""
    __tablename__ = "escalation_records"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(Integer, nullable=False)
    ticket_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    executed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_escalation_records_ticket_policy", "ticket_iid", "policy_id", "project_id", unique=True),
    )


class SudoToken(Base):
    """관리자 재인증 토큰 — 고위험 작업 시 10분 유효."""
    __tablename__ = "sudo_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(String(50), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    ip_address = Column(String(45), nullable=True)


class ResolutionNote(Base):
    """티켓 해결 노트 — resolved/closed 전환 시 기록."""
    __tablename__ = "resolution_notes"

    id = Column(Integer, primary_key=True, index=True)
    ticket_iid = Column(Integer, nullable=False, index=True)
    project_id = Column(String(50), nullable=False)
    note = Column(Text, nullable=False)
    resolution_type = Column(String(30), nullable=True)  # permanent_fix|workaround|no_action|duplicate|by_mr
    created_by = Column(String(50), nullable=False)
    created_by_name = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    kb_article_id = Column(Integer, nullable=True)  # KB 아티클로 변환 시 연결


class ApiKey(Base):
    """외부 시스템 연동용 API 키 — Bearer 토큰 인증."""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    key_prefix = Column(String(16), nullable=False, index=True)   # 식별용 prefix
    key_hash = Column(String(64), nullable=False, unique=True)    # SHA-256 해시
    scopes = Column(JSONB, nullable=False, default=list)           # ["tickets:read", ...]
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, nullable=False, default=False)


class OutboundWebhook(Base):
    """아웃바운드 웹훅 — ITSM 이벤트를 외부 시스템(Slack/Teams/ERP)에 전달."""
    __tablename__ = "outbound_webhooks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    url = Column(String(500), nullable=False)
    secret = Column(String(200), nullable=True)      # HMAC-SHA256 서명용
    events = Column(JSONB, nullable=False)            # ["ticket_created", "status_changed", ...]
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_triggered_at = Column(DateTime, nullable=True)
    last_status = Column(Integer, nullable=True)     # 마지막 HTTP 응답 코드


class ServiceType(Base):
    """Dynamic service type (category) managed by admins."""
    __tablename__ = "service_types"

    id = Column(Integer, primary_key=True, index=True)
    value = Column(String(50), nullable=False, unique=True)   # internal key (sequential id string)
    label = Column(String(100), nullable=False)               # display name, e.g. '하드웨어'
    description = Column(String(100), nullable=True)          # subtitle, e.g. 'hardware'
    emoji = Column(String(10), nullable=False, default='📋')
    color = Column(String(20), nullable=False, default='#6699cc')
    sort_order = Column(Integer, nullable=False, default=0)
    enabled = Column(Boolean, nullable=False, default=True)
    context_label = Column(String(100), nullable=True)        # e.g. '장비 유형'
    context_options = Column(ARRAY(String), nullable=False, default=list)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class NotificationPref(Base):
    """사용자별 알림 수신 설정."""
    __tablename__ = "notification_prefs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), nullable=False, unique=True, index=True)
    # prefs: {event_type: {email: bool, inapp: bool}}
    prefs = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime, nullable=True)


class Announcement(Base):
    """시스템 공지사항 — 모든 로그인 사용자에게 배너로 표시."""
    __tablename__ = "announcements"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)
    type = Column(String(20), nullable=False, default="info")  # info|warning|critical
    enabled = Column(Boolean, nullable=False, default=True)
    expires_at = Column(DateTime, nullable=True)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SystemSetting(Base):
    """시스템 전역 설정 — 관리자가 런타임에 변경 가능한 키-값 저장소."""
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    updated_by = Column(String(100), nullable=True)
    updated_at = Column(DateTime, nullable=True)


class BusinessHoursConfig(Base):
    """업무 시간 설정 — SLA 기한 계산에 사용되는 요일별 업무 시간."""
    __tablename__ = "business_hours_config"

    id = Column(Integer, primary_key=True)
    day_of_week = Column(Integer, nullable=False)   # 0=월, 1=화, ..., 6=일
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)


class BusinessHoliday(Base):
    """공휴일 — SLA 계산에서 제외되는 날짜."""
    __tablename__ = "business_holidays"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, unique=True)
    name = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class HolidayYear(Base):
    """공휴일 관리 UI에서 활성화된 연도 탭 목록."""
    __tablename__ = "holiday_years"

    year = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IpAllowlistEntry(Base):
    """IP 접근 허용 목록 — 관리자 API 접근 허용 CIDR 목록."""
    __tablename__ = "ip_allowlist"

    id = Column(Integer, primary_key=True)
    cidr = Column(String(50), nullable=False, unique=True)   # e.g. "10.0.0.0/8"
    label = Column(String(200), nullable=True)               # 메모
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CustomFieldDef(Base):
    """커스텀 필드 정의 — 관리자가 정의하는 추가 티켓 필드."""
    __tablename__ = "custom_field_defs"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)  # machine key
    label = Column(String(200), nullable=False)              # 표시 이름
    field_type = Column(String(20), nullable=False, default="text")  # text|number|select|checkbox
    options = Column(ARRAY(String), nullable=False, default=list, server_default="{}")  # select 타입 옵션
    required = Column(Boolean, nullable=False, default=False)
    enabled = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TicketCustomValue(Base):
    """티켓별 커스텀 필드 값."""
    __tablename__ = "ticket_custom_values"

    id = Column(Integer, primary_key=True)
    gitlab_issue_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    field_id = Column(Integer, nullable=False)  # FK → custom_field_defs.id
    value = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_ticket_custom_values_issue", "gitlab_issue_iid", "project_id", "field_id", unique=True),
    )


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    # Trigger events: ticket.created, ticket.status_changed, ticket.assigned, ticket.priority_changed, ticket.commented
    trigger_event = Column(String(50), nullable=False)
    # Conditions: [{"field": "priority", "operator": "eq", "value": "high"}, ...]
    conditions = Column(JSONB, nullable=False, server_default="[]")
    # Actions: [{"type": "set_status", "value": "in_progress"}, {"type": "assign", "value": "username"}, {"type": "notify", "value": "assignee"}, {"type": "add_label", "value": "urgent"}, {"type": "send_slack", "value": "channel"}]
    actions = Column(JSONB, nullable=False, server_default="[]")
    is_active = Column(Boolean, nullable=False, default=True)
    order = Column(Integer, nullable=False, default=0)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_automation_rules_active", "is_active", "order"),
    )


class AutomationLog(Base):
    __tablename__ = "automation_logs"

    id = Column(Integer, primary_key=True)
    rule_id = Column(Integer, nullable=True)  # SET NULL on rule delete
    rule_name = Column(String(200), nullable=False)
    ticket_iid = Column(Integer, nullable=False)
    project_id = Column(String(100), nullable=True)
    trigger_event = Column(String(50), nullable=False)
    matched = Column(Boolean, nullable=False, default=True)
    actions_taken = Column(JSONB, nullable=True)
    error = Column(Text, nullable=True)
    triggered_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_automation_logs_rule_id", "rule_id"),
        Index("ix_automation_logs_ticket_iid", "ticket_iid"),
        Index("ix_automation_logs_triggered_at", "triggered_at"),
    )


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    ticket_iid = Column(Integer, nullable=False, index=True)
    project_id = Column(String(50), nullable=False)
    requester_username = Column(String(100), nullable=False)
    requester_name = Column(String(200), nullable=True)
    approver_username = Column(String(100), nullable=True)  # None = any agent/admin
    approver_name = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending, approved, rejected
    reason = Column(Text, nullable=True)  # Rejection reason or approval notes
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_approval_requests_ticket", "ticket_iid", "project_id"),
        Index("ix_approval_requests_status", "status"),
    )


class TicketTypeMeta(Base):
    __tablename__ = "ticket_type_meta"

    id = Column(Integer, primary_key=True, index=True)
    ticket_iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    # incident | service_request | change | problem
    ticket_type = Column(String(30), nullable=False, default="incident")
    created_by = Column(String(100), nullable=True)
    updated_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_ticket_type_meta_ticket", "ticket_iid", "project_id", unique=True),
    )


class ServiceCatalogItem(Base):
    __tablename__ = "service_catalog_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    icon = Column(String(10), nullable=True)
    # fields_schema: [{"name": "location", "label": "설치 위치", "type": "text", "required": true}, ...]
    fields_schema = Column(JSONB, nullable=False, server_default="[]")
    is_active = Column(Boolean, nullable=False, default=True)
    order = Column(Integer, nullable=False, default=0)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_service_catalog_items_active", "is_active", "order"),
    )


class FaqItem(Base):
    """자주 묻는 질문(FAQ) 항목."""
    __tablename__ = "faq_items"

    id = Column(Integer, primary_key=True, index=True)
    question = Column(String(500), nullable=False)
    answer = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)
    order_num = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_faq_items_active_order", "is_active", "order_num"),
    )


class UserDashboardConfig(Base):
    __tablename__ = "user_dashboard_configs"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False, unique=True)
    # widgets: [{"id": "stats_bar", "visible": true, "order": 0}, ...]
    widgets = Column(JSONB, nullable=False, server_default="[]")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_user_dashboard_configs_username", "username", unique=True),
    )


class TicketSearchIndex(Base):
    """GitLab 이슈 제목·설명 전문검색 색인 (pg_trgm + GIN 인덱스).

    웹훅(Issue Hook) 이벤트로 실시간 동기화되며,
    주기적 Celery 태스크로 GitLab과 전체 동기화한다.
    """
    __tablename__ = "ticket_search_index"

    id = Column(Integer, primary_key=True, index=True)
    iid = Column(Integer, nullable=False)
    project_id = Column(String(50), nullable=False)
    title = Column(Text, nullable=False, default="")
    description_text = Column(Text, nullable=True)  # markdown 제거한 plain text
    state = Column(String(20), nullable=False, default="opened")
    labels_json = Column(JSONB, nullable=False, server_default="[]")
    assignee_username = Column(String(100), nullable=True)
    created_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    synced_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                       onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("uq_ticket_search_iid_project", "iid", "project_id", unique=True),
        # pg_trgm GIN 인덱스 — LIKE '%q%' 및 % 연산자 고속 처리
        Index("ix_ticket_search_title_trgm", "title",
              postgresql_using="gin",
              postgresql_ops={"title": "gin_trgm_ops"}),
        Index("ix_ticket_search_desc_trgm", "description_text",
              postgresql_using="gin",
              postgresql_ops={"description_text": "gin_trgm_ops"}),
    )
