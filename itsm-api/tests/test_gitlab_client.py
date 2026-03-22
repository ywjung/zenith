"""Unit tests for app/gitlab_client.py — circuit breaker, headers, label utilities."""
from unittest.mock import patch, MagicMock


# ── circuit breaker ───────────────────────────────────────────────────────────

def test_record_success_resets_failures():
    import app.gitlab_client as gc
    gc._cb_failures = 3
    gc._record_success()
    assert gc._cb_failures == 0


def test_record_failure_increments():
    import app.gitlab_client as gc
    gc._cb_failures = 0
    gc._record_failure()
    assert gc._cb_failures == 1


def test_record_failure_opens_circuit_at_threshold():
    import app.gitlab_client as gc
    import time
    gc._cb_failures = gc._CB_THRESHOLD - 1
    gc._record_failure()
    assert gc._cb_failures == gc._CB_THRESHOLD
    # Reset
    gc._cb_failures = 0


def test_check_circuit_raises_when_open():
    import app.gitlab_client as gc
    import time
    gc._cb_failures = gc._CB_THRESHOLD
    gc._cb_opened_at = time.monotonic()  # Just opened
    try:
        import pytest
        with pytest.raises(RuntimeError, match="circuit open"):
            gc._check_circuit()
    finally:
        gc._cb_failures = 0


def test_check_circuit_passes_when_ok():
    import app.gitlab_client as gc
    gc._cb_failures = 0
    # Should not raise
    gc._check_circuit()


# ── _headers / _get_headers ───────────────────────────────────────────────────

def test_headers_raises_without_token():
    import pytest
    from app.gitlab_client import _headers
    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = ""
        with pytest.raises(RuntimeError, match="GITLAB_PROJECT_TOKEN"):
            _headers()


def test_headers_returns_private_token():
    from app.gitlab_client import _headers
    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "mytoken"
        h = _headers()
    assert h["PRIVATE-TOKEN"] == "mytoken"


def test_get_headers_with_gitlab_token():
    from app.gitlab_client import _get_headers
    h = _get_headers("user-bearer-token")
    assert h["Authorization"] == "Bearer user-bearer-token"


def test_get_headers_without_gitlab_token_falls_back():
    from app.gitlab_client import _get_headers
    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "svctoken"
        h = _get_headers(None)
    assert "PRIVATE-TOKEN" in h


# ── _base ────────────────────────────────────────────────────────────────────

def test_base_uses_config_project_id():
    from app.gitlab_client import _base
    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "42"
        result = _base()
    assert "42" in result
    assert "gitlab.example.com" in result


def test_base_overrides_project_id():
    from app.gitlab_client import _base
    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "42"
        result = _base("99")
    assert "99" in result


# ── get_users_by_usernames ───────────────────────────────────────────────────

def test_get_users_by_usernames_empty():
    from app.gitlab_client import get_users_by_usernames
    result = get_users_by_usernames([])
    assert result == {}


def test_get_users_by_usernames_from_cache():
    from app.gitlab_client import get_users_by_usernames
    mock_redis = MagicMock()
    # mget returns list of values (one per key)
    mock_redis.mget.return_value = ["홍길동"]
    with patch("app.gitlab_client._redis_client", return_value=mock_redis):
        result = get_users_by_usernames(["hong"])
    assert result.get("hong") == "홍길동"


