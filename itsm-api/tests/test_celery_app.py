"""Tests for app/celery_app.py — signal handlers and app configuration."""
from unittest.mock import MagicMock, patch
import logging


def test_celery_app_created():
    """celery_app singleton is created and is a Celery instance."""
    from celery import Celery
    from app.celery_app import celery_app
    assert isinstance(celery_app, Celery)
    assert celery_app.main == "itsm"


def test_celery_beat_schedule_keys():
    """Beat schedule contains expected periodic tasks."""
    from app.celery_app import celery_app
    schedule = celery_app.conf.beat_schedule
    assert "sla-check-every-5min" in schedule
    assert "daily-snapshot-midnight" in schedule
    assert "user-sync-hourly" in schedule
    assert "email-ingest-every-2min" in schedule
    assert "search-index-sync-every-30min" in schedule
    assert "db-cleanup-daily-3am" in schedule


def test_on_task_failure_with_sender(caplog):
    """on_task_failure logs ERROR with task name from sender."""
    from app.celery_app import on_task_failure
    mock_sender = MagicMock()
    mock_sender.name = "itsm.my_task"
    with caplog.at_level(logging.ERROR, logger="app.celery_app"):
        on_task_failure(sender=mock_sender, task_id="abc-123", exception=ValueError("boom"))
    assert "FAILED" in caplog.text
    assert "itsm.my_task" in caplog.text


def test_on_task_failure_without_sender(caplog):
    """on_task_failure uses 'unknown' when sender is None."""
    from app.celery_app import on_task_failure
    with caplog.at_level(logging.ERROR, logger="app.celery_app"):
        on_task_failure(sender=None, task_id="xyz", exception=RuntimeError("err"))
    assert "unknown" in caplog.text
    assert "FAILED" in caplog.text


def test_on_task_retry_with_sender(caplog):
    """on_task_retry logs WARNING with task name and reason."""
    from app.celery_app import on_task_retry
    mock_sender = MagicMock()
    mock_sender.name = "itsm.retry_task"
    with caplog.at_level(logging.WARNING, logger="app.celery_app"):
        on_task_retry(sender=mock_sender, task_id="retry-1", reason="transient error")
    assert "RETRY" in caplog.text
    assert "itsm.retry_task" in caplog.text


def test_on_task_retry_without_sender(caplog):
    """on_task_retry uses 'unknown' when sender is None."""
    from app.celery_app import on_task_retry
    with caplog.at_level(logging.WARNING, logger="app.celery_app"):
        on_task_retry(sender=None, task_id="retry-2", reason="connection lost")
    assert "unknown" in caplog.text


def test_on_task_revoked_with_request(caplog):
    """on_task_revoked logs WARNING with task name from request.task."""
    from app.celery_app import on_task_revoked
    mock_request = MagicMock()
    mock_request.task = "itsm.long_task"
    with caplog.at_level(logging.WARNING, logger="app.celery_app"):
        on_task_revoked(sender=None, request=mock_request, terminated=True, signum=15)
    assert "REVOKED" in caplog.text
    assert "itsm.long_task" in caplog.text


def test_on_task_revoked_no_request(caplog):
    """on_task_revoked falls back to 'unknown' when request has no .task."""
    from app.celery_app import on_task_revoked
    with caplog.at_level(logging.WARNING, logger="app.celery_app"):
        on_task_revoked(sender=None, request=None, terminated=False, signum=None)
    assert "unknown" in caplog.text
    assert "REVOKED" in caplog.text


def test_on_worker_ready_with_hostname(caplog):
    """on_worker_ready logs INFO with hostname."""
    from app.celery_app import on_worker_ready
    mock_sender = MagicMock()
    mock_sender.hostname = "celery@worker1"
    with caplog.at_level(logging.INFO, logger="app.celery_app"):
        on_worker_ready(sender=mock_sender)
    assert "ready" in caplog.text.lower()
    assert "celery@worker1" in caplog.text


def test_on_worker_ready_no_hostname(caplog):
    """on_worker_ready uses '?' when sender has no hostname."""
    from app.celery_app import on_worker_ready
    with caplog.at_level(logging.INFO, logger="app.celery_app"):
        on_worker_ready(sender=None)
    assert "?" in caplog.text
