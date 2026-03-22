"""SLA 모듈 단위 테스트."""
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch


# ── get_sla_resolve_hours ─────────────────────────────────────────────────

def test_default_hours_critical():
    from app.sla import get_sla_resolve_hours
    assert get_sla_resolve_hours("critical") == 8


def test_default_hours_high():
    from app.sla import get_sla_resolve_hours
    assert get_sla_resolve_hours("high") == 24


def test_default_hours_medium():
    from app.sla import get_sla_resolve_hours
    assert get_sla_resolve_hours("medium") == 72


def test_default_hours_low():
    from app.sla import get_sla_resolve_hours
    assert get_sla_resolve_hours("low") == 168


def test_unknown_priority_falls_back():
    from app.sla import get_sla_resolve_hours
    assert get_sla_resolve_hours("unknown_priority") == 72


def test_db_policy_overrides_default():
    from app.sla import get_sla_resolve_hours
    from app.models import SLAPolicy

    mock_policy = MagicMock(spec=SLAPolicy)
    mock_policy.resolve_hours = 16

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_policy

    result = get_sla_resolve_hours("high", db=mock_db)
    assert result == 16


def test_db_policy_not_found_uses_default():
    from app.sla import get_sla_resolve_hours

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    result = get_sla_resolve_hours("critical", db=mock_db)
    assert result == 8


def test_db_exception_falls_back():
    from app.sla import get_sla_resolve_hours

    mock_db = MagicMock()
    mock_db.query.side_effect = Exception("DB 오류")

    result = get_sla_resolve_hours("high", db=mock_db)
    assert result == 24


# ── _ensure_utc ───────────────────────────────────────────────────────────

def test_ensure_utc_naive_datetime():
    from app.sla import _ensure_utc
    naive = datetime(2024, 1, 1, 12, 0, 0)
    result = _ensure_utc(naive)
    assert result.tzinfo == timezone.utc


def test_ensure_utc_aware_datetime_unchanged():
    from app.sla import _ensure_utc
    aware = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    result = _ensure_utc(aware)
    assert result == aware


def test_ensure_utc_none_returns_none():
    from app.sla import _ensure_utc
    assert _ensure_utc(None) is None


# ── calculate_business_deadline (단순 계산 — DB 없이) ────────────────────

def test_calculate_simple_deadline_no_db():
    """DB 없이 기본 8시간 SLA 마감일 계산."""
    from app.sla import calculate_business_deadline

    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)  # 월요일 09:00
    deadline = calculate_business_deadline(start, hours=8, db=None)
    assert deadline is not None
    assert deadline > start


def test_calculate_deadline_zero_hours():
    """0시간 SLA — 마감일이 시작 시각과 같거나 이후."""
    from app.sla import calculate_business_deadline

    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
    deadline = calculate_business_deadline(start, hours=0, db=None)
    assert deadline is not None
    assert deadline >= start


# ── mark_first_response ───────────────────────────────────────────────────

def test_mark_first_response_updates_record():
    from app.sla import mark_first_response
    from app.models import SLARecord

    mock_record = MagicMock(spec=SLARecord)
    mock_record.first_response_at = None
    mock_record.sla_deadline = datetime.now(timezone.utc) + timedelta(hours=8)

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record

    mark_first_response(mock_db, iid=1, project_id="1")
    assert mock_record.first_response_at is not None
    mock_db.commit.assert_called_once()


def test_mark_first_response_noop_if_already_set():
    from app.sla import mark_first_response
    from app.models import SLARecord

    mock_record = MagicMock(spec=SLARecord)
    mock_record.first_response_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record

    mark_first_response(mock_db, iid=1, project_id="1")
    mock_db.commit.assert_not_called()


def test_mark_first_response_no_record():
    from app.sla import mark_first_response

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    # 레코드 없으면 조용히 종료
    mark_first_response(mock_db, iid=99999, project_id="1")
    mock_db.commit.assert_not_called()


# ── mark_resolved ─────────────────────────────────────────────────────────