def test_get_users_by_usernames_no_cache_fetches_from_api():
    from app.gitlab_client import get_users_by_usernames
    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None]  # cache miss

    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = [{"username": "hong", "name": "홍길동"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._redis_client", return_value=mock_redis),
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = get_users_by_usernames(["hong"])
    assert result.get("hong") == "홍길동"


# ── get_category_labels_from_db ───────────────────────────────────────────────

def test_get_category_labels_from_db():
    from app.gitlab_client import get_category_labels_from_db
    from app.models import ServiceType
    mock_type = MagicMock(spec=ServiceType)
    mock_type.value = "software"
    mock_type.color = "#3498db"
    mock_db = MagicMock()
    mock_db.__enter__.return_value = mock_db
    mock_db.query.return_value.all.return_value = [mock_type]
    with patch("app.database.SessionLocal", return_value=mock_db):
        result = get_category_labels_from_db()
    assert ("cat::software", "#3498db") in result


def test_get_category_labels_from_db_fallback_on_error():
    from app.gitlab_client import get_category_labels_from_db
    with patch("app.database.SessionLocal", side_effect=Exception("DB 오류")):
        result = get_category_labels_from_db()
    # On error, returns empty list
    assert isinstance(result, list)


# ── search_issues ────────────────────────────────────────────────────────────

def test_search_issues_returns_results():
    from app.gitlab_client import search_issues
    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = [{"iid": 1, "title": "테스트"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        result = search_issues("테스트")
    assert len(result) == 1


# ── get_user_accessible_projects ─────────────────────────────────────────────

def test_get_user_accessible_projects_returns_list():
    from app.gitlab_client import get_user_accessible_projects
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"id": 1, "name": "proj1"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = get_user_accessible_projects("user-oauth-token")
    assert len(result) == 1
    assert result[0]["name"] == "proj1"
    # Verify Authorization header used
    _, kwargs = mock_client.get.call_args
    assert "Authorization" in kwargs.get("headers", {})


# ── get_user_projects ─────────────────────────────────────────────────────────

def test_get_user_projects_single_page():
    from app.gitlab_client import get_user_projects
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"id": 10, "name": "p10"}]  # < 100 → last page
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = get_user_projects("42")
    assert len(result) == 1


def test_get_user_projects_paginates():
    from app.gitlab_client import get_user_projects
    page1 = [{"id": i} for i in range(100)]
    page2 = [{"id": 200}]
    mock_response1, mock_response2 = MagicMock(), MagicMock()
    mock_response1.raise_for_status.return_value = None
    mock_response1.json.return_value = page1
    mock_response2.raise_for_status.return_value = None
    mock_response2.json.return_value = page2
    mock_client = MagicMock()
    mock_client.get.side_effect = [mock_response1, mock_response2]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        result = get_user_projects("1")
    assert len(result) == 101


# ── get_project_members ───────────────────────────────────────────────────────

def test_get_project_members_returns_members():
    from app.gitlab_client import get_project_members
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"id": 5, "username": "dev1"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        result = get_project_members("1")
    assert result[0]["username"] == "dev1"


# ── get_group_members ─────────────────────────────────────────────────────────

def test_get_group_members_success():
    from app.gitlab_client import get_group_members
    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = [{"id": 7, "username": "grp_user"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "grp-tok"
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "prj-tok"
        result = get_group_members("99")
    assert result[0]["username"] == "grp_user"


def test_get_group_members_non_success_returns_empty():
    from app.gitlab_client import get_group_members
    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 403
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "https://gitlab.example.com"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = ""
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "prj-tok"
        result = get_group_members("99")
    assert result == []


# ── create_issue ──────────────────────────────────────────────────────────────

def test_create_issue_success():
    from app.gitlab_client import create_issue
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 42, "title": "New Issue"}
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = create_issue("Test", "desc", ["bug"])
    assert result["iid"] == 42


def test_create_issue_with_assignee_and_milestone():
    from app.gitlab_client import create_issue
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 1}
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = create_issue("T", "d", [], assignee_id=5, milestone_id=3, confidential=True)
    _, kwargs = mock_client.post.call_args
    payload = kwargs["json"]
    assert payload["assignee_ids"] == [5]
    assert payload["milestone_id"] == 3
    assert payload["confidential"] is True


def test_create_issue_failure_records_and_raises():
    from app.gitlab_client import create_issue
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_client = MagicMock()
    mock_client.post.side_effect = Exception("network error")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    import pytest
    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        with pytest.raises(Exception, match="network error"):
            create_issue("T", "d", [])
    assert gc._cb_failures >= 1
    gc._cb_failures = 0


# ── get_issues ────────────────────────────────────────────────────────────────

def test_get_issues_returns_issues_and_total():
    from app.gitlab_client import get_issues
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"iid": 1}, {"iid": 2}]
    mock_response.headers = {"X-Total": "50"}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        issues, total = get_issues()
    assert len(issues) == 2
    assert total == 50


def test_get_issues_missing_x_total_falls_back_to_len():
    from app.gitlab_client import get_issues
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"iid": 1}]
    mock_response.headers = {}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        issues, total = get_issues()
    assert total == 1


def test_get_issues_with_all_optional_params():
    from app.gitlab_client import get_issues
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = []
    mock_response.headers = {"X-Total": "0"}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        issues, total = get_issues(
            state="opened", labels="bug", not_labels="wontfix",
            search="query", order_by="updated_at", sort="asc",
            created_after="2024-01-01", created_before="2024-12-31",
            updated_after="2024-06-01", updated_before="2024-12-31",
            author_username="alice", assignee_username="bob",
        )
    _, kwargs = mock_client.get.call_args
    params = kwargs["params"]
    assert params["state"] == "opened"
    assert params["labels"] == "bug"
    assert params["author_username"] == "alice"
    assert params["assignee_username"] == "bob"
    assert params["order_by"] == "updated_at"


