"""Unit tests for app/db_profiler.py."""
from unittest.mock import patch, MagicMock


def test_get_threshold_ms_exception_returns_default():
    """When get_settings raises, _get_threshold_ms returns the default (lines 25-26)."""
    from app.db_profiler import _get_threshold_ms, _SLOW_THRESHOLD_MS
    with patch("app.config.get_settings", side_effect=Exception("no settings")):
        result = _get_threshold_ms()
    assert result == _SLOW_THRESHOLD_MS


def test_setup_db_profiler_disabled_returns_early():
    """setup_db_profiler with enabled=False logs debug and returns (lines 79-80)."""
    from app.db_profiler import setup_db_profiler
    mock_app = MagicMock()
    # Should return early without adding middleware
    setup_db_profiler(mock_app, enabled=False)
    mock_app.add_middleware.assert_not_called()


def test_after_execute_logs_slow_query():
    """Slow query triggers warning log (lines 42-43)."""
    from app.db_profiler import _after_execute
    mock_conn = MagicMock()
    mock_conn.info = {"query_start_time": [0.0]}  # start time 0 → elapsed = perf_counter() * 1000

    with patch("app.db_profiler.time") as mock_time:
        # Make elapsed_ms >> threshold
        mock_time.perf_counter.return_value = 100.0  # 100s elapsed → 100000ms
        with patch("app.db_profiler._get_threshold_ms", return_value=10.0):
            with patch("app.db_profiler.logger") as mock_logger:
                _after_execute(mock_conn, None, "SELECT * FROM tickets", {}, None, False)
    mock_logger.warning.assert_called()


def test_after_execute_n_plus_one_warning():
    """N+1 detection: hitting same table 10 times triggers warning (line 54)."""
    from app.db_profiler import _after_execute, _local, track_queries
    from collections import defaultdict

    with track_queries() as counter:
        with patch("app.db_profiler._get_threshold_ms", return_value=99999.0):
            with patch("app.db_profiler.logger") as mock_logger:
                for i in range(10):
                    mock_conn = MagicMock()
                    mock_conn.info = {"query_start_time": [0.0]}
                    with patch("app.db_profiler.time") as mock_time:
                        mock_time.perf_counter.return_value = 0.001  # fast query
                        _after_execute(mock_conn, None, "SELECT * FROM tickets", {}, None, False)

    # Warning should have been triggered at 10th query
    warning_calls = [c for c in mock_logger.warning.call_args_list
                     if "N+1" in str(c) or "POSSIBLE" in str(c)]
    assert len(warning_calls) >= 1


def test_track_queries_context_manager():
    """track_queries sets and clears _local.query_counter."""
    from app.db_profiler import track_queries, _local
    with track_queries() as counter:
        assert hasattr(_local, "query_counter")
        assert _local.query_counter is not None
    assert _local.query_counter is None