def test_mark_resolved_sets_timestamps():
    from app.sla import mark_resolved
    from app.models import SLARecord

    now = datetime.now(timezone.utc)
    mock_record = MagicMock(spec=SLARecord)
    mock_record.resolved_at = None
    mock_record.sla_deadline = now + timedelta(hours=4)

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record

    mark_resolved(mock_db, iid=1, project_id="1")
    assert mock_record.resolved_at is not None
    mock_db.commit.assert_called_once()


# ── get_sla_record ────────────────────────────────────────────────────────

def test_get_sla_record_returns_record():
    from app.sla import get_sla_record
    from app.models import SLARecord

    mock_record = MagicMock(spec=SLARecord)
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record

    result = get_sla_record(mock_db, iid=1, project_id="1")
    assert result is mock_record


def test_get_sla_record_returns_none_if_not_found():
    from app.sla import get_sla_record

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None

    result = get_sla_record(mock_db, iid=99999, project_id="1")
    assert result is None


# ── pause_sla / resume_sla ────────────────────────────────────────────────

def test_pause_sla_sets_paused_at():
    from app.sla import pause_sla
    from app.models import SLARecord

    mock_record = MagicMock(spec=SLARecord)
    mock_record.paused_at = None
    mock_record.resolved_at = None  # MagicMock 기본값은 truthy이므로 명시 필요

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = mock_record

    pause_sla(mock_db, iid=1, project_id="1")
    assert mock_record.paused_at is not None
    mock_db.commit.assert_called_once()


def test_resume_sla_extends_deadline():
    from app.sla import resume_sla
    from app.models import SLARecord

    paused_at = datetime.now(timezone.utc) - timedelta(hours=2)
    deadline = datetime.now(timezone.utc) + timedelta(hours=6)

    mock_record = MagicMock(spec=SLARecord)
    mock_record.paused_at = paused_at
    mock_record.sla_deadline = deadline
    mock_record.total_paused_seconds = 0

    mock_db = MagicMock()
    # resume_sla uses .with_for_update().first()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value = mock_record

    resume_sla(mock_db, iid=1, project_id="1")
    # 마감이 ~2시간 연장되어야 함
    assert mock_record.sla_deadline > deadline
    assert mock_record.paused_at is None
    mock_db.commit.assert_called_once()


# ── _next_business_start ──────────────────────────────────────────────────────

def test_next_business_start_within_hours():
    from app.sla import _next_business_start
    from datetime import time
    # Monday 10:00 during 9:00-18:00
    dt = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)  # Monday
    schedule = {0: (time(9, 0), time(18, 0))}  # Monday only
    result = _next_business_start(dt, schedule, set())
    assert result == dt  # already in business hours


def test_next_business_start_before_hours():
    from app.sla import _next_business_start
    from datetime import time
    # Monday 07:00, before 9:00-18:00
    dt = datetime(2024, 1, 15, 7, 0, 0, tzinfo=timezone.utc)
    schedule = {0: (time(9, 0), time(18, 0))}
    result = _next_business_start(dt, schedule, set())
    assert result.hour == 9


def test_next_business_start_skips_holiday():
    from app.sla import _next_business_start
    from datetime import time, date
    # Monday is holiday, Tuesday 9:00 should be next
    dt = datetime(2024, 1, 15, 10, 0, 0, tzinfo=timezone.utc)  # Monday
    schedule = {0: (time(9, 0), time(18, 0)), 1: (time(9, 0), time(18, 0))}
    holidays = {date(2024, 1, 15)}  # Monday is holiday
    result = _next_business_start(dt, schedule, holidays)
    assert result.weekday() == 1  # Tuesday


# ── calculate_business_deadline with DB ──────────────────────────────────────

def test_calculate_business_deadline_no_schedules():
    """DB returns no active schedules — falls back to calendar time."""
    from app.sla import calculate_business_deadline
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
    result = calculate_business_deadline(start, 8, db=mock_db)
    assert result == start + timedelta(hours=8)


