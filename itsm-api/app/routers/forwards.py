import logging
import re
from typing import Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import gitlab_client, models
from ..config import get_settings
from ..database import get_db
from ..rbac import require_developer, require_agent, require_admin

logger = logging.getLogger(__name__)


def _read_proxy_file(gitlab_path: str) -> tuple[bytes, str, str] | None:
    """프록시 경로(/-/project/{id}/uploads/{hash}/{name})에서 파일을 읽어 반환.

    Returns (content, filename, mime_type) or None if not found.
    """
    import hashlib
    import mimetypes
    import os

    m = re.match(r"^/-/project/(\d+)/uploads/([0-9a-f]+)/([^/]+)$", gitlab_path)
    if not m:
        return None
    project_id, upload_id, filename = m.group(1), m.group(2), m.group(3)
    safe_filename = os.path.basename(filename)
    if safe_filename != filename:
        return None
    sha256 = hashlib.sha256(project_id.encode()).hexdigest()
    base_dir = "/gitlab_data/gitlab-rails/uploads/@hashed"
    fs_path = os.path.normpath(
        os.path.join(base_dir, sha256[:2], sha256[2:4], sha256, upload_id, safe_filename)
    )
    if not fs_path.startswith(base_dir + os.sep) or not os.path.isfile(fs_path):
        return None
    mime = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
    with open(fs_path, "rb") as f:
        return f.read(), safe_filename, mime


def _forward_attachments(
    description: str,
    target_project_id: str,
    gitlab_token: str,
    gitlab_external_url: str,
) -> str:
    """설명의 ITSM 프록시 URL 파일들을 대상 프로젝트에 재업로드하고 URL을 교체.

    재업로드 성공: 대상 프로젝트의 GitLab native URL로 교체
    재업로드 실패: ITSM GitLab URL(fallback)로 교체하여 최소한 접근 가능하게 유지
    """
    if not description:
        return description

    base = gitlab_external_url.rstrip("/")
    pattern = r'/api/tickets/uploads/proxy\?path=([^\s"\')\]]+)'
    upload_cache: dict[str, str] = {}  # 동일 파일 중복 업로드 방지

    def replacer(m: re.Match) -> str:
        encoded_path = m.group(1)
        if encoded_path in upload_cache:
            return upload_cache[encoded_path]

        gitlab_path = unquote(encoded_path)
        fallback = base + gitlab_path  # 재업로드 실패 시 ITSM GitLab URL

        try:
            file_data = _read_proxy_file(gitlab_path)
            if file_data:
                content, filename, mime = file_data
                result = gitlab_client.upload_file(
                    target_project_id, filename, content, mime, gitlab_token
                )
                full_path = result.get("full_path", "")
                if full_path:
                    new_url = base + full_path
                    upload_cache[encoded_path] = new_url
                    return new_url
        except Exception as e:
            logger.warning("첨부파일 재업로드 실패 (%s): %s", gitlab_path, e)

        upload_cache[encoded_path] = fallback
        return fallback

    return re.sub(pattern, replacer, description)

# 전달 이슈 상태 순위 (낮을수록 덜 진행된 상태)
_STATUS_RANK: dict[str, int] = {
    "open": 0,
    "approved": 0,
    "in_progress": 1,
    "waiting": 1,
    "resolved": 2,
    "testing": 3,
    "ready_for_release": 4,
    "released": 5,
    "closed": 2,    # dev closed → ITSM resolved 로 취급
}
# 전달 이슈 상태 → ITSM 메인 티켓 상태 매핑
_FORWARD_TO_ITSM: dict[str, str] = {
    "open": "open",
    "approved": "approved",
    "in_progress": "in_progress",
    "waiting": "in_progress",
    "resolved": "resolved",
    "testing": "testing",
    "ready_for_release": "ready_for_release",
    "released": "released",
    "closed": "resolved",   # dev 완료 = ITSM 해결됨 (종결은 에이전트가 결정)
}

