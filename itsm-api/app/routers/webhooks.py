"""GitLab webhook receiver (양방향 연동)."""
import hashlib
import hmac
import logging
import re
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..config import get_settings
from ..database import SessionLocal
from .. import sla as sla_module
from ..notifications import (
    notify_status_changed,
    notify_comment_added,
    notify_ticket_created,
    create_db_notification,
)


def _dispatch_celery_or_sync(celery_task, fallback_fn, *args) -> None:
    """Celery 브로커가 설정돼 있으면 .delay()로 큐에 넣고, 아니면 동기 폴백."""
    try:
        from ..config import get_settings as _gs
        _broker = getattr(_gs(), "CELERY_BROKER_URL", None) or _gs().REDIS_URL
        if _broker and _broker != "memory://":
            celery_task.delay(*args)
            return
    except Exception:
        pass
    fallback_fn(*args)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)

_IDEMPOTENCY_TTL = 3600  # seconds — deduplicate within 1 hour
_MAX_WEBHOOK_BODY = 1 * 1024 * 1024  # 1MB — DoS 방지 (H-4)


def _safe_str(value: Any, max_len: int = 200) -> str:
    """MED-03/LOW-05: 외부 webhook 페이로드에서 온 문자열의 CRLF·제어문자 제거.

    로그 인젝션과 인앱 알림 body의 newline 삽입을 방어한다.
    """
    s = str(value) if value is not None else ""
    # CR/LF/탭 등 제어문자 제거 (로그 인젝션 방지)
    s = re.sub(r"[\r\n\t\x00-\x1f\x7f]", " ", s)
    return s[:max_len]


def _check_webhook_secret_configured() -> None:
    """HIGH-04: 시작 시 Webhook 시크릿 미설정 경고."""
    try:
        from ..config import get_settings
        if not get_settings().GITLAB_WEBHOOK_SECRET:
            logger.error(
                "GITLAB_WEBHOOK_SECRET이 설정되지 않았습니다. "
                "모든 Webhook 요청이 거부됩니다. "
                ".env에 GITLAB_WEBHOOK_SECRET=<secret>을 설정하세요."
            )
    except Exception:
        pass

_check_webhook_secret_configured()


def _verify_signature(body: bytes, token: str) -> bool:
    """Verify the X-Gitlab-Token header.

    H-4: GITLAB_WEBHOOK_SECRET 미설정 시 fail-closed — 모든 요청 거부.
    운영 환경에서는 반드시 시크릿을 설정해야 함.
    """
    settings = get_settings()
    secret = settings.GITLAB_WEBHOOK_SECRET
    if not secret:
        logger.error("GITLAB_WEBHOOK_SECRET not configured — rejecting all webhook requests (H-4 fail-closed)")
        return False  # H-4: fail-closed
    secret_str = secret if isinstance(secret, str) else secret.decode()
    return hmac.compare_digest(token, secret_str)


def _is_duplicate(event_uuid: str) -> bool:
    """Return True if this event UUID was already processed (idempotency via Redis)."""
    if not event_uuid:
        return False
    try:
        from ..redis_client import get_redis
        r = get_redis()
        if r is None:
            return False
        key = f"webhook:uuid:{event_uuid}"
        result = r.set(key, "1", ex=_IDEMPOTENCY_TTL, nx=True)
        return result is None  # None means key already existed → duplicate
    except Exception as e:
        logger.warning("Redis idempotency check failed (allowing through): %s", e)
        return False  # fail open — process the event


