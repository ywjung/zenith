from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from ..auth import get_current_user
from ..schemas import TicketCreate, TicketResponse, CommentResponse, TicketUpdate, CommentCreate
from .. import gitlab_client

router = APIRouter(prefix="/tickets", tags=["tickets"])

CATEGORY_MAP = {
    "hardware": "하드웨어",
    "software": "소프트웨어",
    "network": "네트워크",
    "account": "계정/권한",
    "other": "기타",
}

PRIORITY_MAP = {
    "low": "낮음",
    "medium": "보통",
    "high": "높음",
    "critical": "긴급",
}


def _parse_labels(labels: list[str]) -> dict:
    result = {"category": None, "priority": "medium", "status": "open"}
    for label in labels:
        if label.startswith("cat::"):
            result["category"] = label[5:]
        elif label.startswith("prio::"):
            result["priority"] = label[6:]
        elif label.startswith("status::"):
            result["status"] = label[8:]
    return result


def _extract_meta(description: str) -> dict:
    """이슈 설명에서 신청자 정보 추출."""
    meta = {"employee_name": None, "employee_email": None, "body": description}
    lines = description.split("\n")
    body_lines = []
    in_meta = True
    for line in lines:
        if line.startswith("**신청자:**"):
            meta["employee_name"] = line.replace("**신청자:**", "").strip()
        elif line.startswith("**이메일:**"):
            meta["employee_email"] = line.replace("**이메일:**", "").strip()
        elif line.strip() == "---":
            in_meta = False
        elif not in_meta:
            body_lines.append(line)
    meta["body"] = "\n".join(body_lines).strip()
    return meta


def _issue_to_response(issue: dict) -> dict:
    label_info = _parse_labels(issue.get("labels", []))
    meta = _extract_meta(issue.get("description") or "")
    status = label_info["status"] if issue["state"] == "opened" else "closed"
    return {
        "iid": issue["iid"],
        "title": issue["title"],
        "description": meta["body"],
        "state": issue["state"],
        "labels": issue.get("labels", []),
        "created_at": issue["created_at"],
        "updated_at": issue["updated_at"],
        "web_url": issue["web_url"],
        "employee_name": meta["employee_name"],
        "employee_email": meta["employee_email"],
        "category": label_info["category"],
        "priority": label_info["priority"],
        "status": status,
    }


@router.get("/", response_model=list[dict])
def list_tickets(
    state: str = "all",
    category: Optional[str] = None,
    search: Optional[str] = None,
    _user: dict = Depends(get_current_user),
):
    try:
        gl_state = {"open": "opened", "closed": "closed"}.get(state, "all")
        labels = f"cat::{category}" if category else None
        issues = gitlab_client.get_issues(state=gl_state, labels=labels, search=search)
        return [_issue_to_response(i) for i in issues]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.post("/", response_model=dict, status_code=201)
def create_ticket(data: TicketCreate, _user: dict = Depends(get_current_user)):
    labels = [f"cat::{data.category}", f"prio::{data.priority}", "status::open"]
    description = (
        f"**신청자:** {data.employee_name}\n"
        f"**이메일:** {data.employee_email}\n\n"
        f"---\n\n"
        f"{data.description}"
    )
    try:
        issue = gitlab_client.create_issue(data.title, description, labels)
        return _issue_to_response(issue)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.get("/{iid}", response_model=dict)
def get_ticket(iid: int, _user: dict = Depends(get_current_user)):
    try:
        issue = gitlab_client.get_issue(iid)
        return _issue_to_response(issue)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.delete("/{iid}", status_code=204)
def delete_ticket(iid: int, _user: dict = Depends(get_current_user)):
    try:
        gitlab_client.delete_issue(iid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.patch("/{iid}", response_model=dict)
def update_ticket(iid: int, data: TicketUpdate, _user: dict = Depends(get_current_user)):
    try:
        issue = gitlab_client.get_issue(iid)
        current_labels = issue.get("labels", [])

        add_labels: list[str] = []
        remove_labels: list[str] = []
        state_event = None

        if data.status is not None:
            for label in current_labels:
                if label.startswith("status::"):
                    remove_labels.append(label)
            if data.status == "closed":
                state_event = "close"
                add_labels.append("status::resolved")
            elif data.status == "reopened":
                state_event = "reopen"
                add_labels.append("status::open")
            else:
                add_labels.append(f"status::{data.status}")

        if data.priority is not None:
            for label in current_labels:
                if label.startswith("prio::"):
                    remove_labels.append(label)
            add_labels.append(f"prio::{data.priority}")

        updated = gitlab_client.update_issue(
            iid,
            add_labels=add_labels or None,
            remove_labels=remove_labels or None,
            state_event=state_event,
        )
        return _issue_to_response(updated)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.post("/{iid}/comments", response_model=dict, status_code=201)
def add_comment(iid: int, data: CommentCreate, _user: dict = Depends(get_current_user)):
    try:
        note = gitlab_client.add_note(iid, data.body)
        return {
            "id": note["id"],
            "body": note["body"],
            "author_name": note["author"]["name"],
            "author_avatar": note["author"].get("avatar_url"),
            "created_at": note["created_at"],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")


@router.get("/{iid}/comments", response_model=list[dict])
def get_comments(iid: int, _user: dict = Depends(get_current_user)):
    try:
        notes = gitlab_client.get_notes(iid)
        # 시스템 노트 제외, 사람이 작성한 노트만 반환
        return [
            {
                "id": n["id"],
                "body": n["body"],
                "author_name": n["author"]["name"],
                "author_avatar": n["author"].get("avatar_url"),
                "created_at": n["created_at"],
            }
            for n in notes
            if not n.get("system", False)
        ]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitLab 연결 오류: {e}")
