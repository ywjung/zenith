"""관리자 데이터 내보내기·가져오기 엔드포인트.

지원 형식: JSON (기본), CSV (간단한 테이블형 데이터)
지원 대상: 배정 규칙, SLA 정책, 빠른 답변, 공지사항
"""
import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...database import get_db
from ...rbac import require_admin

logger = logging.getLogger(__name__)

data_export_router = APIRouter()

_EXPORT_TARGETS = {
    "assignment-rules",
    "sla-policies",
    "quick-replies",
    "announcements",
    "escalation-policies",
}


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


# ── 내보내기 ──────────────────────────────────────────────────────────────────

@data_export_router.get("/export/{target}")
def export_data(
    target: str,
    fmt: str = Query("json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    """관리 데이터를 JSON 또는 CSV 형식으로 내보냅니다.

    target: assignment-rules | sla-policies | quick-replies | announcements | escalation-policies
    """
    if target not in _EXPORT_TARGETS:
        raise HTTPException(400, f"지원하지 않는 내보내기 대상: {target}. 가능: {sorted(_EXPORT_TARGETS)}")

    rows = _fetch_rows(target, db)

    if fmt == "csv":
        return _to_csv_response(rows, target)
    return _to_json_response(rows, target)


def _fetch_rows(target: str, db: Session) -> list[dict]:
    from ...models import AssignmentRule, SLAPolicy, QuickReply, Announcement, EscalationPolicy

    model_map: dict[str, Any] = {
        "assignment-rules": AssignmentRule,
        "sla-policies": SLAPolicy,
        "quick-replies": QuickReply,
        "announcements": Announcement,
        "escalation-policies": EscalationPolicy,
    }
    model = model_map[target]
    records = db.query(model).all()
    result = []
    for rec in records:
        row = {c.name: getattr(rec, c.name) for c in rec.__table__.columns}
        # datetime → ISO string
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
        result.append(row)
    return result


def _to_json_response(rows: list[dict], target: str) -> StreamingResponse:
    content = json.dumps({"target": target, "exported_at": _now_str(), "count": len(rows), "data": rows},
                         ensure_ascii=False, indent=2)

    def _gen():
        yield content.encode("utf-8")

    return StreamingResponse(
        _gen(),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{target}_{_now_str()}.json"'},
    )


def _to_csv_response(rows: list[dict], target: str) -> StreamingResponse:
    if not rows:
        headers = []
    else:
        headers = list(rows[0].keys())

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: str(v) if v is not None else "" for k, v in row.items()})
    csv_bytes = output.getvalue().encode("utf-8-sig")

    def _gen():
        yield csv_bytes

    return StreamingResponse(
        _gen(),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{target}_{_now_str()}.csv"'},
    )


# ── 가져오기 ──────────────────────────────────────────────────────────────────

@data_export_router.post("/import/{target}", status_code=201)
async def import_data(
    target: str,
    file: UploadFile = File(...),
    mode: str = Query("append", pattern="^(append|replace)$"),
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """JSON 파일에서 관리 데이터를 가져옵니다.

    mode=append: 기존 데이터 유지하고 새 항목 추가 (id 필드 무시)
    mode=replace: 기존 데이터를 모두 삭제하고 가져온 데이터로 대체 (주의!)
    """
    if target not in _EXPORT_TARGETS:
        raise HTTPException(400, f"지원하지 않는 가져오기 대상: {target}.")

    content_type = file.content_type or ""
    if "json" not in content_type and not (file.filename or "").endswith(".json"):
        raise HTTPException(400, "JSON 파일만 가져오기를 지원합니다.")

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:  # 10 MB
        raise HTTPException(400, "파일 크기가 10 MB를 초과합니다.")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"JSON 파싱 오류: {e}")

    if isinstance(payload, dict):
        rows = payload.get("data", [])
    elif isinstance(payload, list):
        rows = payload
    else:
        raise HTTPException(400, "가져오기 파일 형식이 올바르지 않습니다. {data: [...]} 또는 [...] 형식이어야 합니다.")

    if not isinstance(rows, list):
        raise HTTPException(400, "data 필드는 배열이어야 합니다.")

    imported, skipped = _import_rows(target, rows, mode, db, user)
    return {"imported": imported, "skipped": skipped, "mode": mode, "target": target}


def _import_rows(target: str, rows: list[dict], mode: str, db: Session, user: dict) -> tuple[int, int]:
    from ...models import AssignmentRule, SLAPolicy, QuickReply, Announcement, EscalationPolicy

    _READONLY_FIELDS = {"id", "created_at", "updated_at", "created_by"}
    _WRITABLE_COLUMNS: dict[str, set[str]] = {
        "assignment-rules": {"name", "match_category", "match_priority", "match_keywords",
                             "assignee_gitlab_id", "assignee_name", "priority", "enabled"},
        "sla-policies": {"priority", "response_hours", "resolve_hours"},
        "quick-replies": {"title", "body", "category", "created_by"},
        "announcements": {"title", "content", "type", "active", "starts_at", "ends_at"},
        "escalation-policies": {"name", "trigger", "delay_minutes", "action",
                                "target_user_id", "notify_email", "enabled"},
    }
    model_map: dict[str, Any] = {
        "assignment-rules": AssignmentRule,
        "sla-policies": SLAPolicy,
        "quick-replies": QuickReply,
        "announcements": Announcement,
        "escalation-policies": EscalationPolicy,
    }

    model = model_map[target]
    writable = _WRITABLE_COLUMNS[target]

    if mode == "replace":
        db.query(model).delete()
        db.flush()

    imported = skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        kwargs = {k: v for k, v in row.items() if k in writable and k not in _READONLY_FIELDS}
        if not kwargs:
            skipped += 1
            continue
        # created_by 필드가 있는 모델에 적용
        if hasattr(model, "created_by") and "created_by" not in kwargs:
            kwargs["created_by"] = user.get("username", "import")
        try:
            db.add(model(**kwargs))
            imported += 1
        except Exception as e:
            logger.warning("Import row skipped (%s): %s — row: %s", target, e, row)
            db.rollback()
            skipped += 1

    db.commit()
    return imported, skipped