@router.post("/gitlab")
async def gitlab_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_gitlab_token: str = Header(default=""),
    x_gitlab_event: str = Header(default=""),
    x_gitlab_event_uuid: str = Header(default=""),
):
    body = await request.body()
    if len(body) > _MAX_WEBHOOK_BODY:
        raise HTTPException(status_code=413, detail="Webhook payload too large")
    if not _verify_signature(body, x_gitlab_token):
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    # Idempotency: skip if already processed
    if _is_duplicate(x_gitlab_event_uuid):
        logger.info("Duplicate webhook (uuid=%s) — skipped", x_gitlab_event_uuid)
        return JSONResponse({"status": "duplicate"})

    try:
        import json as _json
        payload: dict[str, Any] = _json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    logger.info("Received GitLab webhook: %s (uuid=%s)", x_gitlab_event, x_gitlab_event_uuid)

    if x_gitlab_event == "Issue Hook":
        background_tasks.add_task(_handle_issue_hook, payload)
    elif x_gitlab_event == "Note Hook":
        background_tasks.add_task(_handle_note_hook, payload)
    elif x_gitlab_event == "Merge Request Hook":
        background_tasks.add_task(_handle_mr_hook, payload)
    elif x_gitlab_event == "Push Hook":
        background_tasks.add_task(_handle_push_hook, payload)
    elif x_gitlab_event == "Pipeline Hook":
        background_tasks.add_task(_handle_pipeline_hook, payload)

    return JSONResponse({"status": "ok"})


def _handle_issue_hook(payload: dict) -> None:
    """Handle GitLab Issue Hook events."""
    try:
        attrs = payload.get("object_attributes", {})
        iid = attrs.get("iid")
        project_id = str(payload.get("project", {}).get("id", ""))
        action = attrs.get("action")  # open, close, reopen, update

        settings = get_settings()
        main_project_id = str(settings.GITLAB_PROJECT_ID)

        if project_id == main_project_id:
            # ── ITSM 메인 프로젝트 이벤트 ─────────────────────────────────
            # Update SLA record when issue is closed/resolved
            if action in ("close",):
                with SessionLocal() as db:
                    sla_module.mark_resolved(db, iid, project_id)

            # Handle externally created issues (not from ITSM web UI)
            if action == "open":
                desc = attrs.get("description") or ""
                is_external = "**신청자:**" not in desc
                if is_external:
                    _handle_external_issue(iid, project_id, attrs, payload)

            # ── GitLab에서 직접 수정 → ITSM 내부 상태 동기화 (양방향 연동) ──
            if action == "update":
                _handle_issue_update(iid, project_id, payload)

            # Notify status change based on labels
            labels = [lb.get("title", "") for lb in payload.get("labels", [])]
            new_status = "open"
            for label in labels:
                if label.startswith("status::"):
                    new_status = label[8:]

            logger.info("Issue hook (main): #%s action=%s status=%s", iid, action, new_status)
        else:
            # ── 개발 프로젝트 이벤트 → 전달된 메인 티켓에 상태 동기화 ────────
            _sync_forwarded_issue(target_project_id=project_id, target_iid=iid, payload=payload)

        # 검색 색인 동기화 (모든 프로젝트)
        _upsert_search_index(iid, project_id, attrs, payload)

        # Redis 통계 캐시 즉시 무효화 — stale 통계 방지
        _invalidate_stats_cache(project_id)

    except Exception as e:
        logger.error("Error handling issue hook: %s", e)


def _invalidate_stats_cache(project_id: str) -> None:
    """이슈 변경 시 Redis 통계 캐시 패턴 삭제 — 다음 조회 시 GitLab에서 신선한 값 반환."""
    try:
        from ..redis_client import get_redis
        r = get_redis()
        if not r:
            return
        # itsm:stats:{project_id}:* 및 itsm:stats::* (전체 프로젝트) 삭제
        for pattern in (f"itsm:stats:{project_id}:*", "itsm:stats::*"):
            keys = r.keys(pattern)
            if keys:
                r.delete(*keys)
    except Exception as e:
        logger.debug("Stats cache invalidation failed: %s", e)


