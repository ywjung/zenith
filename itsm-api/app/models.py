from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime
from .database import Base


class Rating(Base):
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True, index=True)
    gitlab_issue_iid = Column(Integer, nullable=False, index=True, unique=True)
    employee_name = Column(String(100), nullable=False)
    employee_email = Column(String(200))
    score = Column(Integer, nullable=False)  # 1~5
    comment = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