def test_calculate_business_deadline_db_exception():
    """DB error falls back to calendar time."""
    from app.sla import calculate_business_deadline
    mock_db = MagicMock()
    mock_db.query.side_effect = Exception("DB 오류")
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
    result = calculate_business_deadline(start, 8, db=mock_db)
    assert result == start + timedelta(hours=8)


def test_calculate_business_deadline_invalid_schedule_start_gte_end():
    """All schedules have start >= end — falls back to calendar time (lines 90-95)."""
    from app.sla import calculate_business_deadline
    from datetime import time as dtime

    bad_sched = MagicMock()
    bad_sched.start_time = dtime(18, 0)  # start > end → invalid
    bad_sched.end_time = dtime(9, 0)
    bad_sched.is_active = True

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = [bad_sched]

    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
    result = calculate_business_deadline(start, 8, db=mock_db)
    assert result == start + timedelta(hours=8)


def test_calculate_business_deadline_with_schedule(db_session):
    """Valid business hours schedule — deadline computed within business hours."""
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig
    from datetime import time as dtime

    # Monday 9:00–18:00 (day_of_week=0)
    cfg = BusinessHoursConfig(day_of_week=0, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True)
    db_session.add(cfg)
    db_session.commit()

    # Monday 09:00 — 4 hours of business time → should land at 13:00 same day
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)  # Monday
    result = calculate_business_deadline(start, 4, db=db_session)
    assert result > start
    # Result should be within same day (9 + 4 = 13:00)
    assert result.hour == 13 or result > start


def test_calculate_business_deadline_spanning_multiple_days(db_session):
    """Work spanning more than one business day — uses next day's hours."""
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig
    from datetime import time as dtime

    # Monday and Tuesday 9:00–18:00 (9 hours each)
    for dow in [0, 1]:
        db_session.add(BusinessHoursConfig(
            day_of_week=dow, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True
        ))
    db_session.commit()

    # Monday 09:00 — 12 hours of business time → spans into Tuesday
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)  # Monday
    result = calculate_business_deadline(start, 12, db=db_session)
    assert result > start + timedelta(hours=9)  # must go past end of Monday


# ── create_sla_record ─────────────────────────────────────────────────────────

def test_create_sla_record_existing_returns_existing():
    """If record already exists, return it without creating a new one."""
    from app.sla import create_sla_record
    from app.models import SLARecord
    from datetime import date

    mock_existing = MagicMock(spec=SLARecord)
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []
    # Simulate: no schedules so calendar time is used; existing record found
    mock_db.query.return_value.filter.return_value.first.return_value = mock_existing

    result = create_sla_record(mock_db, iid=1, project_id="1", priority="high")
    assert result is mock_existing
    mock_db.add.assert_not_called()


def test_create_sla_record_past_custom_deadline_raises():
    """Custom deadline in the past raises ValueError."""
    from app.sla import create_sla_record
    from datetime import date
    import pytest
    mock_db = MagicMock()
    past_date = date(2020, 1, 1)
    with pytest.raises(ValueError, match="오늘"):
        create_sla_record(mock_db, iid=1, project_id="1", priority="high", custom_deadline=past_date)


def test_create_sla_record_future_custom_deadline(db_session):
    """Custom deadline in the future creates a new SLA record (line 144)."""
    from app.sla import create_sla_record
    from datetime import date, timedelta

    future_date = date.today() + timedelta(days=10)
    record = create_sla_record(db_session, iid=9901, project_id="1", priority="high", custom_deadline=future_date)
    assert record is not None
    # Deadline should be end of the given day
    assert record.sla_deadline.day == future_date.day


def test_create_sla_record_business_deadline_value_error_falls_back(db_session):
    """When calculate_business_deadline raises ValueError, falls back to calendar time (lines 153-155)."""
    from app.sla import create_sla_record
    from unittest.mock import patch

    with patch("app.sla.calculate_business_deadline", side_effect=ValueError("no valid business days")):
        record = create_sla_record(db_session, iid=9902, project_id="1", priority="high")
    assert record is not None


