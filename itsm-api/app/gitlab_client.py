import httpx
from typing import Optional

from .config import get_settings


def _base() -> str:
    s = get_settings()
    return f"{s.GITLAB_API_URL}/api/v4/projects/{s.GITLAB_PROJECT_ID}"


def _headers() -> dict:
    return {"PRIVATE-TOKEN": get_settings().GITLAB_ADMIN_TOKEN, "Content-Type": "application/json"}


def create_issue(title: str, description: str, labels: list[str]) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_base()}/issues",
            headers=_headers(),
            json={"title": title, "description": description, "labels": ",".join(labels)},
        )
        resp.raise_for_status()
        return resp.json()


def get_issues(
    state: str = "all",
    labels: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict]:
    params: dict = {"per_page": 100, "order_by": "created_at", "sort": "desc"}
    if state != "all":
        params["state"] = state
    if labels:
        params["labels"] = labels
    if search:
        params["search"] = search

    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{_base()}/issues", headers=_headers(), params=params)
        resp.raise_for_status()
        return resp.json()


def get_issue(iid: int) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{_base()}/issues/{iid}", headers=_headers())
        resp.raise_for_status()
        return resp.json()


def get_notes(iid: int) -> list[dict]:
    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{_base()}/issues/{iid}/notes",
            headers=_headers(),
            params={"per_page": 100, "sort": "asc"},
        )
        resp.raise_for_status()
        return resp.json()


def add_note(iid: int, body: str) -> dict:
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{_base()}/issues/{iid}/notes",
            headers=_headers(),
            json={"body": body},
        )
        resp.raise_for_status()
        return resp.json()


def update_issue(
    iid: int,
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
    state_event: str | None = None,
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
            f"{_base()}/issues/{iid}",
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
