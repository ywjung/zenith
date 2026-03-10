from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=_settings.DB_POOL_SIZE,
    max_overflow=_settings.DB_MAX_OVERFLOW,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
