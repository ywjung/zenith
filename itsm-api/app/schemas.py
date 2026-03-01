from pydantic import BaseModel, Field, EmailStr
from datetime import datetime
from typing import Optional


class TicketCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=200, description="제목")
    description: str = Field(..., min_length=10, description="상세 내용")
    category: str = Field(..., description="hardware|software|network|account|other")
    priority: str = Field(default="medium", description="low|medium|high|critical")
    employee_name: str = Field(..., min_length=2, max_length=100, description="신청자 이름")
    employee_email: str = Field(..., max_length=200, description="신청자 이메일")


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


class CommentResponse(BaseModel):
    id: int
    body: str
    author_name: str
    author_avatar: Optional[str] = None
    created_at: str


class RatingCreate(BaseModel):
    employee_name: str = Field(..., min_length=2, max_length=100)
    employee_email: Optional[str] = Field(default=None, max_length=200)
    score: int = Field(..., ge=1, le=5, description="만족도 점수 (1~5)")
    comment: Optional[str] = Field(default=None, description="추가 의견")


class RatingResponse(BaseModel):
    id: int
    gitlab_issue_iid: int
    employee_name: str
    score: int
    comment: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