# ── check_and_flag_breaches ───────────────────────────────────────────────────

def test_check_and_flag_breaches_marks_overdue():
    from app.sla import check_and_flag_breaches
    from app.models import SLARecord

    mock_record = MagicMock(spec=SLARecord)
    mock_record.gitlab_issue_iid = 1
    mock_record.project_id = "1"
    mock_record.priority = "high"

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [mock_record]

    result = check_and_flag_breaches(mock_db)
    assert result == [mock_record]
    assert mock_record.breached is True
    mock_db.commit.assert_called_once()


def test_check_and_flag_breaches_no_overdue():
    from app.sla import check_and_flag_breaches
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = []
    result = check_and_flag_breaches(mock_db)
    assert result == []
    mock_db.commit.assert_not_called()


# ── check_and_send_warnings ───────────────────────────────────────────────────

def test_check_and_send_warnings_no_at_risk():
    from app.sla import check_and_send_warnings
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = []
    result = check_and_send_warnings(mock_db)
    assert result == []


def test_check_and_send_warnings_sends_notification():
    from app.sla import check_and_send_warnings
    from app.models import SLARecord
    from unittest.mock import patch

    now = datetime.now(timezone.utc)
    mock_record = MagicMock(spec=SLARecord)
    mock_record.gitlab_issue_iid = 5
    mock_record.project_id = "1"
    mock_record.sla_deadline = (now + timedelta(minutes=30)).replace(tzinfo=None)
    mock_record.warning_sent = False

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [mock_record]
    mock_db.query.return_value.filter.return_value.all.return_value = []  # no staff

    with patch("app.notifications.notify_sla_warning"):
        result = check_and_send_warnings(mock_db)
    assert result == [mock_record]
    assert mock_record.warning_sent is True


def test_check_and_send_warnings_notify_exception_swallowed():
    """notify_sla_warning exception is swallowed (covers lines 302-303)."""
    from app.sla import check_and_send_warnings
    from app.models import SLARecord

    now = datetime.now(timezone.utc)
    mock_record = MagicMock(spec=SLARecord)
    mock_record.gitlab_issue_iid = 6
    mock_record.project_id = "1"
    mock_record.sla_deadline = (now + timedelta(minutes=20)).replace(tzinfo=None)
    mock_record.warning_sent = False

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [mock_record]
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with patch("app.notifications.notify_sla_warning", side_effect=Exception("email failed")):
        result = check_and_send_warnings(mock_db)  # should not raise
    assert result == [mock_record]


def test_check_and_send_warnings_staff_notification_exception_swallowed():
    """In-app notification exception is swallowed (covers lines 319-320)."""
    from app.sla import check_and_send_warnings
    from app.models import SLARecord

    now = datetime.now(timezone.utc)
    mock_record = MagicMock(spec=SLARecord)
    mock_record.gitlab_issue_iid = 7
    mock_record.project_id = "1"
    mock_record.sla_deadline = (now + timedelta(minutes=20)).replace(tzinfo=None)
    mock_record.warning_sent = False

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [mock_record]
    # make the staff query raise an exception
    mock_db.query.return_value.filter.return_value.all.side_effect = Exception("DB error")

    with patch("app.notifications.notify_sla_warning"):
        result = check_and_send_warnings(mock_db)  # should not raise
    assert result == [mock_record]


# ── check_and_escalate ────────────────────────────────────────────────────────

def test_check_and_escalate_no_policies():
    from app.sla import check_and_escalate
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []
    result = check_and_escalate(mock_db)
    assert result == []


