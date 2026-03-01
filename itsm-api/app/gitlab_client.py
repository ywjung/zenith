import httpx
from typing import Optional

from .config import get_settings


def _base(project_id: Optional[str] = None) -> str:
    s = get_settings()
    pid = project_id or s.GITLAB_PROJECT_ID
    return f"{s.GITLAB_API_URL}/api/v4/projects/{pid}"


def _headers() -> dict:
    return {"PRIVATE-TOKEN": get_settings().GITLAB_ADMIN_TOKEN, "Content-Type": "application/json"}


def get_user_projects(user_id: str) -> list[dict]:
    """사용자가 접근 가능한 GitLab 프로젝트 목록 반환.

    Admin token으로 전체 프로젝트를 조회한 후, 해당 사용자가 멤버인 프로젝트만 반환.
    멤버십 정보가 없으면 전체 프로젝트를 반환.
    """
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{get_settings().GITLAB_API_URL}/api/v4/projects",
            headers=_headers(),
            params={"per_page": 100, "simple": True, "order_by": "name", "sort": "asc"},
        )
        resp.raise_for_status()
        all_projects = resp.json()

        # 사용자 멤버십 조회 (GET /api/v4/users/{user_id}/memberships)
        try:
            membership_resp = client.get(
                f"{get_settings().GITLAB_API_URL}/api/v4/users/{user_id}/memberships",
                headers=_headers(),
                params={"type": "Project", "per_page": 100},
            )
            if membership_resp.is_success:
                memberships = membership_resp.json()
                member_project_ids = {str(m["source_id"]) for m in memberships if m.get("source_type") == "Project"}
                if member_project_ids:
                    return [p for p in all_projects if str(p["id"]) in member_project_ids]
        except Exception:
            pass

        return all_projects


def create_issue(title: str, description: str, labels: list[str], project_id: Optional[str] = None) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_base(project_id)}/issues",
            headers=_headers(),
            json={"title": title, "description": description, "labels": ",".join(labels)},
        )
        resp.raise_for_status()
        return resp.json()


def get_issues(
    state: str = "all",
    labels: Optional[str] = None,
    search: Optional[str] = None,
    project_id: Optional[str] = None,
) -> list[dict]:
    params: dict = {"per_page": 100, "order_by": "created_at", "sort": "desc"}
    if state != "all":
        params["state"] = state
    if labels:
        params["labels"] = labels
    if search:
        params["search"] = search

    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{_base(project_id)}/issues", headers=_headers(), params=params)
        resp.raise_for_status()
        return resp.json()


def get_issue(iid: int, project_id: Optional[str] = None) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{_base(project_id)}/issues/{iid}", headers=_headers())
        resp.raise_for_status()
        return resp.json()


def get_notes(iid: int, project_id: Optional[str] = None) -> list[dict]:
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{_base(project_id)}/issues/{iid}/notes",
            headers=_headers(),
            params={"per_page": 100, "sort": "asc"},
        )
        resp.raise_for_status()
        return resp.json()


def add_note(iid: int, body: str, project_id: Optional[str] = None) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_base(project_id)}/issues/{iid}/notes",
            headers=_headers(),
            json={"body": body},
        )
        resp.raise_for_status()
        return resp.json()


def delete_issue(iid: int, project_id: Optional[str] = None) -> None:
    with httpx.Client(timeout=30) as client:
        resp = client.delete(f"{_base(project_id)}/issues/{iid}", headers=_headers())
        resp.raise_for_status()


def update_issue(
    iid: int,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
    state_event: str | None = None,
    project_id: Optional[str] = None,
) -> dict:
    payload: dict = {}
    if add_labels:
        payload["add_labels"] = ",".join(add_labels)
    if remove_labels:
        payload["remove_labels"] = ",".join(remove_labels)
    if state_event:
        payload["state_event"] = state_event
    with httpx.Client(timeout=30) as client:
        resp = client.put(
            f"{_base(project_id)}/issues/{iid}",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


def ensure_labels() -> None:
    """GitLab 프로젝트에 필수 라벨을 생성한다 (이미 존재하면 무시)."""
    labels = [
        ("status::open", "#5cb85c"),
        ("status::in_progress", "#0275d8"),
        ("status::resolved", "#5bc0de"),
        ("cat::hardware", "#f0ad4e"),
        ("cat::software", "#d9534f"),
        ("cat::network", "#9b59b6"),
        ("cat::account", "#1abc9c"),
        ("cat::other", "#95a5a6"),
        ("prio::low", "#bdc3c7"),
        ("prio::medium", "#f39c12"),
        ("prio::high", "#e67e22"),
        ("prio::critical", "#e74c3c"),
    ]
    with httpx.Client(timeout=30) as client:
        for name, color in labels:
            try:
                client.post(
                    f"{_base()}/labels",
                    headers=_headers(),
                    json={"name": name, "color": color},
                )
            except Exception:
                pass  # 이미 존재하면 무시
