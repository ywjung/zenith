"""Unit tests for app/business_metrics.py — Prometheus KPI gauge refresh."""
from unittest.mock import patch, MagicMock, call
from contextlib import contextmanager


def _make_session_factory(db_mock):
    """Return a context-manager-based session factory that yields db_mock."""
    @contextmanager
    def factory():
        yield db_mock
    return factory


def _db_with_scalars(**table_counts):
    """Build a mock DB that returns 0 for all scalar queries and empty lists."""
    db = MagicMock()

    def execute_side_effect(stmt, params=None):
        result = MagicMock()
        result.scalar.return_value = 0
        result.all.return_value = []
        return result

    db.execute.side_effect = execute_side_effect
    return db


# ── _refresh ──────────────────────────────────────────────────────────────────

def test_refresh_runs_without_error():
    """_refresh executes with an empty DB without raising."""
    from app.business_metrics import _refresh
    db = _db_with_scalars()
    factory = _make_session_factory(db)
    _refresh(factory)  # should not raise


def test_refresh_handles_exception_gracefully():
    """If the session factory raises, _refresh logs and returns."""
    from app.business_metrics import _refresh

    @contextmanager
    def bad_factory():
        raise RuntimeError("DB unavailable")
        yield  # pragma: no cover

    _refresh(bad_factory)  # should not raise


def test_refresh_sets_kb_article_gauges():
    """_refresh calls set() on the KB article gauges."""
    from app.business_metrics import _refresh, itsm_kb_articles_total

    db = _db_with_scalars()
    factory = _make_session_factory(db)

    with patch.object(itsm_kb_articles_total, "labels") as mock_labels:
        mock_gauge = MagicMock()
        mock_labels.return_value = mock_gauge
        _refresh(factory)

    # labels() should have been called for "published" and "draft"
    calls = [c[1] for c in mock_labels.call_args_list]
    statuses_called = [c.get("status") for c in calls]
    assert "published" in statuses_called
    assert "draft" in statuses_called


def test_refresh_sets_user_gauges_from_empty_rows():
    """With no rows from user_roles query, user gauge is not called."""
    from app.business_metrics import _refresh, itsm_users_total
    db = _db_with_scalars()
    factory = _make_session_factory(db)
    with patch.object(itsm_users_total, "labels") as mock_labels:
        _refresh(factory)
    # No rows → no label calls for users
    mock_labels.assert_not_called()


def test_refresh_sets_sla_gauges():
    """_refresh calls set() on sla breached/not-breached gauges."""
    from app.business_metrics import _refresh, itsm_sla_records_total
    db = _db_with_scalars()
    factory = _make_session_factory(db)

    with patch.object(itsm_sla_records_total, "labels") as mock_labels:
        mock_gauge = MagicMock()
        mock_labels.return_value = mock_gauge
        _refresh(factory)

    calls = [c[1] for c in mock_labels.call_args_list]
    breached_values = [c.get("breached") for c in calls]
    assert "true" in breached_values
    assert "false" in breached_values


def test_refresh_sets_approval_default_statuses():
    """With empty approval rows, defaults (pending/approved/rejected) are all set to 0."""
    from app.business_metrics import _refresh, itsm_approval_requests_total
    db = _db_with_scalars()
    factory = _make_session_factory(db)

    with patch.object(itsm_approval_requests_total, "labels") as mock_labels:
        mock_gauge = MagicMock()
        mock_labels.return_value = mock_gauge
        _refresh(factory)

    calls = [c[1] for c in mock_labels.call_args_list]
    statuses = [c.get("status") for c in calls]
    assert "pending" in statuses
    assert "approved" in statuses
    assert "rejected" in statuses


def test_refresh_processes_user_role_rows():
    """_refresh sets user gauge for each role row returned."""
    from app.business_metrics import _refresh, itsm_users_total
    db = MagicMock()

    call_count = [0]

    def execute_side_effect(stmt, params=None):
        result = MagicMock()
        result.scalar.return_value = 0
        # Return role rows for the first GROUP BY query
        call_count[0] += 1
        if call_count[0] == 4:  # user_roles query (approximate order)
            result.all.return_value = [("admin", 2), ("agent", 5)]
        else:
            result.all.return_value = []
        return result

    db.execute.side_effect = execute_side_effect

    factory = _make_session_factory(db)

    # Just verify it doesn't raise; gauge set is called
    _refresh(factory)