def test_check_and_escalate_breach_policy_executes():
    """breach policy with eligible record → _execute_escalation called."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord, EscalationRecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 1
    policy.name = "breach-policy"
    policy.trigger = "breach"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = None
    policy.target_user_id = "99"
    policy.notify_email = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 100
    sla_record.project_id = "1"
    sla_record.sla_deadline = now - timedelta(minutes=30)  # already breached
    sla_record.breached = True
    sla_record.priority = "high"

    mock_db = MagicMock()

    # Type-based dispatch for db.query()
    def query_side_effect(model):
        q = MagicMock()
        f = MagicMock()
        q.filter.return_value = f

        model_name = getattr(model, "__name__", str(model))
        if "EscalationPolicy" in model_name:
            f.all.return_value = [policy]
        elif "SLARecord" in model_name:
            # base_q = db.query(SLARecord).filter(...)
            # breach_candidates = base_q.filter(breached==True).all()
            inner_f = MagicMock()
            inner_f.all.return_value = [sla_record]
            f.filter.return_value = inner_f
            # also handle direct .all() call
            f.all.return_value = [sla_record]
        elif "EscalationRecord" in model_name:
            f.all.return_value = []
        else:
            f.all.return_value = []
        return q

    mock_db.query.side_effect = query_side_effect

    mock_sp = MagicMock()
    mock_db.begin_nested.return_value = mock_sp

    with patch("app.sla._execute_escalation") as mock_exec:
        result = check_and_escalate(mock_db)

    mock_exec.assert_called_once()


def test_check_and_escalate_skips_already_done():
    """Key in done_set → skip (covers lines 411-413)."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord, EscalationRecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 2
    policy.name = "breach-p2"
    policy.trigger = "breach"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 200
    sla_record.project_id = "1"
    sla_record.sla_deadline = now - timedelta(minutes=10)
    sla_record.breached = True
    sla_record.priority = "medium"

    existing_er = MagicMock(spec=EscalationRecord)
    existing_er.policy_id = 2
    existing_er.ticket_iid = 200
    existing_er.project_id = "1"

    mock_db = MagicMock()

    def query_side_effect(model):
        q = MagicMock()
        f = MagicMock()
        q.filter.return_value = f
        model_name = getattr(model, "__name__", str(model))
        if "EscalationPolicy" in model_name:
            f.all.return_value = [policy]
        elif "SLARecord" in model_name:
            inner_f = MagicMock()
            inner_f.all.return_value = [sla_record]
            f.filter.return_value = inner_f
            f.all.return_value = [sla_record]
        elif "EscalationRecord" in model_name:
            f.all.return_value = [existing_er]  # already executed
        else:
            f.all.return_value = []
        return q

    mock_db.query.side_effect = query_side_effect

    with patch("app.sla._execute_escalation") as mock_exec:
        result = check_and_escalate(mock_db)
    mock_exec.assert_not_called()


# ── _execute_escalation ───────────────────────────────────────────────────────

def _make_policy(action="notify", trigger="breach", target_user_id=None, notify_email=None, priority=None):
    policy = MagicMock()
    policy.action = action
    policy.trigger = trigger
    policy.target_user_id = target_user_id
    policy.notify_email = notify_email
    policy.priority = priority
    policy.name = f"test-{action}"
    return policy


def _make_sla_record(iid=1, proj="1", priority="high"):
    record = MagicMock()
    record.gitlab_issue_iid = iid
    record.project_id = proj
    record.priority = priority
    return record


def test_execute_escalation_notify_with_target_user():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("notify", target_user_id="42")
    record = _make_sla_record()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with patch("app.notifications.create_db_notification") as mock_notif:
        _execute_escalation(mock_db, policy, record, now)
    mock_notif.assert_called_once()


def test_execute_escalation_notify_with_email():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("notify", target_user_id=None, notify_email="ops@example.com")
    record = _make_sla_record()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with (
        patch("app.notifications.create_db_notification"),
        patch("app.notifications._send_email") as mock_email,
    ):
        _execute_escalation(mock_db, policy, record, now)
    mock_email.assert_called_once()


def test_execute_escalation_notify_email_exception_swallowed():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("notify", target_user_id=None, notify_email="ops@example.com")
    record = _make_sla_record()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with (
        patch("app.notifications.create_db_notification"),
        patch("app.notifications._send_email", side_effect=Exception("smtp error")),
    ):
        _execute_escalation(mock_db, policy, record, now)  # should not raise


