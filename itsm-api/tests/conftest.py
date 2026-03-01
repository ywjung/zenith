"""
conftest.py — env vars MUST be patched before any app module is imported,
because database.py calls get_settings() at module level.
"""
import os

# Patch env before importing app
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["GITLAB_API_URL"] = "http://fake-gitlab"
os.environ["GITLAB_ADMIN_TOKEN"] = "test-token"
os.environ["GITLAB_PROJECT_ID"] = "1"
os.environ["ENVIRONMENT"] = "development"
os.environ["CORS_ORIGINS"] = "http://localhost"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Invalidate lru_cache so Settings picks up patched env
from app.config import get_settings
get_settings.cache_clear()

from app.database import Base, get_db
from app.main import app

TEST_DATABASE_URL = "sqlite:///./test.db"
test_engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session():
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
def client():
    return TestClient(app)