def _upsert_search_index(iid: int, project_id: str, attrs: dict, payload: dict) -> None:
    """Issue Hook 수신 시 ticket_search_index 테이블을 upsert한다."""
    if not iid or not project_id:
        return
    try:
        import re as _re
        from ..models import TicketSearchIndex
        from ..database import SessionLocal

        title = attrs.get("title") or ""
        desc_raw = attrs.get("description") or ""
        # 마크다운 태그·HTML 제거 후 plain text 추출 (검색 품질 향상)
        desc_text = _re.sub(r"<[^>]+>", " ", desc_raw)
        desc_text = _re.sub(r"[#*`_~\[\]!>|]", " ", desc_text)
        desc_text = _re.sub(r"\s+", " ", desc_text).strip()[:2000]

        state = attrs.get("state") or "opened"
        labels = [lb.get("title", "") for lb in payload.get("labels", [])]
        assignees = payload.get("assignees") or []
        assignee_username = assignees[0].get("username") if assignees else None

        from sqlalchemy.dialects.postgresql import insert as pg_insert
        with SessionLocal() as db:
            stmt = pg_insert(TicketSearchIndex).values(
                iid=iid,
                project_id=project_id,
                title=title,
                description_text=desc_text,
                state=state,
                labels_json=labels,
                assignee_username=assignee_username,
            ).on_conflict_do_update(
                index_elements=["iid", "project_id"],
                set_={
                    "title": title,
                    "description_text": desc_text,
                    "state": state,
                    "labels_json": labels,
                    "assignee_username": assignee_username,
                    "synced_at": __import__("sqlalchemy", fromlist=["func"]).func.now(),
                },
            )
            db.execute(stmt)
            db.commit()
    except Exception as e:
        logger.warning("Search index upsert failed for #%s: %s", iid, e)


def _handle_issue_update(iid: int, project_id: str, payload: dict) -> None:
    """GitLab에서 직접 이슈를 수정했을 때 ITSM 감사 로그와 인앱 알림을 기록한다.

    웹훅 루프 방지: GITLAB_BOT_USERNAME 설정 시 봇이 만든 변경은 무시한다.
    실제 이슈 데이터는 GitLab이 source-of-truth이므로 별도 DB 저장 없이 알림만 발행.
    """
    try:
        settings = get_settings()
        actor_username = payload.get("user", {}).get("username", "")

        # 루프 방지: ITSM 서비스 계정이 직접 만든 변경이면 스킵
        bot_username = settings.GITLAB_BOT_USERNAME
        if bot_username and actor_username == bot_username:
            logger.debug("Issue update by bot account (%s) — skipping sync loop", actor_username)
            return

        changes = payload.get("changes", {})
        if not changes:
            return

        # 변경된 필드 목록 추출
        changed_fields: list[str] = []
        if "title" in changes:
            old = changes["title"].get("previous", "")
            new = changes["title"].get("current", "")
            if old != new:
                changed_fields.append(f"제목: `{old}` → `{new}`")
        if "description" in changes:
            changed_fields.append("설명 변경됨")
        if "assignees" in changes:
            new_assignees = [a.get("username", "") for a in changes["assignees"].get("current", [])]
            changed_fields.append(f"담당자: {', '.join(new_assignees) or '없음'}")
        if "labels" in changes:
            new_labels = [lb.get("title", "") for lb in (changes["labels"].get("current") or [])]
            status = next((l[8:] for l in new_labels if l.startswith("status::")), None)
            if status:
                changed_fields.append(f"상태: {status}")

        if not changed_fields:
            return

        actor_name = _safe_str(payload.get("user", {}).get("name", actor_username))
        summary = " / ".join(changed_fields)
        logger.info("Issue #%s updated directly in GitLab by %s: %s", iid, actor_name, summary)

        # 티켓 신청자에게 인앱 알림 발송
        attrs = payload.get("object_attributes", {})
        description = attrs.get("description") or ""
        submitter_username = _parse_submitter_username(description)
        submitter_user_id = _get_gitlab_user_id_by_username(submitter_username) if submitter_username else None

        if submitter_user_id:
            with SessionLocal() as db:
                create_db_notification(
                    db,
                    recipient_id=submitter_user_id,
                    title=f"티켓 #{iid}이 GitLab에서 수정됐습니다",
                    body=f"{actor_name}: {_safe_str(summary)}",
                    link=f"/tickets/{iid}",
                )

    except Exception as e:
        logger.error("Error handling issue update #%s: %s", iid, e)


