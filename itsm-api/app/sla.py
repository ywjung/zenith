"""SLA tracking logic."""
import logging
from datetime import datetime, timedelta, timezone, date
from typing import Optional

from sqlalchemy.orm import Session

from .models import SLARecord, SLAPolicy

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
        deadline = datetime.now(timezone.utc) + timedelta(hours=hours)
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
    record = db.query(SLARecord).filter(
        SLARecord.gitlab_issue_iid == iid,
        SLARecord.project_id == project_id,
    ).first()
    if record and record.paused_at:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        pause_seconds = int((now - record.paused_at).total_seconds())
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

    for record in at_risk:
        remaining = record.sla_deadline - now
        minutes_left = int(remaining.total_seconds() / 60)
        try:
            notify_sla_warning(record.gitlab_issue_iid, record.project_id, minutes_left)
        except Exception as e:
            logger.warning("Failed to send SLA warning for ticket #%s: %s", record.gitlab_issue_iid, e)

        # In-app notification for all agents/admins
        try:
            from .models import UserRole
            from .notifications import create_db_notification
            staff = db.query(UserRole).filter(UserRole.role.in_(["admin", "agent"])).all()
            for member in staff:
                create_db_notification(
                    db,
                    recipient_id=str(member.gitlab_user_id),
                    title=f"⏰ SLA 임박 - 티켓 #{record.gitlab_issue_iid}",
                    body=f"{minutes_left}분 내에 SLA 기한이 만료됩니다.",
                    link=f"/tickets/{record.gitlab_issue_iid}",
                )
        except Exception as e:
            logger.warning("Failed to create SLA in-app notification for ticket #%s: %s", record.gitlab_issue_iid, e)

        record.warning_sent = True
        logger.info(
            "SLA warning sent for ticket #%s (project %s, %d minutes left)",
            record.gitlab_issue_iid, record.project_id, minutes_left,
        )

    if at_risk:
        db.commit()
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
    from .notifications import create_db_notification

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
                db.add(EscalationRecord(
                    policy_id=policy.id,
                    ticket_iid=record.gitlab_issue_iid,
                    project_id=record.project_id,
                ))
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
    from .models import UserRole
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
