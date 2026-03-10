from enum import Enum
from pydantic import BaseModel, Field, EmailStr, field_validator
from datetime import datetime, date
from typing import Optional


# ---------------------------------------------------------------------------
# Enum 타입 — 허용 값 집합 정의 (입력 유효성 + IDE 자동완성)
# ---------------------------------------------------------------------------

class CategoryEnum(str, Enum):
    HARDWARE = "hardware"
    SOFTWARE = "software"
    NETWORK = "network"
    ACCOUNT = "account"
    OTHER = "other"


class PriorityEnum(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class StatusEnum(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING = "waiting"
    RESOLVED = "resolved"
    CLOSED = "closed"
    REOPENED = "reopened"


class BulkActionEnum(str, Enum):
    CLOSE = "close"
    ASSIGN = "assign"
    SET_PRIORITY = "set_priority"


# ---------------------------------------------------------------------------
# Ticket schemas
# ---------------------------------------------------------------------------

class TicketCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=200, description="제목")
    description: str = Field(..., min_length=10, max_length=10000, description="상세 내용")
    category: str = Field(..., description="hardware|software|network|account|other")
    priority: PriorityEnum = Field(default=PriorityEnum.MEDIUM, description="우선순위")
    employee_name: str = Field(..., min_length=2, max_length=100, description="신청자 이름")
    employee_email: EmailStr = Field(..., description="신청자 이메일")
    project_id: Optional[str] = Field(default=None, description="GitLab 프로젝트 ID")
    assignee_id: Optional[int] = Field(default=None, description="담당자 GitLab 사용자 ID")
    department: Optional[str] = Field(default=None, max_length=100, description="부서")
    location: Optional[str] = Field(default=None, max_length=100, description="위치")
    sla_due_date: Optional[date] = Field(default=None, description="요청 처리 기한 (YYYY-MM-DD)")
    confidential: bool = False

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        allowed = {e.value for e in CategoryEnum}
        if v not in allowed:
            raise ValueError(f"허용된 카테고리: {', '.join(allowed)}")
        return v


class TicketResponse(BaseModel):
    iid: int
    title: str
    description: str
    state: str
    labels: list[str]
    created_at: str
    updated_at: str
    web_url: str
    employee_name: Optional[str] = None
    employee_email: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    status: str = "open"
    department: Optional[str] = None
    location: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    assignee_username: Optional[str] = None


class CommentResponse(BaseModel):
    id: int
    body: str
    author_name: str
    author_avatar: Optional[str] = None
    created_at: str
    internal: bool = False


class TicketUpdate(BaseModel):
    status: Optional[StatusEnum] = Field(default=None, description="티켓 상태")
    priority: Optional[PriorityEnum] = Field(default=None, description="우선순위")
    assignee_id: Optional[int] = Field(default=None, description="담당자 GitLab 사용자 ID (-1 = 해제)")
    title: Optional[str] = Field(default=None, min_length=5, max_length=200)
    description: Optional[str] = Field(default=None, min_length=10)
    category: Optional[str] = Field(default=None, description="카테고리")
    # 해결 노트 — resolved/closed 전환 시 에이전트 이상 권장 입력
    resolution_note: Optional[str] = Field(default=None, max_length=5000, description="해결 방법 요약")
    resolution_type: Optional[str] = Field(
        default=None,
        description="해결 유형: permanent_fix|workaround|no_action|duplicate|by_mr"
    )
    # 상태 변경 이유 (모든 상태 전환에 적용)
    change_reason: Optional[str] = Field(default=None, max_length=500, description="상태 변경 이유")

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {e.value for e in CategoryEnum}
        if v not in allowed:
            raise ValueError(f"허용된 카테고리: {', '.join(allowed)}")
        return v


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)
    internal: bool = False


class BulkUpdate(BaseModel):
    iids: list[int] = Field(..., min_length=1, max_length=100)
    project_id: str
    action: BulkActionEnum = Field(..., description="close|assign|set_priority")
    value: Optional[str] = Field(default=None, description="담당자 ID 또는 우선순위 값")


# ---------------------------------------------------------------------------
# Rating schemas
# ---------------------------------------------------------------------------

class RatingCreate(BaseModel):
    employee_name: Optional[str] = Field(default=None, max_length=100)
    employee_email: Optional[str] = Field(default=None, max_length=200)
    score: int = Field(..., ge=1, le=5, description="만족도 점수 (1~5)")
    comment: Optional[str] = Field(default=None, description="추가 의견")


class RatingUpdate(BaseModel):
    score: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(default=None)


class RatingResponse(BaseModel):
    id: int
    gitlab_issue_iid: int
    username: str
    employee_name: str
    score: int
    comment: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Admin 응답 모델 — _to_dict 헬퍼 대체
# ---------------------------------------------------------------------------

class AssignmentRuleResponse(BaseModel):
    id: int
    name: str
    enabled: bool
    priority: int
    match_category: Optional[str] = None
    match_priority: Optional[str] = None
    match_keyword: Optional[str] = None
    assignee_gitlab_id: int
    assignee_name: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SLARecordResponse(BaseModel):
    id: int
    gitlab_issue_iid: int
    project_id: str
    priority: Optional[str] = None
    sla_deadline: Optional[datetime] = None
    first_response_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    breached: bool = False
    breach_notified: bool = False

    class Config:
        from_attributes = True


class SLAPolicyResponse(BaseModel):
    id: int
    priority: str
    response_hours: int
    resolve_hours: int
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ServiceTypeResponse(BaseModel):
    id: int
    value: str
    label: str
    description: Optional[str] = None
    emoji: str
    color: str
    sort_order: int
    enabled: bool
    context_label: Optional[str] = None
    context_options: list[str] = []
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