def _handle_external_issue(iid: int, project_id: str, attrs: dict, payload: dict) -> None:
    """Handle issues created directly in GitLab (not via ITSM web UI).

    Creates an SLA record, runs auto-assignment, and sends in-app notifications.
    """
    from ..assignment import evaluate_rules
    from .. import gitlab_client

    try:
        labels = [lb.get("title", "") for lb in payload.get("labels", [])]
        priority = "medium"
        category = "other"
        for label in labels:
            if label.startswith("prio::"):
                priority = label[6:]
            elif label.startswith("cat::"):
                category = label[5:]

        title = attrs.get("title", "")
        author = payload.get("user", {})

        with SessionLocal() as db:
            # Create SLA record
            sla_module.create_sla_record(db, iid, project_id, priority)

            # Auto-assign
            rule = evaluate_rules(db, category=category, priority=priority, title=title)
            if rule:
                try:
                    gitlab_client.update_issue(iid, assignee_id=rule.assignee_gitlab_id, project_id=project_id)
                    create_db_notification(
                        db,
                        recipient_id=str(rule.assignee_gitlab_id),
                        title=f"티켓 #{iid} 담당자로 배정됐습니다",
                        body=f"GitLab에서 직접 생성된 이슈: {title}",
                        link=f"/tickets/{iid}",
                    )
                except Exception as e:
                    logger.warning("Auto-assign failed for external issue #%s: %s", iid, e)

        # Notify IT team
        ticket_info = {
            "iid": iid,
            "title": title,
            "employee_name": author.get("name", "외부 사용자"),
            "priority": priority,
            "category": category,
        }
        from ...tasks import send_ticket_notification
        _dispatch_celery_or_sync(send_ticket_notification, notify_ticket_created, ticket_info)
        logger.info("External issue #%s processed (priority=%s, category=%s)", iid, priority, category)

    except Exception as e:
        logger.error("Error handling external issue #%s: %s", iid, e)


def _sync_forwarded_issue(target_project_id: str, target_iid: int, payload: dict) -> None:
    """개발 프로젝트 이슈 이벤트를 받아 연결된 ITSM 메인 티켓 상태를 동기화한다."""
    from ..models import ProjectForward
    from ..routers.forwards import _STATUS_RANK, _FORWARD_TO_ITSM, _sync_main_ticket_status

    try:
        # 이 개발 이슈와 연결된 ITSM 전달 기록 조회
        with SessionLocal() as db:
            fwd = (
                db.query(ProjectForward)
                .filter(
                    ProjectForward.target_project_id == target_project_id,
                    ProjectForward.target_iid == target_iid,
                )
                .first()
            )
            if not fwd:
                logger.debug(
                    "No forward record for dev project %s issue #%s — ignoring webhook",
                    target_project_id, target_iid,
                )
                return

            source_iid = fwd.source_iid
            source_project_id = fwd.source_project_id

            # 웹훅 페이로드에서 이슈 상태 추출
            attrs = payload.get("object_attributes", {})
            state = attrs.get("state", "opened")  # opened / closed
            labels = [lb.get("title", "") for lb in payload.get("labels", [])]

            if state == "closed":
                target_status = "closed"
            else:
                target_status = "open"
                for lb in labels:
                    if lb.startswith("status::"):
                        target_status = lb[8:]
                        break

            # 전달된 ITSM 상태로 변환 후 메인 티켓에 반영
            desired_itsm_status = _FORWARD_TO_ITSM.get(target_status)
            if desired_itsm_status:
                _sync_main_ticket_status(source_iid, source_project_id, desired_itsm_status)
                logger.info(
                    "Webhook sync: dev project %s #%s status=%s → ITSM ticket #%s desired=%s",
                    target_project_id, target_iid, target_status,
                    source_iid, desired_itsm_status,
                )
    except Exception as e:
        logger.error(
            "Error syncing forwarded issue %s#%s: %s",
            target_project_id, target_iid, e,
        )


