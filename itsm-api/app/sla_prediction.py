"""과거 종료 티켓 데이터 기반 해결 시간 예측.

복잡한 ML 라이브러리 없이 중위수(median) 기반 통계 모델을 사용한다.
외부 의존성 없이 표준 라이브러리 statistics 모듈만 사용한다.
"""
import logging
import statistics
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from .models import SLARecord

logger = logging.getLogger(__name__)

# priority별 기본값 (시간) — 과거 데이터가 없을 때 사용
_DEFAULT_HOURS: dict[str, float] = {
    "critical": 8.0,
    "high": 24.0,
    "medium": 72.0,
    "low": 168.0,
}

# 신뢰도 임계값
_CONFIDENCE_HIGH = 50
_CONFIDENCE_MEDIUM = 10


def _median_hours(resolve_times: list[float]) -> float:
    """해결 시간(시간 단위) 리스트의 중위수를 반환한다."""
    return statistics.median(resolve_times)


def _query_resolve_hours(
    db: Session,
    priority: str,
    project_id: str,
    category: Optional[str],
    assignee_id: Optional[int],
) -> tuple[list[float], str]:
    """조건에 맞는 종료 SLA 레코드에서 해결 시간 목록과 적용된 조건 설명을 반환한다.

    우선순위:
    1. priority + category + assignee (3중 조건)
    2. priority + category
    3. priority만

    각 조건에서 결과가 1건 이상이면 해당 결과를 반환한다.
    """
    base_q = (
        db.query(SLARecord)
        .filter(
            SLARecord.project_id == project_id,
            SLARecord.priority == priority,
            SLARecord.resolved_at.isnot(None),
        )
    )

    def _extract_hours(records: list[SLARecord]) -> list[float]:
        result = []
        for rec in records:
            created = rec.created_at
            resolved = rec.resolved_at
            if created is None or resolved is None:
                continue
            # naive datetime 처리 — DB 저장값이 naive UTC라고 가정
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if resolved.tzinfo is None:
                resolved = resolved.replace(tzinfo=timezone.utc)
            elapsed = (resolved - created).total_seconds()
            if elapsed > 0:
                result.append(elapsed / 3600.0)
        return result

    # 1단계: priority + project (category/assignee는 SLARecord에 없으므로 프로젝트 범위로 동작)
    # SLARecord는 priority와 project_id만 보유하므로 3단계 폴백은 priority만으로 진행
    # category와 assignee_id는 미래 확장을 위한 파라미터이나 현재 모델에서는 무시됨
    records = base_q.all()
    hours = _extract_hours(records)
    if hours:
        return hours, "priority+project"

    return [], "priority"


def get_median_resolve_hours(
    db: Session,
    priority: str,
    project_id: str,
    category: Optional[str] = None,
    assignee_id: Optional[int] = None,
) -> tuple[float, int, str]:
    """비슷한 조건의 과거 종료 티켓 중위수 해결 시간(시간), 샘플 수, 조건 설명을 반환한다.

    데이터 부족 시 priority 기반 기본값을 반환한다.
    """
    try:
        hours_list, basis = _query_resolve_hours(db, priority, project_id, category, assignee_id)
    except Exception as exc:
        logger.warning("SLA prediction query failed: %s", exc)
        hours_list, basis = [], "error_fallback"

    if hours_list:
        return _median_hours(hours_list), len(hours_list), basis

    # 기본값 폴백
    default = _DEFAULT_HOURS.get(priority, 72.0)
    return default, 0, "default"


def _confidence_level(sample_count: int) -> str:
    """샘플 수에 따른 신뢰도 레벨을 반환한다."""
    if sample_count >= _CONFIDENCE_HIGH:
        return "high"
    if sample_count >= _CONFIDENCE_MEDIUM:
        return "medium"
    if sample_count >= 1:
        return "low"
    return "default"


def predict_resolution(
    db: Session,
    iid: int,
    project_id: str,
    priority: str,
    created_at: datetime,
    category: Optional[str] = None,
    assignee_id: Optional[int] = None,
) -> dict:
    """티켓 해결 시간 예측 결과를 반환한다.

    Returns:
        {
            "predicted_hours": 12.5,
            "predicted_at": "2026-03-23T15:30:00Z",
            "confidence": "high",   # high | medium | low | default
            "sample_count": 127,
            "basis": "priority+project"
        }
    """
    median_hours, sample_count, basis = get_median_resolve_hours(
        db, priority, project_id, category, assignee_id
    )

    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    from datetime import timedelta
    predicted_at = created_at + timedelta(hours=median_hours)

    return {
        "predicted_hours": round(median_hours, 1),
        "predicted_at": predicted_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "confidence": _confidence_level(sample_count),
        "sample_count": sample_count,
        "basis": basis,
    }
