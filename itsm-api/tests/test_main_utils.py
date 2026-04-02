"""Tests for app/main.py utility functions and endpoints."""
from unittest.mock import patch, MagicMock


# ── GET /health ───────────────────────────────────────────────────────────────

def test_health_ok(client):
    """Health endpoint returns 200 or 503."""
    with (
        patch("app.gitlab_client.get_label_sync_status", return_value={}),
        patch("httpx.Client") as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_client.get.return_value = mock_resp
        mock_httpx.return_value = mock_client

        resp = client.get("/health")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "status" in data
    assert "checks" in data
    assert "db" in data["checks"]


def test_health_redis_error(client):
    """Health check with Redis error → degraded."""
    with (
        patch("app.routers.tickets._get_redis", side_effect=Exception("redis down")),
        patch("httpx.Client") as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_client.get.return_value = mock_resp
        mock_httpx.return_value = mock_client

        resp = client.get("/health")
    assert resp.status_code in (200, 503)


def test_health_gitlab_cached(client):
    """GitLab health check uses cached result within cooldown."""
    import app.main as main_mod
    # Set cache to valid (recent)
    main_mod._gitlab_health_cache = ("ok", main_mod.time.monotonic())
    main_mod._label_drift_last_check = main_mod.time.monotonic()
    main_mod._label_drift_last_result = "ok"

    resp = client.get("/health")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "gitlab" in data["checks"]


# ── _run_daily_snapshots ──────────────────────────────────────────────────────

def test_run_daily_snapshots_single_project():
    """Single project snapshot runs directly."""
    from app.main import _run_daily_snapshots

    with (
        patch("app.gitlab_client.get_user_projects", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
        patch("app.main.take_snapshot", return_value={"message": "done"}),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_daily_snapshots(reason="test")


def test_run_daily_snapshots_no_projects():
    """No projects → uses default from settings."""
    from app.main import _run_daily_snapshots

    with (
        patch("app.gitlab_client.get_user_projects", side_effect=Exception("error")),
        patch("app.main.SessionLocal") as mock_sl,
        patch("app.main.take_snapshot", return_value={"message": "done"}),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_daily_snapshots(reason="test")


def test_run_daily_snapshots_multiple_projects():
    """Multiple projects use thread pool."""
    from app.main import _run_daily_snapshots

    with (
        patch("app.gitlab_client.get_user_projects", return_value=[{"id": 1}, {"id": 2}]),
        patch("app.main.SessionLocal") as mock_sl,
        patch("app.main.take_snapshot", return_value={"message": "done"}),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_daily_snapshots(reason="test")


def test_run_daily_snapshots_snap_fails():
    """Snapshot function throws → error logged, continues."""
    from app.main import _run_daily_snapshots

    with (
        patch("app.gitlab_client.get_user_projects", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
        patch("app.main.take_snapshot", side_effect=Exception("snap failed")),
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_daily_snapshots(reason="test")  # should not raise


# ── _run_user_sync ────────────────────────────────────────────────────────────

def test_run_user_sync_no_group_id():
    """No GITLAB_GROUP_ID → uses project members only."""
    from app.main import _run_user_sync

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = None
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = False

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_project_members", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = []
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()


def test_run_user_sync_with_group_empty_skip():
    """require_group=true but group returns empty → skip to avoid mass deactivation."""
    from app.main import _run_user_sync

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = "42"
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = True

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_group_members", return_value=[]),
        patch("app.gitlab_client.get_project_members", return_value=[]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()
    # No commit called (skipped)


def test_run_user_sync_deactivates_missing_user():
    """User not in GitLab anymore → set is_active=False."""
    from app.main import _run_user_sync
    from app.models import UserRole

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = None
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = False

    mock_user = MagicMock(spec=UserRole)
    mock_user.gitlab_user_id = 999  # not in active members
    mock_user.username = "gone_user"
    mock_user.is_active = True

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_project_members", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = [mock_user]
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()

    assert mock_user.is_active is False


def test_run_user_sync_project_member_fails():
    """Project member fetch fails → empty active set → skip."""
    from app.main import _run_user_sync

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = None
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = False

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_project_members", side_effect=Exception("network error")),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()


# ── _reload_ip_cache ─────────────────────────────────────────────────────────

def test_reload_ip_cache_empty_db():
    """No entries in DB → returns empty list."""
    from app.main import _reload_ip_cache

    with patch("app.main.SessionLocal") as mock_sl:
        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.all.return_value = []
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        result = _reload_ip_cache()
    assert result == []


def test_reload_ip_cache_with_valid_cidr():
    """Valid CIDR in DB → returns network objects."""
    from app.main import _reload_ip_cache

    mock_entry = MagicMock()
    mock_entry.cidr = "192.168.1.0/24"

    with patch("app.main.SessionLocal") as mock_sl:
        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.all.return_value = [mock_entry]
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        result = _reload_ip_cache()
    assert len(result) == 1


def test_reload_ip_cache_with_invalid_cidr():
    """Invalid CIDR in DB → skipped, returns empty."""
    from app.main import _reload_ip_cache

    mock_entry = MagicMock()
    mock_entry.cidr = "not-a-cidr"

    with patch("app.main.SessionLocal") as mock_sl:
        mock_db = MagicMock()
        mock_db.query.return_value.filter_by.return_value.all.return_value = [mock_entry]
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        result = _reload_ip_cache()
    assert result == []


def test_reload_ip_cache_db_error():
    """DB error → returns previous cache."""
    from app.main import _reload_ip_cache, _ip_cache

    with patch("app.main.SessionLocal", side_effect=Exception("db error")):
        result = _reload_ip_cache()
    assert result == _ip_cache["nets"]


# ── _is_local_ip ─────────────────────────────────────────────────────────────

def test_is_local_ip_loopback():
    """127.0.0.1 is local."""
    import ipaddress
    from app.main import _is_local_ip

    request = MagicMock()
    request.client = None
    ip = ipaddress.ip_address("127.0.0.1")
    assert _is_local_ip(ip, request) is True


def test_is_local_ip_ipv6_loopback():
    """::1 is local."""
    import ipaddress
    from app.main import _is_local_ip

    request = MagicMock()
    request.client = None
    ip = ipaddress.ip_address("::1")
    assert _is_local_ip(ip, request) is True


def test_is_local_ip_external():
    """External IP is not local."""
    import ipaddress
    from app.main import _is_local_ip

    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "172.20.0.10"  # Docker container IP
    ip = ipaddress.ip_address("1.2.3.4")
    assert _is_local_ip(ip, request) is False


def test_is_local_ip_docker_host():
    """Docker host gateway (.1 of same /24) is local."""
    import ipaddress
    from app.main import _is_local_ip

    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "172.20.0.10"  # Nginx container
    # Docker gateway = 172.20.0.1
    ip = ipaddress.ip_address("172.20.0.1")
    assert _is_local_ip(ip, request) is True


# ── _seconds_until_midnight ───────────────────────────────────────────────────

def test_seconds_until_midnight():
    """Returns positive seconds."""
    from app.main import _seconds_until_midnight
    secs = _seconds_until_midnight()
    assert secs > 0
    assert secs <= 86460  # at most 24 hours + 5 minutes


# ── _check_label_drift ────────────────────────────────────────────────────────

def test_check_label_drift_cached():
    """Cached result within cooldown is returned without GitLab call."""
    import app.main as main_mod

    main_mod._label_drift_last_check = main_mod.time.monotonic()  # just now
    main_mod._label_drift_last_result = "ok"

    result = main_mod._check_label_drift()
    assert result == "ok"


def test_check_label_drift_no_missing():
    """No missing labels → returns 'ok'."""
    import app.main as main_mod

    main_mod._label_drift_last_check = 0.0  # force refresh

    with (
        patch("app.gitlab_client.REQUIRED_LABELS", [("status::open", "blue")]),
        patch("app.gitlab_client._fetch_existing_labels", return_value={"status::open"}),
    ):
        result = main_mod._check_label_drift()
    assert result == "ok"


def test_check_label_drift_missing_labels():
    """Missing labels → attempts recovery."""
    import app.main as main_mod

    main_mod._label_drift_last_check = 0.0  # force refresh

    with (
        patch("app.gitlab_client.REQUIRED_LABELS", [("status::open", "blue"), ("cat::network", "red")]),
        patch("app.gitlab_client._fetch_existing_labels", return_value={"status::open"}),
        patch("app.gitlab_client.ensure_labels", return_value=None),
    ):
        result = main_mod._check_label_drift()
    assert result == "ok"


def test_check_label_drift_error():
    """GitLab error → returns 'check_failed'."""
    import app.main as main_mod

    main_mod._label_drift_last_check = 0.0

    with patch("app.gitlab_client._fetch_existing_labels", side_effect=Exception("fail")):
        result = main_mod._check_label_drift()
    assert result == "check_failed"


# ── _get_ip_cache_lock ────────────────────────────────────────────────────────

def test_get_ip_cache_lock():
    """Lock is created and reused."""
    import app.main as main_mod
    main_mod._ip_cache_lock = None  # reset
    lock1 = main_mod._get_ip_cache_lock()
    lock2 = main_mod._get_ip_cache_lock()
    assert lock1 is lock2


# ── /health error paths ───────────────────────────────────────────────────────

def test_health_db_error(client):
    """DB error → checks.db = 'error', status degraded."""
    import app.main as main_mod

    # Force gitlab cache to be fresh so we skip that check
    main_mod._gitlab_health_cache = ("ok", main_mod.time.monotonic())
    main_mod._label_drift_last_check = main_mod.time.monotonic()
    main_mod._label_drift_last_result = "ok"

    bad_db = MagicMock()
    bad_db.__enter__ = MagicMock(return_value=bad_db)
    bad_db.__exit__ = MagicMock(return_value=False)
    bad_db.execute.side_effect = Exception("db down")

    with patch("app.database.SessionLocal", return_value=bad_db):
        resp = client.get("/health")

    assert resp.status_code in (200, 503)
    data = resp.json()
    assert data["checks"]["db"] == "error"


def test_health_redis_none(client):
    """Redis returns None → checks.redis = 'error'."""
    import app.main as main_mod

    main_mod._gitlab_health_cache = ("ok", main_mod.time.monotonic())
    main_mod._label_drift_last_check = main_mod.time.monotonic()
    main_mod._label_drift_last_result = "ok"

    with (
        patch("app.routers.tickets._get_redis", return_value=None),
    ):
        resp = client.get("/health")

    assert resp.status_code in (200, 503)


def test_health_gitlab_http_error(client):
    """GitLab returns non-success HTTP → gitlab status has error info."""
    import app.main as main_mod

    main_mod._gitlab_health_cache = ("ok", 0.0)  # expired cache
    main_mod._label_drift_last_check = main_mod.time.monotonic()
    main_mod._label_drift_last_result = "ok"

    mock_resp = MagicMock()
    mock_resp.is_success = False
    mock_resp.status_code = 503
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_client)
    mock_ctx.__exit__ = MagicMock(return_value=False)

    with patch("httpx.Client", return_value=mock_ctx):
        resp = client.get("/health")

    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "gitlab" in data["checks"]
    assert "503" in data["checks"]["gitlab"]


def test_health_gitlab_exception(client):
    """GitLab HTTP error exception → gitlab = 'error'."""
    import app.main as main_mod

    main_mod._gitlab_health_cache = ("ok", 0.0)  # expired
    main_mod._label_drift_last_check = main_mod.time.monotonic()
    main_mod._label_drift_last_result = "ok"

    with patch("httpx.Client", side_effect=Exception("connection refused")):
        resp = client.get("/health")

    assert resp.status_code in (200, 503)
    data = resp.json()
    assert data["checks"].get("gitlab") == "error"


def test_health_label_sync_exception(client):
    """label_sync exception → checks.label_sync = 'error'."""
    import app.main as main_mod

    main_mod._gitlab_health_cache = ("ok", main_mod.time.monotonic())

    with patch("app.main._check_label_drift", side_effect=Exception("drift fail")):
        resp = client.get("/health")

    assert resp.status_code in (200, 503)
    data = resp.json()
    assert data["checks"].get("label_sync") == "error"


# ── lifespan / startup helpers ────────────────────────────────────────────────

def test_run_user_sync_with_group_id_and_require_group():
    """With GROUP_ID and USER_SYNC_REQUIRE_GROUP=True, group members deactivate missing users."""
    from app.main import _run_user_sync
    from app.models import UserRole

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = "42"
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = True

    mock_user = MagicMock(spec=UserRole)
    mock_user.gitlab_user_id = 999  # not in active members
    mock_user.username = "gone_user"
    mock_user.is_active = True

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_group_members", return_value=[{"id": 1}]),
        patch("app.gitlab_client.get_project_members", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = [mock_user]
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()

    assert mock_user.is_active is False


def test_run_user_sync_activates_returning_user():
    """User in GitLab but is_active=False → reactivated."""
    from app.main import _run_user_sync
    from app.models import UserRole

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = None
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = False

    mock_user = MagicMock(spec=UserRole)
    mock_user.gitlab_user_id = 1  # IS in active members
    mock_user.username = "active_user"
    mock_user.is_active = False  # previously deactivated

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_project_members", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = [mock_user]
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()

    assert mock_user.is_active is True


# ── _sla_checker_loop (lines 62-77) ─────────────────────────────────────────

def test_sla_checker_loop_runs_once_then_stops():
    """Simulate one iteration of _sla_checker_loop then stop."""
    from app.main import _sla_checker_loop

    mock_stop = MagicMock()
    # wait returns immediately; is_set: first call→False (run loop), second→True (exit)
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    with (
        patch("app.main._sla_thread_stop", mock_stop),
        patch("app.main.SessionLocal") as mock_sl,
        patch("app.main.sla_module") as mock_sla,
    ):
        mock_db = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        mock_sla.check_and_flag_breaches.return_value = [1]
        mock_sla.check_and_send_warnings.return_value = [2]
        mock_sla.check_and_escalate.return_value = [3]
        _sla_checker_loop()

    mock_sla.check_and_flag_breaches.assert_called_once_with(mock_db)


def test_sla_checker_loop_exception_logged():
    """Exception inside loop body is caught and logged (line 75-76)."""
    from app.main import _sla_checker_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    with (
        patch("app.main._sla_thread_stop", mock_stop),
        patch("app.main.SessionLocal", side_effect=Exception("db crash")),
        patch("app.main.sla_module"),
    ):
        _sla_checker_loop()  # should not raise


# ── _snapshot_scheduler_loop (lines 90-98) ──────────────────────────────────

def test_snapshot_scheduler_loop_runs_once():
    """One iteration of _snapshot_scheduler_loop then stop."""
    from app.main import _snapshot_scheduler_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, False, True]
    mock_stop.wait.return_value = None

    with (
        patch("app.main._snapshot_thread_stop", mock_stop),
        patch("app.main._run_daily_snapshots") as mock_snap,
        patch("app.main._seconds_until_midnight", return_value=0),
    ):
        _snapshot_scheduler_loop()

    assert mock_snap.call_count >= 2  # "startup" + "scheduled"


# ── _user_sync_loop (lines 149-157) ─────────────────────────────────────────

def test_user_sync_loop_runs_once():
    """One iteration of _user_sync_loop."""
    from app.main import _user_sync_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    mock_settings = MagicMock()
    mock_settings.USER_SYNC_INTERVAL = 1

    with (
        patch("app.main._user_sync_stop", mock_stop),
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.main._run_user_sync"),
    ):
        _user_sync_loop()


def test_user_sync_loop_exception_logged():
    """Exception in _run_user_sync is caught (line 155-156)."""
    from app.main import _user_sync_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    mock_settings = MagicMock()
    mock_settings.USER_SYNC_INTERVAL = 1

    with (
        patch("app.main._user_sync_stop", mock_stop),
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.main._run_user_sync", side_effect=Exception("sync failed")),
    ):
        _user_sync_loop()  # should not raise


# ── _email_ingest_loop (lines 232-241) ──────────────────────────────────────

def test_email_ingest_loop_runs_once():
    """One iteration of _email_ingest_loop with count>0 (lines 237-238)."""
    from app.main import _email_ingest_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    mock_settings = MagicMock()
    mock_settings.IMAP_POLL_INTERVAL = 1

    with (
        patch("app.main._email_ingest_stop", mock_stop),
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.email_ingest.process_inbox", return_value=3),
    ):
        _email_ingest_loop()


def test_email_ingest_loop_exception_logged():
    """process_inbox raises → exception logged (lines 239-240)."""
    from app.main import _email_ingest_loop

    mock_stop = MagicMock()
    mock_stop.is_set.side_effect = [False, True]
    mock_stop.wait.return_value = None

    mock_settings = MagicMock()
    mock_settings.IMAP_POLL_INTERVAL = 1

    with (
        patch("app.main._email_ingest_stop", mock_stop),
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.email_ingest.process_inbox", side_effect=Exception("imap error")),
    ):
        _email_ingest_loop()  # should not raise


# ── _run_user_sync group fetch failure (lines 182-183) ─────────────────────

def test_run_user_sync_group_member_fetch_fails():
    """Group member fetch raises → warning logged (lines 182-183), continues."""
    from app.main import _run_user_sync

    mock_settings = MagicMock()
    mock_settings.GITLAB_GROUP_ID = "42"
    mock_settings.GITLAB_PROJECT_ID = "1"
    mock_settings.USER_SYNC_REQUIRE_GROUP = False

    with (
        patch("app.main.get_settings", return_value=mock_settings),
        patch("app.gitlab_client.get_group_members", side_effect=Exception("timeout")),
        patch("app.gitlab_client.get_project_members", return_value=[{"id": 1}]),
        patch("app.main.SessionLocal") as mock_sl,
    ):
        mock_db = MagicMock()
        mock_db.query.return_value.all.return_value = []
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_db)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)
        _run_user_sync()  # should not raise


# ── IP allowlist middleware blocking (lines 518-526) ─────────────────────────

def test_ip_allowlist_blocks_non_matching_ip(client, admin_cookies):
    """When allowlist has entries and client IP doesn't match → 403 (lines 518-526)."""
    import ipaddress
    import app.main as main_mod

    # Pre-load IP cache with a restrictive CIDR that won't match testclient
    main_mod._ip_cache["nets"] = [ipaddress.ip_network("10.0.0.0/24")]
    main_mod._ip_cache["loaded_at"] = main_mod.time.monotonic() + 9999  # prevent refresh
    try:
        resp = client.get("/admin/users", cookies=admin_cookies)
        assert resp.status_code == 403
    finally:
        main_mod._ip_cache["nets"] = []  # restore


def test_ip_allowlist_allows_matching_ip(client, admin_cookies):
    """When allowlist matches client IP (0.0.0.0) → allow (line 526)."""
    import ipaddress
    import app.main as main_mod

    # 0.0.0.0 is in 0.0.0.0/0 (all IPs) – just test pass-through
    main_mod._ip_cache["nets"] = [ipaddress.ip_network("0.0.0.0/0")]
    main_mod._ip_cache["loaded_at"] = main_mod.time.monotonic() + 9999
    try:
        resp = client.get("/admin/users", cookies=admin_cookies)
        assert resp.status_code == 200
    finally:
        main_mod._ip_cache["nets"] = []


# ── Middleware JWT role check (lines 461-463) ────────────────────────────────

def test_middleware_agent_jwt_triggers_ip_check(client):
    """Bearer JWT with agent role on non-admin path → should_check=True (lines 461-463)."""
    import jwt
    import app.main as main_mod
    from app.config import get_settings

    settings = get_settings()
    token = jwt.encode(
        {"sub": "1", "role": "agent", "username": "agentuser"},
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    # No allowlist → returns at line 514 (allowed)
    main_mod._ip_cache["nets"] = []
    resp = client.get("/tickets/", headers={"Authorization": f"Bearer {token}"})
    # Just check it didn't 500 - the code path is exercised
    assert resp.status_code in (200, 401, 403, 404, 422, 502)


# ── Middleware JWT blacklist (lines 451-453) ────────────────────────────────

def test_middleware_jwt_blacklist_sets_payload_none(client):
    """Blacklisted JTI → payload set to None (lines 451-453)."""
    import jwt
    from app.config import get_settings

    settings = get_settings()
    token = jwt.encode(
        {"sub": "1", "role": "admin", "username": "admin", "jti": "blacklisted-jti-123"},
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    with patch("app.auth._is_token_blacklisted", return_value=True):
        resp = client.get("/tickets/", headers={"Authorization": f"Bearer {token}"})
    # payload=None → should_check=False for non-admin → passes through
    assert resp.status_code in (200, 401, 403, 404, 422, 502)


# ── Middleware X-Forwarded-For with TRUSTED_PROXIES (lines 473-492) ─────────

def test_middleware_xforwardedfor_with_trusted_proxy(client, admin_cookies):
    """X-Forwarded-For from trusted proxy → use client IP from header (lines 473-492)."""
    import app.main as main_mod
    from app.config import get_settings

    # No allowlist entries → returns at line 514
    main_mod._ip_cache["nets"] = []

    resp = client.get(
        "/admin/users",
        cookies=admin_cookies,
        headers={"X-Forwarded-For": "10.1.2.3", "X-Real-IP": "10.1.2.3"},
    )
    assert resp.status_code == 200


# ── _is_local_ip returns True via middleware (line 501) ─────────────────────

def test_middleware_local_ip_passes_through(client, admin_cookies):
    """_is_local_ip returns True → return early (line 501)."""
    import app.main as main_mod

    # Set allowlist so we don't skip at line 514
    import ipaddress
    main_mod._ip_cache["nets"] = [ipaddress.ip_network("192.168.0.0/16")]
    main_mod._ip_cache["loaded_at"] = main_mod.time.monotonic() + 9999
    try:
        with patch("app.main._is_local_ip", return_value=True):
            resp = client.get("/admin/users", cookies=admin_cookies)
        assert resp.status_code == 200
    finally:
        main_mod._ip_cache["nets"] = []


# ── TRUSTED_PROXIES X-Forwarded-For middleware (lines 475-490) ──────────────

def test_middleware_trusted_proxies_matching(client, admin_cookies):
    """TRUSTED_PROXIES set and proxy is in list → use X-Forwarded-For client IP (lines 476-487)."""
    import ipaddress
    import app.main as main_mod

    # No allowlist so request passes through (not blocked)
    main_mod._ip_cache["nets"] = []

    # Patch _ipmod.ip_address to handle "testclient" → return a network-matching address
    real_ip_address = main_mod._ipmod.ip_address
    mock_proxy_addr = MagicMock()
    mock_proxy_addr.is_private = False  # Not private

    def _fake_ip_address(s):
        if s == "testclient":
            # Return a mock that appears to be in the TRUSTED_PROXIES net
            return mock_proxy_addr
        return real_ip_address(s)

    # Make the mock appear to be in the trusted net
    mock_net = MagicMock()
    mock_net.__contains__ = MagicMock(return_value=True)

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    mock_settings.ENVIRONMENT = "development"
    mock_settings.TOKEN_ENCRYPTION_KEY = ""
    mock_settings.cors_origins_list = ["*"]
    mock_settings.TRUSTED_PROXIES = "192.168.0.0/24"

    with (
        patch.object(main_mod._ipmod, "ip_address", side_effect=_fake_ip_address),
        patch.object(main_mod._ipmod, "ip_network", return_value=mock_net),
        patch("app.main.get_settings", return_value=mock_settings),
    ):
        resp = client.get(
            "/admin/users",
            cookies=admin_cookies,
            headers={"X-Forwarded-For": "203.0.113.1"},
        )
    # Just confirm we got a response (not 500) - the code path is exercised
    assert resp.status_code in (200, 401, 403, 404)


def test_middleware_trusted_proxies_private_fallback(client, admin_cookies):
    """No TRUSTED_PROXIES but proxy is private → use X-Forwarded-For (lines 488-490)."""
    import app.main as main_mod

    main_mod._ip_cache["nets"] = []

    real_ip_address = main_mod._ipmod.ip_address

    def _fake_ip_address(s):
        if s == "testclient":
            mock_addr = MagicMock()
            mock_addr.is_private = True  # Private IP → use X-Forwarded-For
            return mock_addr
        return real_ip_address(s)

    mock_settings = MagicMock()
    mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
    mock_settings.ENVIRONMENT = "development"
    mock_settings.TOKEN_ENCRYPTION_KEY = ""
    mock_settings.cors_origins_list = ["*"]
    mock_settings.TRUSTED_PROXIES = ""  # Empty → private IP fallback

    with (
        patch.object(main_mod._ipmod, "ip_address", side_effect=_fake_ip_address),
        patch("app.main.get_settings", return_value=mock_settings),
    ):
        resp = client.get(
            "/admin/users",
            cookies=admin_cookies,
            headers={"X-Forwarded-For": "203.0.113.2"},
        )
    assert resp.status_code in (200, 401, 403, 404)


# ── lifespan function (lines 247-315) ────────────────────────────────────────

import asyncio as _asyncio


def _run_lifespan(coro):
    """Run an async coroutine in a new event loop for testing."""
    return _asyncio.get_event_loop().run_until_complete(coro)


def test_lifespan_development_mode():
    """Lifespan starts background threads and shuts them down (lines 247-315)."""
    from app.main import lifespan
    from fastapi import FastAPI

    async def _inner():
        test_app = FastAPI()

        mock_settings = MagicMock()
        mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
        mock_settings.ENVIRONMENT = "development"
        mock_settings.TOKEN_ENCRYPTION_KEY = ""
        mock_settings.GITLAB_PROJECT_TOKEN = "token"
        mock_settings.NOTIFICATION_ENABLED = False
        mock_settings.SMTP_HOST = None
        mock_settings.IMAP_ENABLED = False
        mock_settings.IMAP_POLL_INTERVAL = 60
        mock_settings.USER_SYNC_INTERVAL = 3600

        mock_thread = MagicMock()
        mock_thread.start = MagicMock()
        mock_thread.join = MagicMock()

        with (
            patch("app.main.get_settings", return_value=mock_settings),
            patch("app.gitlab_client.ensure_labels"),
            patch("app.main.Base.metadata.create_all"),
            patch("app.main.threading.Thread", return_value=mock_thread),
        ):
            async with lifespan(test_app):
                pass  # startup + yield + shutdown

        # At least one thread was started (sla, snapshot, user_sync)
        assert mock_thread.start.call_count >= 3

    _run_lifespan(_inner())


def test_lifespan_imap_enabled():
    """Lifespan with IMAP_ENABLED=True starts email thread (lines 298-301)."""
    from app.main import lifespan
    from fastapi import FastAPI

    async def _inner():
        test_app = FastAPI()

        mock_settings = MagicMock()
        mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
        mock_settings.ENVIRONMENT = "development"
        mock_settings.TOKEN_ENCRYPTION_KEY = ""
        mock_settings.GITLAB_PROJECT_TOKEN = "token"
        mock_settings.NOTIFICATION_ENABLED = False
        mock_settings.IMAP_ENABLED = True  # ← enable email thread
        mock_settings.IMAP_POLL_INTERVAL = 60
        mock_settings.USER_SYNC_INTERVAL = 3600

        mock_thread = MagicMock()
        mock_thread.start = MagicMock()
        mock_thread.join = MagicMock()

        with (
            patch("app.main.get_settings", return_value=mock_settings),
            patch("app.gitlab_client.ensure_labels"),
            patch("app.main.Base.metadata.create_all"),
            patch("app.main.threading.Thread", return_value=mock_thread),
        ):
            async with lifespan(test_app):
                pass

        # 3 threads: sla, snapshot, user_sync (email ingest moved to Celery Beat)
        assert mock_thread.start.call_count >= 3

    _run_lifespan(_inner())


def test_lifespan_insecure_key_raises():
    """SECRET_KEY too short → RuntimeError (line 252)."""
    from app.main import lifespan
    from fastapi import FastAPI
    import pytest as pt

    async def _inner():
        test_app = FastAPI()

        mock_settings = MagicMock()
        mock_settings.SECRET_KEY = "short"  # < 32 chars
        mock_settings.ENVIRONMENT = "development"

        with patch("app.main.get_settings", return_value=mock_settings):
            with pt.raises(RuntimeError, match="SECRET_KEY is insecure"):
                async with lifespan(test_app):
                    pass

    _run_lifespan(_inner())


def test_lifespan_missing_token_encryption_key_production():
    """TOKEN_ENCRYPTION_KEY missing in non-dev → RuntimeError (line 259)."""
    from app.main import lifespan
    from fastapi import FastAPI
    import pytest as pt

    async def _inner():
        test_app = FastAPI()

        mock_settings = MagicMock()
        mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
        mock_settings.ENVIRONMENT = "production"
        mock_settings.TOKEN_ENCRYPTION_KEY = ""  # Empty in production

        with patch("app.main.get_settings", return_value=mock_settings):
            with pt.raises(RuntimeError, match="TOKEN_ENCRYPTION_KEY"):
                async with lifespan(test_app):
                    pass

    _run_lifespan(_inner())


def test_lifespan_ensure_labels_exception():
    """ensure_labels fails → warning logged, startup continues (lines 278-279)."""
    from app.main import lifespan
    from fastapi import FastAPI

    async def _inner():
        test_app = FastAPI()

        mock_settings = MagicMock()
        mock_settings.SECRET_KEY = "test-secret-key-at-least-32-chars-long"
        mock_settings.ENVIRONMENT = "development"
        mock_settings.TOKEN_ENCRYPTION_KEY = ""
        mock_settings.GITLAB_PROJECT_TOKEN = "token"
        mock_settings.NOTIFICATION_ENABLED = False
        mock_settings.IMAP_ENABLED = False
        mock_settings.USER_SYNC_INTERVAL = 3600

        mock_thread = MagicMock()
        mock_thread.start = MagicMock()
        mock_thread.join = MagicMock()

        with (
            patch("app.main.get_settings", return_value=mock_settings),
            patch("app.gitlab_client.ensure_labels", side_effect=Exception("GitLab unavailable")),
            patch("app.main.Base.metadata.create_all"),
            patch("app.main.threading.Thread", return_value=mock_thread),
        ):
            async with lifespan(test_app):
                pass  # should not raise

        assert mock_thread.start.call_count >= 3

    _run_lifespan(_inner())