def _parse_submitter_username(description: str) -> str | None:
    """이슈 설명에서 **작성자:** 필드를 파싱해 username을 반환한다."""
    for line in description.splitlines():
        line = line.strip()
        if line.startswith("**작성자:**"):
            return line.replace("**작성자:**", "").strip() or None
    return None


def _get_gitlab_user_id_by_username(username: str) -> str | None:
    """UserRole 테이블에서 username으로 gitlab_user_id를 조회한다."""
    if not username:
        return None
    try:
        from ..models import UserRole
        with SessionLocal() as db:
            record = db.query(UserRole).filter(UserRole.username == username).first()
            if record:
                return str(record.gitlab_user_id)
    except Exception as e:
        logger.warning("UserRole lookup failed for %s: %s", username, e)
    return None


def _handle_note_hook(payload: dict) -> None:
    """Handle GitLab Note Hook events (comments).

    - SLA first response 기록
    - 시스템 자동 노트(봇 코멘트) 필터링
    - 티켓 신청자·구독자에게 인앱 알림 + 이메일 전송
    """
    try:
        attrs = payload.get("object_attributes", {})
        issue_data = payload.get("issue", {})
        iid = issue_data.get("iid")
        project_id = str(payload.get("project_id", ""))
        note_body = attrs.get("note", "")
        author = payload.get("user", {})
        author_id = str(author.get("id", ""))
        author_name = _safe_str(author.get("name", ""))
        author_username = _safe_str(author.get("username", ""))
        is_internal = attrs.get("confidential", False)

        if not iid:
            return

        # 시스템 자동 노트 필터링 (ITSM 서비스 계정 코멘트는 알림 불필요)
        settings = get_settings()
        # H-14: author 기반 봇 필터링 (GitLab 14+의 bot 플래그 또는 설정된 봇 계정명)
        note_author = payload.get("user", {})
        BOT_USERNAMES = {"gitlab-bot", "itsm-bot", "automation-bot"}  # 필요 시 추가
        if note_author.get("bot") or note_author.get("username", "") in BOT_USERNAMES:
            logger.debug("Note hook: skipping bot author comment on issue #%s", iid)
            return

        # SLA first response 기록
        with SessionLocal() as db:
            sla_module.mark_first_response(db, iid, project_id)

        logger.info("Note hook: issue #%s author=%s internal=%s", iid, author_name, is_internal)

        # 내부 메모는 인앱 알림만, 이메일 없음
        # 일반 코멘트는 신청자+구독자 모두 알림
        description = issue_data.get("description") or ""
        title = issue_data.get("title", f"#{iid}")

        # 신청자 username 파싱 → gitlab_user_id 조회
        submitter_username = _parse_submitter_username(description)
        submitter_user_id = _get_gitlab_user_id_by_username(submitter_username) if submitter_username else None

        preview = _safe_str(note_body, max_len=100) + ("..." if len(note_body) > 100 else "")
        label = "내부 메모" if is_internal else "새 댓글"

        # 알림 수신 대상: 신청자 + 담당 에이전트 (중복·본인 제외)
        notify_targets: set[str] = set()
        if submitter_user_id and submitter_user_id != author_id:
            notify_targets.add(submitter_user_id)

        # 담당 에이전트 알림 추가
        for assignee in issue_data.get("assignees", []):
            assignee_id = str(assignee.get("id", ""))
            if assignee_id and assignee_id != author_id and assignee_id not in notify_targets:
                notify_targets.add(assignee_id)

        if notify_targets:
            with SessionLocal() as db:
                for recipient_id in notify_targets:
                    create_db_notification(
                        db,
                        recipient_id=recipient_id,
                        title=f"티켓 #{iid}에 {label}이 달렸습니다",
                        body=f"{author_name}: {preview}",
                        link=f"/tickets/{iid}",
                    )

        # 이메일 + 구독자 알림 (내부 메모 제외)
        if not is_internal:
            ticket_info = {
                "iid": iid,
                "title": title,
                "project_id": project_id,
                "employee_email": _extract_email_from_description(description),
            }
            from ...tasks import send_comment_notification
            _dispatch_celery_or_sync(
                send_comment_notification, notify_comment_added,
                ticket_info, note_body, author_name, False,
            )

    except Exception as e:
        logger.error("Error handling note hook: %s", e)


