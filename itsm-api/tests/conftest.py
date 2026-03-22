"""
conftest.py — env vars MUST be patched before any app module is imported,
because database.py calls get_settings() at module level.

SQLite compatibility:
  1. PostgreSQL-specific types (JSONB, ARRAY, INET) → generic SQLAlchemy types
  2. create_engine called with pool_size/max_overflow → stripped for SQLite
  3. StaticPool ensures all connections share the same in-memory database
"""
import os

# ── env vars (before any app import) ──────────────────────────────────────────
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["GITLAB_API_URL"] = "http://fake-gitlab"
os.environ["GITLAB_ADMIN_TOKEN"] = "test-token"
os.environ["GITLAB_PROJECT_ID"] = "1"
os.environ["ENVIRONMENT"] = "development"
os.environ["CORS_ORIGINS"] = "http://localhost"
os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-chars-long"
os.environ["REDIS_URL"] = "memory://"  # makes slowapi use in-memory rate limit (no Redis needed)
os.environ["SUDO_MODE_ENABLED"] = "false"  # disable sudo checks in tests

# ── SQLite type shim ───────────────────────────────────────────────────────────
from sqlalchemy import JSON, String  # noqa: E402
import sqlalchemy.dialects.postgresql as _pg  # noqa: E402
import sqlalchemy.dialects.postgresql.types as _pg_types  # noqa: E402

class _FakeINET(String):
    """SQLite stand-in for PostgreSQL INET."""

_PG_REPLACEMENTS = {
    "JSONB": JSON,
    "ARRAY": JSON,
    "TSVECTOR": JSON,
    "INET": _FakeINET,
}
for _mod in (_pg, _pg_types):
    for _name, _replacement in _PG_REPLACEMENTS.items():
        if hasattr(_mod, _name):
            setattr(_mod, _name, _replacement)

# ── create_engine shim: strip PG-only pool kwargs for SQLite ─────────────────
import sqlalchemy as _sa  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

_original_create_engine = _sa.create_engine

def _sqlite_safe_create_engine(url, **kwargs):
    url_str = str(url)
    if url_str.startswith("sqlite"):
        for k in ("pool_size", "max_overflow"):
            kwargs.pop(k, None)
        # StaticPool: all connections share the same in-memory DB across fixtures
        kwargs["poolclass"] = StaticPool
        kwargs.setdefault("connect_args", {}).setdefault("check_same_thread", False)
    return _original_create_engine(url, **kwargs)

_sa.create_engine = _sqlite_safe_create_engine

# ── app imports (after patches) ───────────────────────────────────────────────
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.config import get_settings  # noqa: E402
get_settings.cache_clear()

# ── Mock Redis to prevent ConnectionError in tests ────────────────────────────
from unittest.mock import MagicMock, patch as _patch  # noqa: E402

_mock_redis = MagicMock()
_mock_redis.get.return_value = None     # Cache miss → real DB query
_mock_redis.set.return_value = True
_mock_redis.delete.return_value = 1
_mock_redis.ttl.return_value = -2       # Key not found → no cached gitlab token
_mock_redis.setex.return_value = True
_mock_redis.exists.return_value = False
_mock_redis.incr.return_value = 1
_mock_redis.expire.return_value = True
_mock_redis.scan.return_value = (0, [])  # Empty scan → scan_delete exits immediately

# Patch all Redis connection points (auth imports get_redis locally so patch the source)
_redis_patches = [
    _patch("app.redis_client.get_redis", return_value=_mock_redis),
]
for _p in _redis_patches:
    _p.start()

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# Single in-memory engine (StaticPool keeps the DB alive for the entire session)
test_engine = _sqlite_safe_create_engine("sqlite:///:memory:")
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_db():
    """Drop → recreate schema before each test for a clean slate."""
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    yield


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


# ── auth helpers ──────────────────────────────────────────────────────────────

import time
from jose import jwt as _jwt

TEST_SECRET = "test-secret-key-at-least-32-chars-long"
TEST_ALGORITHM = "HS256"


def make_token(role: str = "user", user_id: str = "42", name: str = "홍길동", username: str = "hong", email: str = "hong@example.com") -> str:
    """Create a test JWT without 'jti' so Redis check is skipped."""
    payload = {
        "sub": user_id,
        "role": role,
        "name": name,
        "username": username,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + 7200,
        # No 'jti' — avoids Redis gl_token check in get_current_user
        # Include gitlab_token directly since VULN-01 Redis lookup is skipped without jti
        "gitlab_token": "test-gitlab-token",
    }
    return _jwt.encode(payload, TEST_SECRET, algorithm=TEST_ALGORITHM)


def auth_cookies(role: str = "user", user_id: str = "42") -> dict:
    """Return cookie dict for use with TestClient requests."""
    return {"itsm_token": make_token(role=role, user_id=user_id)}


@pytest.fixture
def user_cookies():
    return auth_cookies("user")


@pytest.fixture
def admin_cookies():
    return auth_cookies("admin")


@pytest.fixture
def developer_cookies():
    return auth_cookies("developer", user_id="200")