def test_get_issues_invalid_order_by_falls_back():
    from app.gitlab_client import get_issues
    import app.gitlab_client as gc
    gc._cb_failures = 0

    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = []
    mock_response.headers = {}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        get_issues(order_by="injected_field; DROP TABLE", sort="invalid_sort")
    _, kwargs = mock_client.get.call_args
    params = kwargs["params"]
    assert params["order_by"] == "created_at"
    assert params["sort"] == "desc"


def test_get_issues_exception_records_failure():
    from app.gitlab_client import get_issues
    import app.gitlab_client as gc
    gc._cb_failures = 0
    import pytest

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("timeout")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        with pytest.raises(Exception, match="timeout"):
            get_issues()
    assert gc._cb_failures >= 1
    gc._cb_failures = 0


# ── get_all_issues ────────────────────────────────────────────────────────────

def test_get_all_issues_single_page():
    from app.gitlab_client import get_all_issues
    with patch("app.gitlab_client.get_issues", return_value=([{"iid": i} for i in range(5)], 5)):
        result = get_all_issues()
    assert len(result) == 5


def test_get_all_issues_paginates_until_empty():
    from app.gitlab_client import get_all_issues
    page1 = [{"iid": i} for i in range(100)]
    page2 = [{"iid": i + 100} for i in range(50)]
    call_results = [
        (page1, 150),
        (page2, 150),
        ([], 150),
    ]
    with patch("app.gitlab_client.get_issues", side_effect=call_results):
        result = get_all_issues()
    assert len(result) == 150


def test_get_all_issues_respects_max_results():
    from app.gitlab_client import get_all_issues
    page1 = [{"iid": i} for i in range(100)]
    page2 = [{"iid": i + 100} for i in range(100)]
    call_results = [
        (page1, 500),
        (page2, 500),
    ]
    with patch("app.gitlab_client.get_issues", side_effect=call_results):
        result = get_all_issues(max_results=150)
    assert len(result) == 150


# ── get_issue ─────────────────────────────────────────────────────────────────

def test_get_issue_returns_dict():
    from app.gitlab_client import get_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 7, "title": "Issue 7"}
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = get_issue(7)
    assert result["iid"] == 7


# ── get_notes ─────────────────────────────────────────────────────────────────

def test_get_notes_returns_all_notes():
    from app.gitlab_client import get_notes
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = [{"id": 1, "body": "note1"}, {"id": 2, "body": "note2"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = get_notes(1)
    assert len(result) == 2
    assert result[0]["body"] == "note1"


def test_get_notes_paginates():
    from app.gitlab_client import get_notes
    page1 = [{"id": i} for i in range(100)]
    page2 = [{"id": 200}]
    resp1, resp2 = MagicMock(), MagicMock()
    resp1.raise_for_status.return_value = None
    resp1.json.return_value = page1
    resp2.raise_for_status.return_value = None
    resp2.json.return_value = page2
    mock_client = MagicMock()
    mock_client.get.side_effect = [resp1, resp2]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = get_notes(1)
    assert len(result) == 101


# ── add_note ──────────────────────────────────────────────────────────────────

def test_add_note_returns_note():
    from app.gitlab_client import add_note
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"id": 99, "body": "hello"}
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = add_note(1, "hello")
    assert result["id"] == 99


def test_add_note_confidential_includes_flag():
    from app.gitlab_client import add_note
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"id": 100, "body": "secret"}
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        add_note(1, "secret", confidential=True)
    _, kwargs = mock_client.post.call_args
    assert kwargs["json"]["confidential"] is True


# ── delete_issue ──────────────────────────────────────────────────────────────

def test_delete_issue_calls_delete():
    from app.gitlab_client import delete_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_client = MagicMock()
    mock_client.delete.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        delete_issue(7)
    mock_client.delete.assert_called_once()


# ── update_issue ──────────────────────────────────────────────────────────────

def test_update_issue_basic():
    from app.gitlab_client import update_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 1, "state": "closed"}
    mock_client = MagicMock()
    mock_client.put.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        result = update_issue(1, state_event="close")
    assert result["state"] == "closed"
    _, kwargs = mock_client.put.call_args
    assert kwargs["json"]["state_event"] == "close"


def test_update_issue_all_params():
    from app.gitlab_client import update_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 1}
    mock_client = MagicMock()
    mock_client.put.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        update_issue(
            1,
            title="New Title",
            description="New desc",
            add_labels=["bug"],
            remove_labels=["feature"],
            assignee_id=5,
            milestone_id=10,
        )
    _, kwargs = mock_client.put.call_args
    payload = kwargs["json"]
    assert payload["title"] == "New Title"
    assert payload["description"] == "New desc"
    assert "bug" in payload["add_labels"]
    assert "feature" in payload["remove_labels"]
    assert payload["assignee_ids"] == [5]
    assert payload["milestone_id"] == 10