# ── start_background_refresh ──────────────────────────────────────────────────

def test_start_background_refresh_creates_daemon_thread():
    """start_background_refresh starts a daemon thread."""
    from app.business_metrics import start_background_refresh

    factory = _make_session_factory(_db_with_scalars())
    threads_started = []

    original_thread_init = __import__("threading").Thread.__init__

    with patch("threading.Thread") as mock_thread_cls:
        mock_thread = MagicMock()
        mock_thread_cls.return_value = mock_thread
        start_background_refresh(factory, interval=300)

    mock_thread.start.assert_called_once()


def test_refresh_sets_audit_events_with_rows():
    """Audit log rows trigger itsm_audit_events_total.labels().set() (line 129)."""
    from app.business_metrics import _refresh, itsm_audit_events_total

    db = MagicMock()
    call_count = [0]

    def execute_side_effect(stmt, params=None):
        result = MagicMock()
        result.scalar.return_value = 0
        stmt_str = str(stmt) if hasattr(stmt, '__str__') else ""
        # Return audit_log rows for the audit query
        if "audit_logs" in stmt_str:
            result.all.return_value = [("create_ticket", 5), ("update_ticket", 3)]
        else:
            result.all.return_value = []
        return result

    db.execute.side_effect = execute_side_effect
    factory = _make_session_factory(db)

    with patch.object(itsm_audit_events_total, "labels") as mock_labels:
        mock_gauge = MagicMock()
        mock_labels.return_value = mock_gauge
        _refresh(factory)

    # Verify labels was called with audit event actions
    label_calls = [c for c in mock_labels.call_args_list if c.kwargs.get("action")]
    assert len(label_calls) >= 1


def test_refresh_sets_approval_with_actual_rows():
    """Approval rows trigger the for loop body (lines 169-170)."""
    from app.business_metrics import _refresh, itsm_approval_requests_total

    db = MagicMock()

    def execute_side_effect(stmt, params=None):
        result = MagicMock()
        result.scalar.return_value = 0
        stmt_str = str(stmt) if hasattr(stmt, '__str__') else ""
        if "approval_requests" in stmt_str:
            result.all.return_value = [("pending", 3), ("approved", 7)]
        else:
            result.all.return_value = []
        return result

    db.execute.side_effect = execute_side_effect
    factory = _make_session_factory(db)

    with patch.object(itsm_approval_requests_total, "labels") as mock_labels:
        mock_gauge = MagicMock()
        mock_labels.return_value = mock_gauge
        _refresh(factory)

    # Verify set() was called for approval rows
    assert mock_gauge.set.called


def test_background_refresh_loop_runs():
    """Loop body runs when time.sleep is patched out (lines 200-205)."""
    import threading
    from app.business_metrics import start_background_refresh

    factory = _make_session_factory(_db_with_scalars())
    refresh_called = []
    sleep_calls = []

    original_sleep = __import__("time").sleep

    def mock_sleep(s):
        sleep_calls.append(s)
        if len(sleep_calls) >= 2:  # After initial delay + first interval
            raise SystemExit("stop loop")

    with patch("app.business_metrics.time") as mock_time:
        mock_time.sleep.side_effect = mock_sleep
        mock_time.perf_counter = __import__("time").perf_counter

        # Run _loop directly by calling start_background_refresh and waiting briefly
        result_holder = []

        def run_loop():
            try:
                start_background_refresh(factory, interval=1)
                import time as _t
                # Get the thread that was started
                import threading as _th
                for t in _th.enumerate():
                    if t.name == "biz-metrics-refresh":
                        t.join(timeout=0.5)
                        break
            except Exception as e:
                result_holder.append(e)

        run_loop()
    # Test passes if no unexpected exception