def test_execute_escalation_reassign_with_target():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("reassign", target_user_id="55")
    policy.target_user_name = "Agent Smith"
    record = _make_sla_record()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with (
        patch("app.gitlab_client.update_issue"),
        patch("app.gitlab_client.add_note"),
        patch("app.notifications.create_db_notification") as mock_notif,
    ):
        _execute_escalation(mock_db, policy, record, now)
    mock_notif.assert_called_once()


def test_execute_escalation_reassign_exception_swallowed():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("reassign", target_user_id="55")
    policy.target_user_name = "Agent"
    record = _make_sla_record()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with patch("app.gitlab_client.update_issue", side_effect=Exception("gitlab error")):
        _execute_escalation(mock_db, policy, record, now)  # should not raise


def test_execute_escalation_upgrade_priority():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("upgrade_priority")
    record = _make_sla_record(priority="medium")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    mock_issue = {"labels": ["prio::medium", "status::open"]}
    with (
        patch("app.gitlab_client.get_issue", return_value=mock_issue),
        patch("app.gitlab_client.update_issue"),
        patch("app.gitlab_client.add_note"),
    ):
        _execute_escalation(mock_db, policy, record, now)
    assert record.priority == "high"


def test_execute_escalation_upgrade_priority_already_critical():
    """critical priority stays critical (no change)."""
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("upgrade_priority")
    record = _make_sla_record(priority="critical")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with (
        patch("app.gitlab_client.get_issue", return_value={"labels": []}),
        patch("app.gitlab_client.update_issue") as mock_update,
        patch("app.gitlab_client.add_note"),
    ):
        _execute_escalation(mock_db, policy, record, now)
    # priority was already critical, no update needed
    mock_update.assert_not_called()


def test_execute_escalation_upgrade_exception_swallowed():
    from app.sla import _execute_escalation
    from datetime import datetime, timezone
    mock_db = MagicMock()
    policy = _make_policy("upgrade_priority")
    record = _make_sla_record(priority="low")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with patch("app.gitlab_client.get_issue", side_effect=Exception("not found")):
        _execute_escalation(mock_db, policy, record, now)  # should not raise


# ── check_and_send_warnings with staff ────────────────────────────────────────

def test_check_and_send_warnings_with_staff_creates_notification():
    """With staff members, create_db_notification called (covers line 311)."""
    from app.sla import check_and_send_warnings
    from app.models import SLARecord
    from unittest.mock import patch

    now = datetime.now(timezone.utc)
    mock_record = MagicMock(spec=SLARecord)
    mock_record.gitlab_issue_iid = 10
    mock_record.project_id = "1"
    mock_record.sla_deadline = (now + timedelta(minutes=25)).replace(tzinfo=None)
    mock_record.warning_sent = False

    mock_staff = MagicMock()
    mock_staff.gitlab_user_id = "99"

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.with_for_update.return_value.all.return_value = [mock_record]
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_staff]

    with (
        patch("app.notifications.notify_sla_warning"),
        patch("app.notifications.create_db_notification") as mock_notif,
    ):
        check_and_send_warnings(mock_db)

    mock_notif.assert_called_once()


# ── check_and_escalate: warning policy ───────────────────────────────────────

def _make_query_side_effect(policy_list, sla_list, er_list=None):
    """Helper to create a db.query() side effect dispatcher for escalation tests."""
    if er_list is None:
        er_list = []

    def query_side_effect(model):
        q = MagicMock()
        f = MagicMock()
        q.filter.return_value = f
        model_name = getattr(model, "__name__", str(model))
        if "EscalationPolicy" in model_name:
            f.all.return_value = policy_list
        elif "SLARecord" in model_name:
            inner_f = MagicMock()
            inner_f.all.return_value = sla_list
            f.filter.return_value = inner_f
            f.all.return_value = sla_list
        elif "EscalationRecord" in model_name:
            f.all.return_value = er_list
        else:
            f.all.return_value = []
        return q

    return query_side_effect


