"""SLA tracking logic."""
import logging
from datetime import datetime, timedelta, timezone, date
from typing import Optional

from sqlalchemy.orm import Session

from .models import SLARecord, SLAPolicy, BusinessHoursConfig, BusinessHoliday

logger = logging.getLogger(__name__)

# F-1: Fallback SLA hours when DB policy not available
_SLA_HOURS_DEFAULT = {
    "critical": 8,
    "high": 24,
    "medium": 72,
    "low": 168,
}


def get_sla_resolve_hours(priority: str, db: Optional[Session] = None) -> int:
    """Return SLA resolve hours for the given priority.

    Reads from the sla_policies table when db is provided; falls back to defaults.
    """
    if db is not None:
        try:
            policy = db.query(SLAPolicy).filter(SLAPolicy.priority == priority).first()
            if policy:
                return policy.resolve_hours
        except Exception as e:
            logger.warning("Failed to fetch SLA policy from DB: %s", e)
    return _SLA_HOURS_DEFAULT.get(priority, 72)


# Keep for backward compat
SLA_HOURS = _SLA_HOURS_DEFAULT


def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Return dt with UTC tzinfo attached; naive datetimes are assumed UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── 업무시간 기반 SLA 마감일 계산 ────────────────────────────────────────────

def _next_business_start(
    dt: datetime,
    schedule: dict,   # {day_of_week: (start_time, end_time)}
    holidays: set,    # set of date objects
) -> datetime:
    """dt가 업무 시간 내면 그대로, 아니면 다음 업무 시간 시작으로 전진한다."""
    for _ in range(30):
        dow = dt.weekday()
        if dow in schedule and dt.date() not in holidays:
            s_t, e_t = schedule[dow]
            day_start = dt.replace(hour=s_t.hour, minute=s_t.minute, second=0, microsecond=0)
            day_end   = dt.replace(hour=e_t.hour, minute=e_t.minute, second=0, microsecond=0)
            if dt < day_start:
                return day_start
            if dt < day_end:
                return dt
        # 다음 날 00:00 으로 이동
        dt = (dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return dt


def calculate_business_deadline(
    start: datetime,
    hours: float,
    db: Optional[Session] = None,
) -> datetime:
    """start 기준 업무시간으로 hours 만큼 후의 마감일을 반환한다.

    DB에 업무시간 설정이 없으면 캘린더 타임(24/7)으로 폴백한다.
    """
    if db is None:
        return start + timedelta(hours=hours)

    try:
        schedules = db.query(BusinessHoursConfig).filter(BusinessHoursConfig.is_active.is_(True)).all()
        if not schedules:
            return start + timedelta(hours=hours)

        # start_time >= end_time인 잘못된 설정은 제외 — 무한 루프 방지
        valid_schedules = [s for s in schedules if s.start_time < s.end_time]
        if not valid_schedules:
            logger.warning("Business hours config has no valid entries (start < end), falling back to 24/7")
            return start + timedelta(hours=hours)
        schedule = {s.day_of_week: (s.start_time, s.end_time) for s in valid_schedules}
        holidays = {h.date for h in db.query(BusinessHoliday).all()}
    except Exception as e:
        logger.warning("Failed to load business hours config: %s", e)
        return start + timedelta(hours=hours)

    remaining_s = hours * 3600.0
    current = _next_business_start(start, schedule, holidays)

    for _ in range(365):   # 최대 1년 순회 (안전 장치)
        if remaining_s <= 0:
            break
        dow = current.weekday()
        if dow not in schedule or current.date() in holidays:
            current = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            current = _next_business_start(current, schedule, holidays)
            continue

        _, e_t = schedule[dow]
        day_end = current.replace(hour=e_t.hour, minute=e_t.minute, second=0, microsecond=0)
        available_s = (day_end - current).total_seconds()
        if available_s <= 0:
            current = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            current = _next_business_start(current, schedule, holidays)
            continue

        if remaining_s <= available_s:
            return current + timedelta(seconds=remaining_s)

        remaining_s -= available_s
        current = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        current = _next_business_start(current, schedule, holidays)

    raise ValueError(
        "SLA 마감일을 계산할 수 없습니다: 비즈니스 시간 스케줄에 유효한 근무일이 없습니다"
    )


def create_sla_record(
    db: Session,
    iid: int,
    project_id: str,
    priority: str,
    custom_deadline: Optional[date] = None,
) -> SLARecord:
    if custom_deadline:
        today = datetime.now(timezone.utc).date()
        if custom_deadline < today:
            raise ValueError(f"SLA 기한은 오늘({today}) 이후 날짜여야 합니다.")
        # End-of-day (23:59:59) on the requested date in local time (naive)
        deadline_naive = datetime(
            custom_deadline.year, custom_deadline.month, custom_deadline.day,
            23, 59, 59,
        )
    else:
        hours = get_sla_resolve_hours(priority, db)  # F-1: DB-driven
        created_now = datetime.now(timezone.utc)
        try:
            deadline = calculate_business_deadline(created_now, hours, db)
        except ValueError as e:
            logger.error("Business deadline calculation failed, using calendar fallback: %s", e)
            deadline = created_now + timedelta(hours=hours)
        deadline_naive = deadline.replace(tzinfo=None)

    existing = db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()
    if existing:
        return existing

    record = SLARecord(
        gitlab_issue_iid=iid,
        project_id=project_id,
        priority=priority,
        sla_deadline=deadline_naive,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def mark_first_response(db: Session, iid: int, project_id: str) -> None:
    record = db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()
    if record and not record.first_response_at:
        record.first_response_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()


def mark_resolved(db: Session, iid: int, project_id: str) -> None:
    record = db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()
    if record and not record.resolved_at:
        record.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()


def pause_sla(db: Session, iid: int, project_id: str) -> None:
    """Pause SLA timer for a ticket (e.g. when entering 'waiting' status)."""
    record = db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()
    if record and not record.paused_at and not record.resolved_at:
        record.paused_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        logger.info("SLA paused for ticket #%s (project %s)", iid, project_id)


def resume_sla(db: Session, iid: int, project_id: str) -> None:
    """Resume SLA timer, extending deadline by the time spent paused."""
    record = (
        db.query(SLARecord)
        .filter(
            SLARecord.gitlab_issue_iid == iid,
            SLARecord.project_id == project_id,
        )
        .with_for_update()  # prevent concurrent resume on the same record
        .first()
    )
    if record and record.paused_at:
        now_utc = datetime.now(timezone.utc)
        paused_at_utc = _ensure_utc(record.paused_at)
        pause_seconds = max(0, int((now_utc - paused_at_utc).total_seconds()))
        record.total_paused_seconds += pause_seconds
        record.sla_deadline += timedelta(seconds=pause_seconds)
        record.paused_at = None
        db.commit()
        logger.info(
            "SLA resumed for ticket #%s (project %s), paused %ds, new deadline %s",
            iid, project_id, pause_seconds, record.sla_deadline,
        )


def check_and_flag_breaches(db: Session) -> list[SLARecord]:
    """Mark SLA records past their deadline as breached. Returns newly breached records.

    Uses SELECT FOR UPDATE SKIP LOCKED to prevent duplicate processing by concurrent threads.
    Paused records are skipped (paused_at IS NOT NULL).
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    overdue = (
        db.query(SLARecord)
        .filter(
            SLARecord.breached == False,  # noqa: E712
            SLARecord.resolved_at == None,  # noqa: E711
            SLARecord.paused_at == None,  # noqa: E711 — skip paused tickets
            SLARecord.sla_deadline < now,
        )
        .with_for_update(skip_locked=True)
        .all()
    )

    for record in overdue:
        record.breached = True
        logger.warning(
            "SLA breached for ticket #%s (project %s, priority %s)",
            record.gitlab_issue_iid, record.project_id, record.priority,
        )
    if overdue:
        db.commit()
        for record in overdue:
            try:
                from .tasks import send_sla_breach as _breach_task
                _breach_task.delay(record.gitlab_issue_iid, record.project_id, None)
            except Exception:
                from .notifications import notify_sla_breach
                try:
                    notify_sla_breach(record.gitlab_issue_iid, record.project_id, None)
                except Exception as e:
                    logger.warning("Failed to send SLA breach notification for ticket #%s: %s", record.gitlab_issue_iid, e)
            # 자동화 규칙 실행 — ticket.sla_breached 이벤트
            try:
                from .routers.automation import evaluate_automation_rules
                evaluate_automation_rules(db, "ticket.sla_breached", {
                    "iid": record.gitlab_issue_iid,
                    "project_id": record.project_id,
                    "priority": record.priority,
                })
            except Exception as _ae:
                logger.warning("Automation rule eval failed on sla_breached #%s: %s", record.gitlab_issue_iid, _ae)
    return overdue


def check_and_send_warnings(db: Session, warning_minutes: int = 60) -> list[SLARecord]:
    """Send warning notifications for SLA records approaching their deadline.

    Finds active records whose deadline is within `warning_minutes` from now
    and that haven't received a warning yet. Returns the records that were warned.
    """
    from .notifications import notify_sla_warning
    from datetime import timedelta

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now + timedelta(minutes=warning_minutes)

    at_risk = (
        db.query(SLARecord)
        .filter(
            SLARecord.breached == False,  # noqa: E712
            SLARecord.resolved_at == None,  # noqa: E711
            SLARecord.warning_sent == False,  # noqa: E712
            SLARecord.paused_at == None,  # noqa: E711 — skip paused tickets
            SLARecord.sla_deadline > now,
            SLARecord.sla_deadline <= cutoff,
        )
        .with_for_update(skip_locked=True)
        .all()
    )

    # N+1 방지: staff 목록을 루프 밖에서 한 번만 조회
    from .models import UserRole
    from .notifications import create_db_notification
    try:
        staff = db.query(UserRole).filter(UserRole.role.in_(["admin", "agent"])).limit(500).all()
    except Exception as e:
        logger.warning("SLA staff lookup failed: %s", e)
        staff = []

    for record in at_risk:
        deadline_utc = _ensure_utc(record.sla_deadline)
        now_utc = datetime.now(timezone.utc)
        remaining = deadline_utc - now_utc
        minutes_left = int(remaining.total_seconds() / 60)

        # 외부 알림 전송 전에 먼저 커밋하여 중복 발송 방지
        record.warning_sent = True
        db.commit()

        try:
            try:
                from .tasks import send_sla_warning as _sla_warn_task
                _sla_warn_task.delay(record.gitlab_issue_iid, record.project_id, minutes_left)
            except Exception:
                notify_sla_warning(record.gitlab_issue_iid, record.project_id, minutes_left)
        except Exception as e:
            logger.warning("Failed to send SLA warning for ticket #%s: %s", record.gitlab_issue_iid, e)

        # In-app notification for all agents/admins
        try:
            for member in staff:
                create_db_notification(
                    db,
                    recipient_id=str(member.gitlab_user_id),
                    title=f"⏰ SLA 임박 - 티켓 #{record.gitlab_issue_iid}",
                    body=f"{minutes_left}분 내에 SLA 기한이 만료됩니다.",
                    link=f"/tickets/{record.gitlab_issue_iid}",
                )
            db.commit()
        except Exception as e:
            logger.warning("Failed to create SLA in-app notification for ticket #%s: %s", record.gitlab_issue_iid, e)

        # 자동화 규칙 실행 — ticket.sla_warning 이벤트
        try:
            from .routers.automation import evaluate_automation_rules
            evaluate_automation_rules(db, "ticket.sla_warning", {
                "iid": record.gitlab_issue_iid,
                "project_id": record.project_id,
                "priority": record.priority,
                "minutes_left": str(minutes_left),
            })
        except Exception as _ae:
            logger.warning("Automation rule eval failed on sla_warning #%s: %s", record.gitlab_issue_iid, _ae)

        logger.info(
            "SLA warning sent for ticket #%s (project %s, %d minutes left)",
            record.gitlab_issue_iid, record.project_id, minutes_left,
        )

    return at_risk


def check_and_send_warnings_30min(db: Session) -> list[SLARecord]:
    """30분 임박 경고 알림 — warning_sent_30min 플래그로 중복 발송 방지.

    60분 경고(warning_sent)와 독립적으로 동작하여 이중 경고를 지원한다.
    """
    from .notifications import notify_sla_warning

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now + timedelta(minutes=30)

    at_risk = (
        db.query(SLARecord)
        .filter(
            SLARecord.breached == False,  # noqa: E712
            SLARecord.resolved_at == None,  # noqa: E711
            SLARecord.warning_sent_30min == False,  # noqa: E712
            SLARecord.paused_at == None,  # noqa: E711
            SLARecord.sla_deadline > now,
            SLARecord.sla_deadline <= cutoff,
        )
        .with_for_update(skip_locked=True)
        .all()
    )

    # N+1 방지: staff 목록을 루프 밖에서 한 번만 조회
    from .models import UserRole
    from .notifications import create_db_notification
    try:
        staff_30 = db.query(UserRole).filter(UserRole.role.in_(["admin", "agent"])).all()
    except Exception:
        staff_30 = []

    for record in at_risk:
        deadline_utc = _ensure_utc(record.sla_deadline)
        now_utc = datetime.now(timezone.utc)
        remaining = deadline_utc - now_utc
        minutes_left = max(1, int(remaining.total_seconds() / 60))

        record.warning_sent_30min = True
        db.commit()

        try:
            try:
                from .tasks import send_sla_warning as _sla_warn_task
                _sla_warn_task.delay(record.gitlab_issue_iid, record.project_id, minutes_left)
            except Exception:
                notify_sla_warning(record.gitlab_issue_iid, record.project_id, minutes_left)
        except Exception as e:
            logger.warning("Failed to send 30min SLA warning for ticket #%s: %s", record.gitlab_issue_iid, e)

        try:
            for member in staff_30:
                create_db_notification(
                    db,
                    recipient_id=str(member.gitlab_user_id),
                    title=f"🚨 SLA 30분 임박 - 티켓 #{record.gitlab_issue_iid}",
                    body=f"{minutes_left}분 내에 SLA 기한이 만료됩니다.",
                    link=f"/tickets/{record.gitlab_issue_iid}",
                )
            db.commit()
        except Exception as e:
            logger.warning("Failed to create 30min SLA in-app notification for ticket #%s: %s", record.gitlab_issue_iid, e)

        logger.info(
            "30min SLA warning sent for ticket #%s (project %s, %d minutes left)",
            record.gitlab_issue_iid, record.project_id, minutes_left,
        )

    return at_risk


def get_sla_record(db: Session, iid: int, project_id: str) -> Optional[SLARecord]:
    return db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()


def check_and_escalate(db: Session) -> list[dict]:
    """에스컬레이션 정책 평가 및 실행.

    SLA 위반/임박 티켓에 대해 정책별 자동 액션(알림/재배정/우선순위 상향)을 수행한다.
    EscalationRecord로 중복 실행을 방지한다.
    """
    from .models import EscalationPolicy, EscalationRecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    executed = []

    policies = (
        db.query(EscalationPolicy)
        .filter(EscalationPolicy.enabled == True)  # noqa: E712
        .all()
    )
    if not policies:
        return []

    # 정책 전체의 후보 레코드를 단일 쿼리로 조회 (정책당 쿼리 반복 방지)
    breach_policies = [p for p in policies if p.trigger == "breach"]
    warning_policies = [p for p in policies if p.trigger == "warning"]

    base_q = db.query(SLARecord).filter(
        SLARecord.resolved_at == None,  # noqa: E711
        SLARecord.paused_at == None,    # noqa: E711
    )

    # 위반 후보 레코드: 한 번에 조회
    breach_candidates: list[SLARecord] = []
    if breach_policies:
        breach_candidates = base_q.filter(SLARecord.breached == True).all()  # noqa: E712

    # 경고 임박 후보 레코드: 한 번에 조회
    warning_candidates: list[SLARecord] = []
    if warning_policies:
        warning_cutoff = now + timedelta(minutes=60)
        warning_candidates = base_q.filter(
            SLARecord.breached == False,  # noqa: E712
            SLARecord.warning_sent == True,  # noqa: E712
            SLARecord.sla_deadline <= warning_cutoff,
        ).all()

    # 이미 실행된 (policy_id, ticket_iid, project_id) 조합을 배치 조회
    all_candidate_keys = [
        (p.id, r.gitlab_issue_iid, r.project_id)
        for p in breach_policies for r in breach_candidates
    ] + [
        (p.id, r.gitlab_issue_iid, r.project_id)
        for p in warning_policies for r in warning_candidates
    ]

    done_set: set[tuple] = set()
    if all_candidate_keys:
        policy_ids_list = list({k[0] for k in all_candidate_keys})
        existing_records = db.query(EscalationRecord).filter(
            EscalationRecord.policy_id.in_(policy_ids_list)
        ).all()
        done_set = {(r.policy_id, r.ticket_iid, r.project_id) for r in existing_records}

    def _process(policy, candidates):
        if policy.trigger == "breach":
            cutoff = now - timedelta(minutes=policy.delay_minutes)
            eligible = [r for r in candidates if r.sla_deadline <= cutoff]
            if policy.priority:
                eligible = [r for r in eligible if r.priority == policy.priority]
        else:
            delay_cutoff = now - timedelta(minutes=policy.delay_minutes)
            eligible = [r for r in candidates if r.sla_deadline > delay_cutoff]
            if policy.priority:
                eligible = [r for r in eligible if r.priority == policy.priority]

        for record in eligible:
            key = (policy.id, record.gitlab_issue_iid, record.project_id)
            if key in done_set:
                continue
            try:
                _execute_escalation(db, policy, record, now)
                # savepoint로 중복 insert race condition 방지 (unique constraint)
                sp = db.begin_nested()
                try:
                    db.add(EscalationRecord(
                        policy_id=policy.id,
                        ticket_iid=record.gitlab_issue_iid,
                        project_id=record.project_id,
                    ))
                    db.flush()
                    sp.commit()
                except Exception:
                    sp.rollback()
                    logger.warning(
                        "Escalation record already exists (concurrent run), skipping: policy=%s ticket=#%s",
                        policy.name, record.gitlab_issue_iid,
                    )
                    continue
                done_set.add(key)
                executed.append({
                    "policy": policy.name,
                    "ticket_iid": record.gitlab_issue_iid,
                    "action": policy.action,
                })
            except Exception as e:
                logger.error(
                    "Escalation failed: policy=%s ticket=#%s: %s",
                    policy.name, record.gitlab_issue_iid, e,
                )

    for policy in breach_policies:
        _process(policy, breach_candidates)
    for policy in warning_policies:
        _process(policy, warning_candidates)

    if executed:
        db.commit()
    return executed


def _execute_escalation(db, policy, record: SLARecord, now: datetime) -> None:
    """에스컬레이션 액션 실제 수행."""
    from .notifications import create_db_notification
    import html

    iid = record.gitlab_issue_iid
    project_id = record.project_id
    trigger_label = "SLA 위반" if policy.trigger == "breach" else "SLA 임박"

    if policy.action == "notify":
        # 대상 사용자 인앱 알림
        if policy.target_user_id:
            create_db_notification(
                db,
                recipient_id=policy.target_user_id,
                title=f"🚨 에스컬레이션: 티켓 #{iid} ({trigger_label})",
                body=f"정책 '{policy.name}'에 따라 에스컬레이션됐습니다.",
                link=f"/tickets/{iid}",
            )
        # 외부 이메일 알림
        if policy.notify_email:
            try:
                from .notifications import _send_email
                subject = f"[ITSM 에스컬레이션] 티켓 #{iid} {trigger_label}"
                body = (
                    f"에스컬레이션 정책: {html.escape(policy.name)}<br>"
                    f"티켓: #{iid} (우선순위: {record.priority})<br>"
                    f"SLA 기한: {record.sla_deadline}<br>"
                )
                _send_email(policy.notify_email, subject, body)
            except Exception as e:
                logger.warning("Escalation email failed for ticket #%s: %s", iid, e)

    elif policy.action == "reassign":
        # 담당자 변경
        if policy.target_user_id:
            try:
                from . import gitlab_client
                gitlab_client.update_issue(iid, assignee_id=int(policy.target_user_id), project_id=project_id)
                gitlab_client.add_note(
                    iid,
                    f"🚨 에스컬레이션 자동 재배정: {policy.name} 정책에 따라 {policy.target_user_name or policy.target_user_id}(으)로 재배정됐습니다.",
                    project_id=project_id,
                )
                create_db_notification(
                    db,
                    recipient_id=policy.target_user_id,
                    title=f"🚨 에스컬레이션 재배정: 티켓 #{iid}",
                    body=f"'{policy.name}' 정책으로 자동 배정됐습니다.",
                    link=f"/tickets/{iid}",
                )
            except Exception as e:
                logger.error("Escalation reassign failed for ticket #%s: %s", iid, e)

    elif policy.action == "upgrade_priority":
        # 우선순위 상향 (low→medium→high→critical)
        _PRIORITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        _PRIORITY_UPGRADE = {0: "medium", 1: "high", 2: "critical", 3: "critical"}
        current_rank = _PRIORITY_RANK.get(record.priority, 1)
        new_priority = _PRIORITY_UPGRADE[current_rank]
        if new_priority != record.priority:
            try:
                from . import gitlab_client
                issue = gitlab_client.get_issue(iid, project_id=project_id)
                current_labels = issue.get("labels", [])
                remove_labels = [lb for lb in current_labels if lb.startswith("prio::")]
                gitlab_client.update_issue(
                    iid,
                    add_labels=[f"prio::{new_priority}"],
                    remove_labels=remove_labels or None,
                    project_id=project_id,
                )
                gitlab_client.add_note(
                    iid,
                    f"⬆️ 에스컬레이션 우선순위 자동 상향: {record.priority} → {new_priority} (정책: {policy.name})",
                    project_id=project_id,
                )
                record.priority = new_priority
            except Exception as e:
                logger.error("Escalation priority upgrade failed for ticket #%s: %s", iid, e)

    logger.info(
        "Escalation executed: policy='%s' ticket=#%s action=%s trigger=%s",
        policy.name, iid, policy.action, policy.trigger,
    )