def _extract_email_from_description(description: str) -> str | None:
    """이슈 설명에서 **이메일:** 필드를 파싱해 반환한다."""
    for line in description.splitlines():
        line = line.strip()
        if line.startswith("**이메일:**"):
            email = line.replace("**이메일:**", "").strip()
            return email if email else None
    return None


_MR_CLOSES_RE = re.compile(
    r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)",
    re.IGNORECASE,
)
_MR_HASH_RE = re.compile(r"#(\d+)")


def _handle_mr_hook(payload: dict) -> None:
    """Handle GitLab Merge Request Hook events.

    - merge: 연결된 ITSM 티켓 자동 해결
    - open: 담당자에게 인앱 알림
    - approved: 담당자에게 승인 알림
    - close (with merge_status=cannot_be_merged): 충돌 알림
    """
    from .. import gitlab_client

    try:
        attrs = payload.get("object_attributes", {})
        action = attrs.get("action")  # open, close, merge, update, reopen, approved
        mr_iid = attrs.get("iid")
        project_id = str(payload.get("project", {}).get("id", ""))
        settings = get_settings()
        main_project_id = str(settings.GITLAB_PROJECT_ID)

        title = attrs.get("title", "")
        description = attrs.get("description") or ""
        combined = f"{title}\n{description}"
        author = payload.get("user", {})
        author_name = author.get("name", "")
        mr_url = attrs.get("url", "")

        # Extract ticket iids from "Closes #N" / "Fixes #N" patterns, fallback to plain #N
        referenced: set[int] = set()
        for m in _MR_CLOSES_RE.finditer(combined):
            referenced.add(int(m.group(1)))
        if not referenced:
            for m in _MR_HASH_RE.finditer(combined):
                referenced.add(int(m.group(1)))

        # ── MR 생성: 연결 티켓 담당자에게 알림 ─────────────────────────────
        if action == "open":
            for ticket_iid in referenced:
                try:
                    issue = gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                    assignees = issue.get("assignees", [])
                    with SessionLocal() as db:
                        for assignee in assignees:
                            create_db_notification(
                                db,
                                recipient_id=str(assignee.get("id", "")),
                                title=f"티켓 #{ticket_iid}에 MR이 열렸습니다",
                                body=f"!{mr_iid} {title} — {author_name}",
                                link=f"/tickets/{ticket_iid}",
                            )
                except Exception as e:
                    logger.warning("MR open notify failed for ticket #%s: %s", ticket_iid, e)
            return

        # ── MR 승인: 관련 티켓 담당자에게 알림 ─────────────────────────────
        if action == "approved":
            for ticket_iid in referenced:
                try:
                    issue = gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                    assignees = issue.get("assignees", [])
                    with SessionLocal() as db:
                        for assignee in assignees:
                            create_db_notification(
                                db,
                                recipient_id=str(assignee.get("id", "")),
                                title=f"티켓 #{ticket_iid} MR 승인됨",
                                body=f"!{mr_iid} {title} — {author_name}이 승인했습니다.",
                                link=f"/tickets/{ticket_iid}",
                            )
                except Exception as e:
                    logger.warning("MR approve notify failed for ticket #%s: %s", ticket_iid, e)
            return

        # ── MR 충돌: 담당자에게 충돌 경고 ──────────────────────────────────
        if action == "update":
            merge_status = attrs.get("merge_status", "")
            if merge_status == "cannot_be_merged":
                for ticket_iid in referenced:
                    try:
                        issue = gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                        assignees = issue.get("assignees", [])
                        with SessionLocal() as db:
                            for assignee in assignees:
                                create_db_notification(
                                    db,
                                    recipient_id=str(assignee.get("id", "")),
                                    title=f"티켓 #{ticket_iid} MR 충돌 발생",
                                    body=f"!{mr_iid} {title} — 병합 충돌이 발생했습니다. 확인이 필요합니다.",
                                    link=f"/tickets/{ticket_iid}",
                                )
                    except Exception as e:
                        logger.warning("MR conflict notify failed for ticket #%s: %s", ticket_iid, e)
            return

        # ── MR 머지: 연결된 ITSM 티켓 자동 해결 ────────────────────────────
        if action != "merge":
            return

        if not referenced:
            logger.debug("MR !%s merged — no ticket references found", mr_iid)
            return

        for ticket_iid in referenced:
            try:
                issue = gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                current_labels = issue.get("labels", [])
                status_labels = [lb for lb in current_labels if lb.startswith("status::")]

                # Only resolve if not already resolved/closed
                current_status = status_labels[0][8:] if status_labels else "open"
                if current_status in ("resolved", "closed"):
                    continue

                remove_labels = status_labels
                add_labels = ["status::resolved"]
                gitlab_client.update_issue(
                    ticket_iid,
                    add_labels=add_labels,
                    remove_labels=remove_labels or None,
                    project_id=main_project_id,
                )
                # Auto-comment
                gitlab_client.add_note(
                    ticket_iid,
                    f"🔀 MR !{mr_iid} 머지로 자동 해결됐습니다.",
                    project_id=main_project_id,
                )

                with SessionLocal() as db:
                    sla_module.mark_resolved(db, ticket_iid, main_project_id)
                    # CSAT 알림: 해결 시 만족도 조사 요청
                    description_text = issue.get("description") or ""
                    submitter_username = _parse_submitter_username(description_text)
                    submitter_user_id = _get_gitlab_user_id_by_username(submitter_username) if submitter_username else None
                    if submitter_user_id:
                        create_db_notification(
                            db,
                            recipient_id=submitter_user_id,
                            title=f"티켓 #{ticket_iid} 처리가 완료됐습니다",
                            body="서비스 만족도를 평가해 주세요. 소중한 의견이 서비스 개선에 도움이 됩니다.",
                            link=f"/tickets/{ticket_iid}",
                        )

                logger.info("MR !%s merge auto-resolved ticket #%s", mr_iid, ticket_iid)
            except Exception as e:
                logger.error("Failed to auto-resolve ticket #%s from MR !%s: %s", ticket_iid, mr_iid, e)

    except Exception as e:
        logger.error("Error handling MR hook: %s", e)