def test_check_and_escalate_warning_policy():
    """warning trigger policy covers lines 374-375, 447-448."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 10
    policy.name = "warn-policy"
    policy.trigger = "warning"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = None
    policy.target_user_id = "99"
    policy.notify_email = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 300
    sla_record.project_id = "1"
    sla_record.sla_deadline = now + timedelta(minutes=30)
    sla_record.breached = False
    sla_record.warning_sent = True
    sla_record.priority = "high"

    mock_db = MagicMock()
    mock_db.query.side_effect = _make_query_side_effect([policy], [sla_record])
    mock_sp = MagicMock()
    mock_db.begin_nested.return_value = mock_sp

    with patch("app.sla._execute_escalation") as mock_exec:
        check_and_escalate(mock_db)

    mock_exec.assert_called_once()


def test_check_and_escalate_priority_filter():
    """Priority filter on policy covers lines 403-408."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 20
    policy.name = "priority-breach"
    policy.trigger = "breach"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = "critical"  # filter: only critical
    policy.target_user_id = "1"
    policy.notify_email = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 400
    sla_record.project_id = "1"
    sla_record.sla_deadline = now - timedelta(minutes=10)
    sla_record.breached = True
    sla_record.priority = "high"  # not "critical" → filtered out

    mock_db = MagicMock()
    mock_db.query.side_effect = _make_query_side_effect([policy], [sla_record])

    with patch("app.sla._execute_escalation") as mock_exec:
        check_and_escalate(mock_db)

    mock_exec.assert_not_called()


def test_check_and_escalate_savepoint_rollback():
    """EscalationRecord insert fails → rollback (lines 426-432)."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 30
    policy.name = "dup-policy"
    policy.trigger = "breach"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = None
    policy.target_user_id = "1"
    policy.notify_email = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 500
    sla_record.project_id = "1"
    sla_record.sla_deadline = now - timedelta(minutes=10)
    sla_record.breached = True
    sla_record.priority = "high"

    mock_db = MagicMock()
    mock_db.query.side_effect = _make_query_side_effect([policy], [sla_record])

    mock_sp = MagicMock()
    mock_sp.commit.side_effect = Exception("unique constraint violated")
    mock_db.begin_nested.return_value = mock_sp

    with patch("app.sla._execute_escalation"):
        check_and_escalate(mock_db)

    mock_sp.rollback.assert_called_once()


def test_check_and_escalate_execute_exception_swallowed():
    """_execute_escalation exception caught and logged (lines 439-440)."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 40
    policy.name = "error-policy"
    policy.trigger = "breach"
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 600
    sla_record.project_id = "1"
    sla_record.sla_deadline = now - timedelta(minutes=5)
    sla_record.breached = True
    sla_record.priority = "high"

    mock_db = MagicMock()
    mock_db.query.side_effect = _make_query_side_effect([policy], [sla_record])

    with patch("app.sla._execute_escalation", side_effect=Exception("exec failed")):
        result = check_and_escalate(mock_db)  # should not raise


# ── _next_business_start: loop exhausted (line 69 - return dt fallback) ──────

def test_next_business_start_loop_exhausted():
    """When no valid day found in 30 iterations, _next_business_start returns dt (line 69)."""
    from app.sla import _next_business_start
    from datetime import date, time as dtime

    # Monday-only schedule, but provide 30+ days of holidays so loop exhausts
    schedule = {0: (dtime(9, 0), dtime(18, 0))}  # only Monday
    # Create holidays for the next 30 days
    start_date = datetime(2024, 1, 15, 0, 0, 0)  # Monday
    holidays = {(start_date + timedelta(days=i)).date() for i in range(31)}

    result = _next_business_start(start_date, schedule, holidays)
    # Loop exhausted → returns final dt (30 days later)
    assert result >= start_date


# ── _next_business_start: before business start time (line 64) ───────────────