router = APIRouter(prefix="/tickets", tags=["forwards"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


def _sync_main_ticket_status(iid: int, project_id: str, desired_status: str) -> None:
    """전달 이슈들의 최저 상태를 메인 ITSM 티켓에 반영한다.

    - 메인 티켓이 이미 closed이면 건드리지 않는다.
    - desired_status가 현재 상태보다 높은 진행도일 때만 업데이트한다 (상태 되돌림 방지).
    """
    try:
        issue = gitlab_client.get_issue(iid, project_id=project_id)
        if issue.get("state") == "closed":
            return  # 이미 종결된 티켓은 건드리지 않음

        current_labels = issue.get("labels", [])
        current_status = "open"
        for lb in current_labels:
            if lb.startswith("status::"):
                current_status = lb[8:]
                break

        # 현재 상태와 동일하거나 더 낮은 상태로는 되돌리지 않음
        if _STATUS_RANK.get(desired_status, 0) <= _STATUS_RANK.get(current_status, 0):
            return

        remove_labels = [lb for lb in current_labels if lb.startswith("status::")]
        gitlab_client.update_issue(
            iid,
            add_labels=[f"status::{desired_status}"],
            remove_labels=remove_labels,
            project_id=project_id,
        )
        logger.info(
            "Auto-synced ticket #%s: %s → %s (from forwarded issues)",
            iid, current_status, desired_status,
        )
        # 티켓 상세 페이지 SSE 구독자에게 갱신 신호 발행
        try:
            import json as _json
            from ..redis_client import get_redis as _get_redis
            _r = _get_redis()
            if _r:
                _r.publish(
                    f"ticket:events:{project_id}:{iid}",
                    _json.dumps({"type": "status_synced", "status": desired_status}),
                )
        except Exception:
            pass  # Redis 발행 실패는 무시
    except Exception as e:
        logger.warning("Failed to auto-sync ticket #%s status: %s", iid, e)


class ForwardCreate(BaseModel):
    target_project_id: str = Field(..., min_length=1, max_length=100)
    target_project_name: str = Field(..., min_length=1, max_length=300)
    note: Optional[str] = Field(default=None, max_length=2000)


def _fmt(f: models.ProjectForward, target_issue: dict | None = None) -> dict:
    result = {
        "id": f.id,
        "source_iid": f.source_iid,
        "source_project_id": f.source_project_id,
        "target_project_id": f.target_project_id,
        "target_project_name": f.target_project_name,
        "target_iid": f.target_iid,
        "target_web_url": f.target_web_url,
        "note": f.note,
        "created_by_name": f.created_by_name,
        "created_at": f.created_at.isoformat(),
        # 전달 이슈의 현재 상태 (없으면 unknown)
        "target_state": None,
        "target_status": None,
        "target_title": None,
        "target_assignee": None,
    }
    if target_issue:
        state = target_issue.get("state", "")  # opened / closed
        result["target_state"] = state
        result["target_title"] = target_issue.get("title")
        assignees = target_issue.get("assignees") or []
        result["target_assignee"] = assignees[0].get("name") if assignees else None
        # status:: 라벨에서 세부 상태 추출
        labels = target_issue.get("labels", [])
        status = None
        for lb in labels:
            if lb.startswith("status::"):
                status = lb[8:]
                break
        if state == "closed":
            result["target_status"] = "closed"
        else:
            result["target_status"] = status or "open"
    return result


@admin_router.get("/dev-projects")
def list_dev_projects(user: dict = Depends(require_agent)):
    """사용자 본인 OAuth 토큰으로 접근 가능한 개발 프로젝트 목록 반환.

    GITLAB_PROJECT_TOKEN은 ITSM 프로젝트만 볼 수 있으므로
    사용자의 GitLab OAuth 토큰으로 직접 조회한다.
    """
    settings = get_settings()
    common_id = str(settings.GITLAB_PROJECT_ID)
    gitlab_token = user.get("gitlab_token", "")

    all_projects: list[dict] = []
    if gitlab_token:
        try:
            all_projects = gitlab_client.get_user_accessible_projects(gitlab_token)
        except Exception:
            all_projects = []

    return [
        {
            "id": str(p["id"]),
            "name": p["name"],
            "name_with_namespace": p.get("name_with_namespace", p["name"]),
        }
        for p in all_projects
        if str(p["id"]) != common_id
    ]


@router.post("/{iid}/forwards")
def create_forward(
    iid: int,
    data: ForwardCreate,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    """이슈를 개발 프로젝트로 전달하고 연결 이슈를 생성한다."""
    settings = get_settings()
    source_project_id = project_id or str(settings.GITLAB_PROJECT_ID)

    # Fetch source issue
    try:
        issue = gitlab_client.get_issue(iid, project_id=source_project_id)
    except Exception:
        raise HTTPException(status_code=404, detail="티켓을 찾을 수 없습니다.")

    # Build forwarded issue content
    title = f"[공용 #{iid}] {issue['title']}"
    desc_lines = [
        f"> **공용 ITSM 포털에서 전달된 이슈입니다.**",
        f"> 원본 티켓: #{iid} — {issue['title']}",
        f"> 원본 URL: {issue.get('web_url', '')}",
        "",
    ]
    if data.note:
        desc_lines += [f"**전달 메모:** {data.note}", "", "---", ""]
    desc_lines.append(issue.get("description") or "")
    description = "\n".join(desc_lines)

    # Create issue in target dev project (사용자 토큰 사용 — 서비스 토큰은 타 프로젝트 접근 불가)
    gitlab_token = user.get("gitlab_token")
    if not gitlab_token:
        raise HTTPException(status_code=401, detail="GitLab 세션이 만료됐습니다. 다시 로그인해 주세요.")

    # ITSM 첨부파일을 대상 개발 프로젝트로 재업로드하고 URL 교체
    # (재업로드 실패 시 ITSM GitLab URL로 fallback)
    description = _forward_attachments(
        description, data.target_project_id, gitlab_token, settings.GITLAB_EXTERNAL_URL
    )

    # 소스 티켓 라벨 수집: status:: 는 전달 시 항상 접수됨(open)으로 초기화
    source_labels = [lb for lb in issue.get("labels", []) if not lb.startswith("status::")]
    source_labels.append("status::open")

    # 대상 프로젝트에 라벨 보장 (그룹 토큰으로, 실패 무시)
    group_token = settings.GITLAB_GROUP_TOKEN
    if source_labels and group_token:
        try:
            gitlab_client.ensure_project_labels(
                data.target_project_id, source_labels, group_token
            )
        except Exception as e:
            logger.warning("Could not ensure labels in target project %s: %s", data.target_project_id, e)

    try:
        new_issue = gitlab_client.create_issue(
            title=title,
            description=description,
            labels=source_labels,
            project_id=data.target_project_id,
            gitlab_token=gitlab_token,
        )
    except Exception as e:
        logger.error("create_forward: GitLab issue creation failed for project %s: %s", data.target_project_id, e)
        raise HTTPException(status_code=502, detail="개발 프로젝트 이슈 생성에 실패했습니다.")

    fwd = models.ProjectForward(
        source_iid=iid,
        source_project_id=source_project_id,
        target_project_id=data.target_project_id,
        target_project_name=data.target_project_name,
        target_iid=new_issue["iid"],
        target_web_url=new_issue.get("web_url"),
        note=data.note,
        created_by=str(user["sub"]),
        created_by_name=user.get("name") or user.get("username", ""),
    )
    db.add(fwd)
    db.commit()
    db.refresh(fwd)

    # 개발 프로젝트에 웹훅 등록 — 이슈 상태 변경 시 ITSM에 실시간 통보
    # 웹훅 등록은 Maintainer 이상 권한 필요 → 사용자 OAuth 토큰 대신 그룹 서비스 토큰 사용
    itsm_webhook_url = settings.ITSM_WEBHOOK_URL
    if itsm_webhook_url:
        try:
            hook_token = settings.GITLAB_GROUP_TOKEN or None  # 그룹 토큰 우선, 없으면 프로젝트 서비스 토큰
            gitlab_client.register_project_webhook(
                project_id=data.target_project_id,
                url=itsm_webhook_url,
                secret=settings.GITLAB_WEBHOOK_SECRET,
                gitlab_token=hook_token,
            )
            logger.info(
                "Registered webhook on dev project %s for ticket #%s",
                data.target_project_id, iid,
            )
        except Exception as e:
            # 웹훅 등록 실패는 비치명적 — 전달 자체는 성공으로 처리
            logger.warning(
                "Could not register webhook on dev project %s: %s",
                data.target_project_id, e,
            )

    return _fmt(fwd)


@router.get("/{iid}/forwards")
def list_forwards(
    iid: int,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    user: dict = Depends(require_developer),
):
    """티켓의 개발 프로젝트 전달 목록 조회.

    각 전달 이슈의 현재 GitLab 상태를 사용자 토큰으로 실시간 조회해 포함한다.
    모든 전달 이슈가 closed일 때 all_closed=true를 반환해
    에이전트가 ITSM 티켓 종결 여부를 판단할 수 있다.
    """
    settings = get_settings()
    source_project_id = project_id or str(settings.GITLAB_PROJECT_ID)
    gitlab_token = user.get("gitlab_token")  # 타 프로젝트 접근에 사용자 토큰 필요

    forwards = (
        db.query(models.ProjectForward)
        .filter(
            models.ProjectForward.source_iid == iid,
            models.ProjectForward.source_project_id == source_project_id,
        )
        .order_by(models.ProjectForward.created_at.desc())
        .all()
    )

    items = []
    for f in forwards:
        target_issue = None
        if f.target_iid:
            try:
                target_issue = gitlab_client.get_issue(
                    f.target_iid,
                    project_id=f.target_project_id,
                    gitlab_token=gitlab_token,
                )
            except Exception:
                pass  # 접근 불가 또는 삭제된 이슈
        items.append(_fmt(f, target_issue))

    all_closed = bool(items) and all(i["target_state"] == "closed" for i in items)

    # ── 자동 상태 동기화 ──────────────────────────────────────────────────
    # 모든 전달 이슈가 조회 가능할 때만 동기화 (부분 정보로 업데이트 방지)
    accessible = [i["target_status"] for i in items if i["target_status"] is not None]
    if items and len(accessible) == len(items):
        min_forward_status = min(accessible, key=lambda s: _STATUS_RANK.get(s, 0))
        desired_itsm_status = _FORWARD_TO_ITSM.get(min_forward_status)
        if desired_itsm_status:
            _sync_main_ticket_status(iid, source_project_id, desired_itsm_status)

    return {"forwards": items, "all_closed": all_closed}


@router.delete("/{iid}/forwards/{forward_id}", status_code=204)
def delete_forward(
    iid: int,
    forward_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """전달 기록 삭제 (admin 전용)."""
    fwd = (
        db.query(models.ProjectForward)
        .filter(
            models.ProjectForward.id == forward_id,
            models.ProjectForward.source_iid == iid,
        )
        .first()
    )
    if not fwd:
        raise HTTPException(status_code=404, detail="전달 기록을 찾을 수 없습니다.")
    db.delete(fwd)
    db.commit()