_COMMIT_CLOSES_RE = re.compile(
    r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)",
    re.IGNORECASE,
)


def _handle_push_hook(payload: dict) -> None:
    """Handle GitLab Push Hook events.

    Parses commit messages for ticket references (Fixes #N, Closes #N, Refs #N)
    and adds an auto-comment to those ITSM tickets.
    """
    from .. import gitlab_client

    try:
        settings = get_settings()
        main_project_id = str(settings.GITLAB_PROJECT_ID)
        commits = payload.get("commits", [])
        branch = payload.get("ref", "").replace("refs/heads/", "")
        project_name = payload.get("project", {}).get("name", "")

        # H-35: IID 추출 수 제한으로 커밋 메시지 폭탄 방지
        MAX_IIDS_PER_COMMIT = 10
        MAX_IIDS_PER_PUSH = 50

        referenced: dict[int, list[str]] = {}  # iid → [commit_short_sha, ...]
        for commit in commits:
            if len(referenced) >= MAX_IIDS_PER_PUSH:
                break
            message = commit.get("message", "")
            short_sha = commit.get("id", "")[:8]
            commit_iids = [int(m.group(1)) for m in _COMMIT_CLOSES_RE.finditer(message)][:MAX_IIDS_PER_COMMIT]
            for iid in commit_iids:
                if len(referenced) >= MAX_IIDS_PER_PUSH:
                    break
                referenced.setdefault(iid, []).append(short_sha)

        if not referenced:
            return

        for ticket_iid, shas in referenced.items():
            try:
                # Verify ticket exists in main project
                gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                sha_list = ", ".join(f"`{s}`" for s in shas)
                comment = (
                    f"🔗 커밋({sha_list})이 이 티켓을 참조합니다. "
                    f"브랜치: `{branch}` (프로젝트: {project_name})"
                )
                gitlab_client.add_note(ticket_iid, comment, project_id=main_project_id)
                logger.info("Push hook: added commit reference comment to ticket #%s", ticket_iid)
            except Exception as e:
                logger.error("Failed to add commit ref comment to ticket #%s: %s", ticket_iid, e)

    except Exception as e:
        logger.error("Error handling push hook: %s", e)