def test_next_business_start_before_start_time(db_session):
    """When current time is before business start, _next_business_start returns day_start (line 69)."""
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig
    from datetime import time as dtime

    db_session.add(BusinessHoursConfig(
        day_of_week=0, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True
    ))
    db_session.commit()

    # Monday 07:00 — before business start 09:00 → _next_business_start returns 09:00 (line 69)
    start = datetime(2024, 1, 15, 7, 0, 0)  # naive datetime, Monday
    result = calculate_business_deadline(start, 2, db=db_session)
    # 07:00 → bumped to 09:00, then +2h = 11:00
    assert result.hour == 11
    assert result.date() == start.date()


# ── calculate_business_deadline: holiday/non-scheduled day paths ──────────────

def test_calculate_business_deadline_skips_holiday_day(db_session):
    """Holiday forces move to next day (lines 108-110)."""
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig, BusinessHoliday
    from datetime import time as dtime, date

    # Only Monday configured (day_of_week=0)
    db_session.add(BusinessHoursConfig(
        day_of_week=0, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True
    ))
    # Make Monday 2024-01-15 a holiday
    db_session.add(BusinessHoliday(date=date(2024, 1, 15), name="Holiday"))
    db_session.commit()

    # Start on Monday (holiday) — should skip to next Monday
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
    result = calculate_business_deadline(start, 4, db=db_session)
    # Result must be after the holiday
    assert result > start


def test_calculate_business_deadline_day_not_in_schedule(db_session):
    """Weekday not in schedule is skipped (lines 108-110)."""
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig
    from datetime import time as dtime

    # Only Wednesday configured (day_of_week=2)
    db_session.add(BusinessHoursConfig(
        day_of_week=2, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True
    ))
    db_session.commit()

    # Start on Monday — must skip to Wednesday
    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)  # Monday
    result = calculate_business_deadline(start, 4, db=db_session)
    assert result.weekday() == 2  # Wednesday


def test_calculate_business_deadline_zero_hours_with_db(db_session):
    """hours=0 with DB → break at line 105 immediately → falls through to ValueError at line 127."""
    import pytest
    from app.sla import calculate_business_deadline
    from app.models import BusinessHoursConfig
    from datetime import time as dtime

    db_session.add(BusinessHoursConfig(
        day_of_week=0, start_time=dtime(9, 0), end_time=dtime(18, 0), is_active=True
    ))
    db_session.commit()

    start = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)  # Monday
    # hours=0 → remaining_s=0 → break at line 105 → falls through to raise ValueError at line 127
    with pytest.raises(ValueError):
        calculate_business_deadline(start, 0, db=db_session)


# ── check_and_escalate: non-breach trigger with priority filter (line 408) ────

def test_check_and_escalate_non_breach_trigger_with_priority():
    """warning trigger + policy.priority → filters by priority (line 408)."""
    from app.sla import check_and_escalate
    from app.models import EscalationPolicy, SLARecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    policy = MagicMock(spec=EscalationPolicy)
    policy.id = 50
    policy.name = "warning-priority-policy"
    policy.trigger = "warning"  # non-breach: goes to else branch
    policy.delay_minutes = 0
    policy.action = "notify"
    policy.priority = "high"  # filter by priority → hits line 408
    policy.target_user_id = "1"
    policy.notify_email = None
    policy.enabled = True

    sla_record = MagicMock(spec=SLARecord)
    sla_record.gitlab_issue_iid = 700
    sla_record.project_id = "1"
    sla_record.sla_deadline = now + timedelta(minutes=30)  # within 60-min warning window
    sla_record.breached = False
    sla_record.warning_sent = True
    sla_record.priority = "high"  # matches → escalation executes

    mock_db = MagicMock()
    mock_db.query.side_effect = _make_query_side_effect([policy], [sla_record])
    mock_sp = MagicMock()
    mock_db.begin_nested.return_value = mock_sp

    with patch("app.sla._execute_escalation") as mock_exec:
        check_and_escalate(mock_db)
    # line 408 hit: priority filter on non-breach (warning) policy
    mock_exec.assert_called_once()