def test_update_issue_unassign():
    """assignee_id=-1 → assignee_ids=[]"""
    from app.gitlab_client import update_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 1}
    mock_client = MagicMock()
    mock_client.put.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        update_issue(1, assignee_id=-1)
    _, kwargs = mock_client.put.call_args
    assert kwargs["json"]["assignee_ids"] == []


def test_update_issue_remove_milestone():
    """milestone_id=0 → milestone_id=None"""
    from app.gitlab_client import update_issue
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"iid": 1}
    mock_client = MagicMock()
    mock_client.put.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        update_issue(1, milestone_id=0)
    _, kwargs = mock_client.put.call_args
    assert kwargs["json"]["milestone_id"] is None


# ── upload_file ───────────────────────────────────────────────────────────────

def test_upload_file_returns_result():
    from app.gitlab_client import upload_file
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"url": "/uploads/file.png", "full_path": "/-/project/1/uploads/abc/file.png"}
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_TOKEN = "tok"
        result = upload_file("1", "file.png", b"content", "image/png")
    assert "proxy_path" in result
    assert result["proxy_path"] == "/-/project/1/uploads/abc/file.png"


# ── get_category_labels_with_meta ─────────────────────────────────────────────

def test_get_category_labels_with_meta_returns_list():
    from app.gitlab_client import get_category_labels_with_meta
    from app.models import ServiceType
    mock_type = MagicMock(spec=ServiceType)
    mock_type.value = "software"
    mock_type.color = "#3498db"
    mock_type.label = "소프트웨어"
    mock_type.emoji = "💻"
    mock_type.enabled = True
    mock_type.sort_order = 1
    mock_type.id = 1
    mock_db = MagicMock()
    mock_db.__enter__.return_value = mock_db
    mock_db.query.return_value.order_by.return_value.all.return_value = [mock_type]
    with patch("app.database.SessionLocal", return_value=mock_db):
        result = get_category_labels_with_meta()
    assert result[0]["name"] == "cat::software"
    assert result[0]["service_label"] == "소프트웨어"


def test_get_category_labels_with_meta_fallback_on_error():
    from app.gitlab_client import get_category_labels_with_meta
    with patch("app.database.SessionLocal", side_effect=Exception("DB error")):
        result = get_category_labels_with_meta()
    assert result == []


# ── sync_label_to_gitlab ──────────────────────────────────────────────────────

def test_sync_label_creates_new_label():
    from app.gitlab_client import sync_label_to_gitlab
    mock_get_resp = MagicMock()
    mock_get_resp.status_code = 404
    mock_client = MagicMock()
    mock_client.get.return_value = mock_get_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_GROUP_ID = ""
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = ""
        result = sync_label_to_gitlab("status::open", "#5cb85c")
    assert result is True
    mock_client.post.assert_called_once()


def test_sync_label_updates_existing():
    from app.gitlab_client import sync_label_to_gitlab
    mock_get_resp = MagicMock()
    mock_get_resp.status_code = 200
    mock_get_resp.is_success = True
    mock_client = MagicMock()
    mock_client.get.return_value = mock_get_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_GROUP_ID = ""
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = ""
        result = sync_label_to_gitlab("status::open", "#new-color")
    assert result is True
    mock_client.put.assert_called_once()


def test_sync_label_exception_returns_false():
    from app.gitlab_client import sync_label_to_gitlab
    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("network error")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="https://gitlab.example.com/api/v4/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_GROUP_ID = ""
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = ""
        result = sync_label_to_gitlab("status::open", "#5cb85c")
    assert result is False


# ── sync_label_to_gitlab group level ─────────────────────────────────────────

def test_sync_label_group_level_create():
    """Group level: label doesn't exist (404) → create."""
    from app.gitlab_client import sync_label_to_gitlab

    mock_client = MagicMock()
    # project get: 404 (create), group get: 404 (create)
    not_found = MagicMock()
    not_found.status_code = 404
    not_found.is_success = False
    mock_client.get.return_value = not_found
    mock_client.post.return_value = MagicMock(is_success=True)
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = sync_label_to_gitlab("status::open", "#0f0")

    assert result is True
    assert mock_client.post.call_count >= 2  # project create + group create


def test_sync_label_group_level_update():
    """Group level: label exists → update."""
    from app.gitlab_client import sync_label_to_gitlab

    mock_client = MagicMock()
    # project: 404 (create), group: 200 (update)
    not_found = MagicMock(status_code=404, is_success=False)
    found = MagicMock(status_code=200, is_success=True)
    mock_client.get.side_effect = [not_found, found]
    mock_client.post.return_value = MagicMock(is_success=True)
    mock_client.put.return_value = MagicMock(is_success=True)
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = sync_label_to_gitlab("status::open", "#0f0")

    assert result is True
    mock_client.put.assert_called()  # group put called