def _handle_pipeline_hook(payload: dict) -> None:
    """Handle GitLab Pipeline Hook events.

    On pipeline failure, finds ITSM tickets referenced in related MR/commits
    and adds a failure comment.
    """
    from .. import gitlab_client

    try:
        attrs = payload.get("object_attributes", {})
        status = attrs.get("status")
        if status != "failed":
            return

        settings = get_settings()
        main_project_id = str(settings.GITLAB_PROJECT_ID)
        pipeline_id = attrs.get("id")
        ref = attrs.get("ref", "")
        project_name = payload.get("project", {}).get("name", "")

        # Collect ticket references from commits in this pipeline
        # H-35: IID 추출 수 제한으로 커밋 메시지 폭탄 방지
        MAX_IIDS_PER_COMMIT = 10
        MAX_IIDS_PER_PUSH = 50

        commits = payload.get("commits", [])
        referenced: set[int] = set()
        for commit in commits:
            if len(referenced) >= MAX_IIDS_PER_PUSH:
                break
            message = commit.get("message", "")
            commit_iids = [int(m.group(1)) for m in _COMMIT_CLOSES_RE.finditer(message)][:MAX_IIDS_PER_COMMIT]
            for iid in commit_iids:
                if len(referenced) >= MAX_IIDS_PER_PUSH:
                    break
                referenced.add(iid)

        # Also check MR if available
        mr = payload.get("merge_request")
        if mr:
            title = mr.get("title", "")
            desc = mr.get("description") or ""
            for m in _MR_CLOSES_RE.finditer(f"{title}\n{desc}"):
                referenced.add(int(m.group(1)))

        if not referenced:
            return

        for ticket_iid in referenced:
            try:
                gitlab_client.get_issue(ticket_iid, project_id=main_project_id)
                comment = (
                    f"❌ 파이프라인 #{pipeline_id} 실패 — 브랜치: `{ref}` "
                    f"(프로젝트: {project_name}). 관련 변경 사항을 확인하세요."
                )
                gitlab_client.add_note(ticket_iid, comment, project_id=main_project_id)
                logger.info("Pipeline hook: added failure comment to ticket #%s", ticket_iid)
            except Exception as e:
                logger.error("Failed to add pipeline failure comment to ticket #%s: %s", ticket_iid, e)

    except Exception as e:
        logger.error("Error handling pipeline hook: %s", e)