def test_sync_label_group_exception_still_returns_true():
    """Group level exception is logged but overall success=True (project level succeeded)."""
    from app.gitlab_client import sync_label_to_gitlab

    mock_client = MagicMock()
    not_found = MagicMock(status_code=404, is_success=False)
    mock_client.get.side_effect = [not_found, Exception("group error")]
    mock_client.post.return_value = MagicMock(is_success=True)
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = sync_label_to_gitlab("status::open", "#0f0")

    # success=True because project level succeeded (group exception is swallowed)
    assert result is True


# ── get_label_sync_status ─────────────────────────────────────────────────────

def test_get_label_sync_status_no_group():
    """Returns labels dict without group labels when group not configured."""
    from app.gitlab_client import get_label_sync_status

    mock_resp = MagicMock(is_success=True)
    mock_resp.json.return_value = [{"name": "status::open"}, {"name": "prio::low"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
        patch("app.gitlab_client.get_category_labels_with_meta", return_value=[]),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = None
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = None
        result = get_label_sync_status()

    assert "labels" in result
    assert result["project_label_count"] == 2
    assert result["group_label_count"] == 0


def test_get_label_sync_status_with_group():
    """Group labels included when group configured."""
    from app.gitlab_client import get_label_sync_status

    project_resp = MagicMock(is_success=True)
    project_resp.json.return_value = [{"name": "status::open"}]
    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = [{"name": "status::open"}, {"name": "prio::low"}]
    mock_client = MagicMock()
    mock_client.get.side_effect = [project_resp, group_resp]
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
        patch("app.gitlab_client.get_category_labels_with_meta", return_value=[]),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = get_label_sync_status()

    assert result["group_label_count"] == 2
    # status::open is in both project and group → synced
    open_label = next(l for l in result["labels"] if l["name"] == "status::open")
    assert open_label["in_project"] is True
    assert open_label["in_group"] is True


def test_get_label_sync_status_with_category_meta():
    """Category labels from get_category_labels_with_meta appear in result."""
    from app.gitlab_client import get_label_sync_status

    mock_resp = MagicMock(is_success=True)
    mock_resp.json.return_value = []
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    cat_meta = [{
        "name": "cat::network",
        "color": "#ff0000",
        "service_label": "네트워크",
        "service_emoji": "🌐",
        "service_value": "network",
        "enabled": True,
    }]

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
        patch("app.gitlab_client.get_category_labels_with_meta", return_value=cat_meta),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = None
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = None
        result = get_label_sync_status()

    names = [l["name"] for l in result["labels"]]
    assert "cat::network" in names


# ── _fetch_existing_labels ─────────────────────────────────────────────────────

def test_fetch_existing_labels_success():
    """Returns set of label names from project API."""
    from app.gitlab_client import _fetch_existing_labels

    mock_resp = MagicMock(is_success=True)
    mock_resp.json.return_value = [{"name": "status::open"}, {"name": "prio::low"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = None
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = None
        result = _fetch_existing_labels()

    assert "status::open" in result
    assert "prio::low" in result


def test_fetch_existing_labels_group_fallback():
    """When project returns no names and group config set, falls back to group labels."""
    from app.gitlab_client import _fetch_existing_labels

    # First call (project) returns not-success so names stays empty
    # Second call (group) returns labels
    proj_resp = MagicMock(is_success=False)
    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = [{"name": "group::label"}]

    call_count = [0]

    def make_ctx(*args, **kwargs):
        m = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            client = MagicMock()
            client.get.return_value = proj_resp
        else:
            client = MagicMock()
            client.get.return_value = group_resp
        m.__enter__ = MagicMock(return_value=client)
        m.__exit__ = MagicMock(return_value=False)
        return m

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", side_effect=make_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = _fetch_existing_labels()

    assert "group::label" in result


# ── ensure_project_labels ─────────────────────────────────────────────────────

def test_ensure_project_labels_creates_missing():
    """Creates labels that don't exist in the target project."""
    from app.gitlab_client import ensure_project_labels

    existing_resp = MagicMock(is_success=True)
    existing_resp.json.return_value = [{"name": "status::open"}]  # only one exists
    post_resp = MagicMock(is_success=True)
    mock_client = MagicMock()
    mock_client.get.return_value = existing_resp
    mock_client.post.return_value = post_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        ensure_project_labels("2", ["status::open", "prio::low"], "user-token")

    # prio::low should be created
    assert mock_client.post.call_count == 1


def test_ensure_project_labels_empty_list():
    """Empty label list → no-op."""
    from app.gitlab_client import ensure_project_labels

    mock_client = MagicMock()
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        ensure_project_labels("2", [], "user-token")

    mock_client.get.assert_not_called()


def test_ensure_project_labels_get_exception_ignored():
    """get() exception is swallowed; post still attempted for all labels."""
    from app.gitlab_client import ensure_project_labels

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("network error")
    mock_client.post.return_value = MagicMock(is_success=True)
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        # Should not raise
        ensure_project_labels("2", ["status::open"], "user-token")


# ── register_project_webhook ──────────────────────────────────────────────────

def test_register_project_webhook_success():
    """Successful webhook registration returns hook dict."""
    from app.gitlab_client import register_project_webhook

    hook_resp = MagicMock()
    hook_resp.raise_for_status.return_value = None
    hook_resp.json.return_value = {"id": 10, "url": "http://itsm/wh"}
    mock_client = MagicMock()
    mock_client.post.return_value = hook_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.security.is_safe_external_url", return_value=(True, "")),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.ITSM_WEBHOOK_URL = "http://itsm/other"
        mock_cfg.return_value.ENVIRONMENT = "production"
        result = register_project_webhook("2", "http://itsm/wh", secret="s")

    assert result["id"] == 10


def test_register_project_webhook_itsm_url_skips_ssrf():
    """ITSM own webhook URL bypasses SSRF check."""
    from app.gitlab_client import register_project_webhook

    hook_resp = MagicMock()
    hook_resp.raise_for_status.return_value = None
    hook_resp.json.return_value = {"id": 11}
    mock_client = MagicMock()
    mock_client.post.return_value = hook_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._get_headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.security.is_safe_external_url") as mock_ssrf,
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.ITSM_WEBHOOK_URL = "http://itsm/webhook"
        mock_cfg.return_value.ENVIRONMENT = "production"
        register_project_webhook("2", "http://itsm/webhook")

    mock_ssrf.assert_not_called()


def test_register_project_webhook_ssrf_blocked():
    """SSRF check failure raises ValueError."""
    from app.gitlab_client import register_project_webhook

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.security.is_safe_external_url", return_value=(False, "private IP")),
    ):
        mock_cfg.return_value.ITSM_WEBHOOK_URL = "http://itsm/other"
        mock_cfg.return_value.ENVIRONMENT = "production"
        try:
            register_project_webhook("2", "http://192.168.0.1/hook")
            assert False, "Expected ValueError"
        except ValueError as e:
            assert "SSRF" in str(e)


# ── get_issue_linked_mrs ──────────────────────────────────────────────────────

def test_get_issue_linked_mrs_success():
    """Returns list of related MRs."""
    from app.gitlab_client import get_issue_linked_mrs

    mr_resp = MagicMock(is_success=True)
    mr_resp.json.return_value = [{"iid": 5, "title": "Fix bug"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mr_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = get_issue_linked_mrs(42)

    assert len(result) == 1
    assert result[0]["iid"] == 5


def test_get_issue_linked_mrs_exception_returns_empty():
    """Exception returns []."""
    from app.gitlab_client import get_issue_linked_mrs

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("connection refused")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = get_issue_linked_mrs(42)

    assert result == []


# ── search_issues additional paths ───────────────────────────────────────────

def test_search_issues_non_success_status():
    """Non-success status → warning logged, return []."""
    from app.gitlab_client import search_issues

    mock_resp = MagicMock(is_success=False, status_code=503)
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        result = search_issues("bug")

    assert result == []


def test_search_issues_exception_returns_empty():
    """Exception → warning, return []."""
    from app.gitlab_client import search_issues

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("timeout")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        result = search_issues("crash")

    assert result == []


def test_search_issues_with_state_param():
    """State parameter passed to API."""
    from app.gitlab_client import search_issues

    mock_resp = MagicMock(is_success=True)
    mock_resp.json.return_value = []
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        search_issues("bug", state="opened")

    _, call_kwargs = mock_client.get.call_args
    assert call_kwargs["params"]["state"] == "opened"


# ── get_milestones ────────────────────────────────────────────────────────────

def test_get_milestones_success():
    """Returns list of milestones."""
    from app.gitlab_client import get_milestones

    mock_resp = MagicMock(is_success=True)
    mock_resp.json.return_value = [{"id": 1, "title": "v1.0"}]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = get_milestones()

    assert len(result) == 1
    assert result[0]["title"] == "v1.0"


def test_get_milestones_non_success():
    """Non-success status → warning, return []."""
    from app.gitlab_client import get_milestones

    mock_resp = MagicMock(is_success=False, status_code=403)
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = get_milestones()

    assert result == []


def test_get_milestones_exception():
    """Exception → warning, return []."""
    from app.gitlab_client import get_milestones

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("network error")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = get_milestones()

    assert result == []


# ── cleanup_duplicate_project_labels ─────────────────────────────────────────

def test_cleanup_duplicate_no_group_configured():
    """No group config → skipped."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    with patch("app.gitlab_client.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_GROUP_ID = None
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = None
        result = cleanup_duplicate_project_labels()

    assert result.get("skipped") is True


def test_cleanup_duplicate_success():
    """Duplicate labels found and deleted."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = [{"name": "status::open"}]
    proj_resp = MagicMock()
    proj_resp.raise_for_status.return_value = None
    proj_resp.json.return_value = [{"name": "status::open", "id": 20}]
    del_resp = MagicMock()
    del_resp.raise_for_status.return_value = None

    mock_client = MagicMock()
    mock_client.get.side_effect = [group_resp, proj_resp]
    mock_client.delete.return_value = del_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = cleanup_duplicate_project_labels()

    assert "status::open" in result["deleted"]


def test_cleanup_duplicate_no_group_labels():
    """No group labels found → skip."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = []  # no group labels
    mock_client = MagicMock()
    mock_client.get.return_value = group_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = cleanup_duplicate_project_labels()

    assert result.get("skipped") is True


def test_cleanup_duplicate_group_fetch_exception():
    """Group labels fetch exception → skip."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("network fail")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = cleanup_duplicate_project_labels()

    assert result.get("skipped") is True


def test_cleanup_duplicate_project_fetch_raises():
    """Project labels fetch raises → skip."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = [{"name": "status::open"}]

    call_count = [0]

    def _get(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return group_resp
        raise Exception("project fetch fail")

    mock_client = MagicMock()
    mock_client.get.side_effect = _get
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = cleanup_duplicate_project_labels()

    assert result.get("skipped") is True


def test_cleanup_duplicate_delete_error_recorded():
    """Delete failure recorded in errors list."""
    from app.gitlab_client import cleanup_duplicate_project_labels

    group_resp = MagicMock(is_success=True)
    group_resp.json.return_value = [{"name": "status::open"}]
    proj_resp = MagicMock()
    proj_resp.raise_for_status.return_value = None
    proj_resp.json.return_value = [{"name": "status::open", "id": 20}]
    del_resp = MagicMock()
    del_resp.raise_for_status.side_effect = Exception("delete failed")

    mock_client = MagicMock()
    mock_client.get.side_effect = [group_resp, proj_resp]
    mock_client.delete.return_value = del_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        result = cleanup_duplicate_project_labels()

    assert len(result["errors"]) == 1
    assert result["errors"][0]["name"] == "status::open"


# ── ensure_labels ─────────────────────────────────────────────────────────────

def test_ensure_labels_group_creates_labels():
    """Group + project labels created when not yet initialized."""
    import app.gitlab_client as _gl

    _gl._GROUP_LABELS_INITIALIZED = False
    _gl._labels_initialized.discard("999")

    existing_resp = MagicMock(is_success=True)
    existing_resp.json.return_value = []  # no existing labels
    post_resp = MagicMock(is_success=True)

    mock_client = MagicMock()
    mock_client.get.return_value = existing_resp
    mock_client.post.return_value = post_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/999"),
        patch("app.gitlab_client.get_category_labels_from_db", return_value=[]),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "999"
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        mock_cfg.return_value.GITLAB_GROUP_ID = "42"
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = "group-token"
        _gl.ensure_labels("999")

    assert _gl._GROUP_LABELS_INITIALIZED is True
    assert "999" in _gl._labels_initialized


def test_ensure_labels_already_done_skips():
    """Project already initialized → no-op."""
    import app.gitlab_client as _gl

    _gl._labels_initialized.add("1")
    _gl._GROUP_LABELS_INITIALIZED = True

    mock_client = MagicMock()
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client.get_settings") as mock_cfg,
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = "1"
        mock_cfg.return_value.GITLAB_GROUP_ID = None
        mock_cfg.return_value.GITLAB_GROUP_TOKEN = None
        _gl.ensure_labels("1")

    # No get calls made since already initialized
    mock_client.get.assert_not_called()


# ── trigger_pipeline ──────────────────────────────────────────────────────────

def test_trigger_pipeline_no_variables():
    """Pipeline triggered without variables."""
    from app.gitlab_client import trigger_pipeline

    pipe_resp = MagicMock()
    pipe_resp.raise_for_status.return_value = None
    pipe_resp.json.return_value = {"id": 123, "status": "created"}
    mock_client = MagicMock()
    mock_client.post.return_value = pipe_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = trigger_pipeline("main")

    assert result["id"] == 123
    _, kw = mock_client.post.call_args
    assert kw["json"]["ref"] == "main"
    assert "variables" not in kw["json"]


def test_trigger_pipeline_with_variables():
    """Pipeline triggered with variables dict."""
    from app.gitlab_client import trigger_pipeline

    pipe_resp = MagicMock()
    pipe_resp.raise_for_status.return_value = None
    pipe_resp.json.return_value = {"id": 124}
    mock_client = MagicMock()
    mock_client.post.return_value = pipe_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = trigger_pipeline("main", variables={"ENV": "prod"})

    assert result["id"] == 124
    _, kw = mock_client.post.call_args
    variables = kw["json"]["variables"]
    assert any(v["key"] == "ENV" for v in variables)


# ── list_pipelines ────────────────────────────────────────────────────────────

def test_list_pipelines_no_ref():
    """List pipelines returns results without ref filter."""
    from app.gitlab_client import list_pipelines

    list_resp = MagicMock()
    list_resp.raise_for_status.return_value = None
    list_resp.json.return_value = [{"id": 1}, {"id": 2}]
    mock_client = MagicMock()
    mock_client.get.return_value = list_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = list_pipelines()

    assert len(result) == 2
    _, kw = mock_client.get.call_args
    assert "ref" not in kw["params"]


def test_list_pipelines_with_ref():
    """List pipelines includes ref in params."""
    from app.gitlab_client import list_pipelines

    list_resp = MagicMock()
    list_resp.raise_for_status.return_value = None
    list_resp.json.return_value = [{"id": 5}]
    mock_client = MagicMock()
    mock_client.get.return_value = list_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._base", return_value="http://fake/projects/1"),
    ):
        result = list_pipelines(ref="main", per_page=5)

    assert len(result) == 1
    _, kw = mock_client.get.call_args
    assert kw["params"]["ref"] == "main"
    assert kw["params"]["per_page"] == 5


# ── get_users_by_usernames additional paths ────────────────────────────────────

def test_get_users_by_usernames_redis_cache_hit():
    """All values cached → no API call."""
    from app.gitlab_client import get_users_by_usernames

    mock_redis = MagicMock()
    mock_redis.mget.return_value = [b"Alice", b"Bob"]

    mock_client = MagicMock()
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._redis_client", return_value=mock_redis),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        result = get_users_by_usernames(["alice", "bob"])

    # Redis returns bytes; they're stored as-is
    assert result["alice"] == b"Alice"
    assert result["bob"] == b"Bob"
    mock_client.get.assert_not_called()


def test_get_users_by_usernames_redis_exception_falls_through():
    """Redis mget raises → fall through to API."""
    from app.gitlab_client import get_users_by_usernames

    mock_redis = MagicMock()
    mock_redis.mget.side_effect = Exception("redis down")

    api_resp = MagicMock(is_success=True)
    api_resp.json.return_value = [{"name": "Alice"}]
    mock_client = MagicMock()
    mock_client.get.return_value = api_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._redis_client", return_value=mock_redis),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        result = get_users_by_usernames(["alice"])

    assert result.get("alice") == "Alice"


def test_get_users_by_usernames_api_fetch_exception():
    """Individual API fetch exception → username skipped."""
    from app.gitlab_client import get_users_by_usernames

    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None]

    mock_client = MagicMock()
    mock_client.get.side_effect = Exception("connection refused")
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._redis_client", return_value=mock_redis),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        result = get_users_by_usernames(["failuser"])

    assert "failuser" not in result


def test_get_users_by_usernames_stores_in_redis():
    """Fetched names stored in Redis pipeline."""
    from app.gitlab_client import get_users_by_usernames

    mock_redis = MagicMock()
    mock_redis.mget.return_value = [None]
    mock_pipe = MagicMock()
    mock_redis.pipeline.return_value = mock_pipe

    api_resp = MagicMock(is_success=True)
    api_resp.json.return_value = [{"name": "Alice"}]
    mock_client = MagicMock()
    mock_client.get.return_value = api_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__.return_value = mock_client
    mock_ctx.__exit__.return_value = False

    with (
        patch("app.gitlab_client._redis_client", return_value=mock_redis),
        patch("app.gitlab_client._http_ctx", return_value=mock_ctx),
        patch("app.gitlab_client._headers", return_value={"PRIVATE-TOKEN": "tok"}),
        patch("app.gitlab_client.get_settings") as mock_cfg,
    ):
        mock_cfg.return_value.GITLAB_API_URL = "http://fake-gitlab"
        result = get_users_by_usernames(["alice"])

    assert result["alice"] == "Alice"
    mock_pipe.setex.assert_called_once()
    mock_pipe.execute.assert_called_once()
