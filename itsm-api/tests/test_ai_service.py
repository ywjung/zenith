"""Tests for app.ai_service — all external calls (OpenAI, Ollama, httpx) are mocked."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.ai_service import (
    _call_ollama,
    _call_openai,
    _dispatch,
    _maybe_refresh_oauth_token,
    _parse_json,
    _strip_think_tags,
    classify_ticket,
    suggest_kb,
    summarize_ticket,
    VALID_CATEGORIES,
    VALID_PRIORITIES,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_settings(**overrides):
    """Create a fake AISettings row as a SimpleNamespace."""
    defaults = {
        "provider": "openai",
        "openai_api_key": "sk-test-key",
        "openai_model": "gpt-4o-mini",
        "ollama_base_url": "http://localhost:11434",
        "ollama_model": "llama3.2",
        "openai_auth_method": "api_key",
        "openai_oauth_refresh_token": None,
        "openai_oauth_token_expires_at": None,
        "openai_oauth_access_token": None,
        "openai_oauth_token_url": None,
        "openai_oauth_client_id": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _mock_openai_response(content: str):
    """Build a mock OpenAI chat completion response."""
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    resp = MagicMock()
    resp.choices = [choice]
    return resp


# ── _strip_think_tags ────────────────────────────────────────────────────────


def test_strip_think_tags_removes_block():
    text = '<think>reasoning here</think>{"key": "value"}'
    assert _strip_think_tags(text) == '{"key": "value"}'


def test_strip_think_tags_multiline():
    text = '<think>\nlong\nreasoning\n</think>\n{"a": 1}'
    assert _strip_think_tags(text) == '{"a": 1}'


def test_strip_think_tags_only_closing():
    text = 'some text</think>{"x": 2}'
    assert _strip_think_tags(text) == '{"x": 2}'


def test_strip_think_tags_no_json():
    assert _strip_think_tags("plain text") == "plain text"


def test_strip_think_tags_empty():
    assert _strip_think_tags("") == ""


# ── _parse_json ──────────────────────────────────────────────────────────────


def test_parse_json_clean():
    raw = '{"category": "hardware", "priority": "high"}'
    result = _parse_json(raw)
    assert result["category"] == "hardware"


def test_parse_json_markdown_wrapped():
    raw = '```json\n{"category": "network"}\n```'
    result = _parse_json(raw)
    assert result["category"] == "network"


def test_parse_json_markdown_no_lang():
    raw = '```\n{"priority": "low"}\n```'
    result = _parse_json(raw)
    assert result["priority"] == "low"


def test_parse_json_whitespace():
    raw = '  \n {"ok": true}  \n '
    result = _parse_json(raw)
    assert result["ok"] is True


def test_parse_json_invalid_raises():
    with pytest.raises(json.JSONDecodeError):
        _parse_json("not json at all")


# ── _call_openai ─────────────────────────────────────────────────────────────


def test_call_openai_success():
    mock_resp = _mock_openai_response('{"result": "ok"}')
    mock_client_cls = MagicMock()
    mock_client_cls.return_value.chat.completions.create.return_value = mock_resp

    with patch("app.ai_service.OpenAI", mock_client_cls, create=True):
        # _call_openai imports OpenAI locally, so we patch via the import mechanism
        from importlib import reload
        import app.ai_service as mod
        # Patch at module import level
        with patch.dict("sys.modules", {"openai": MagicMock(OpenAI=mock_client_cls)}):
            result = _call_openai("sk-test", "gpt-4o-mini", "hello")
    assert result == '{"result": "ok"}'


def test_call_openai_insufficient_quota():
    mock_client_cls = MagicMock()
    mock_client_cls.return_value.chat.completions.create.side_effect = Exception(
        "Error: insufficient_quota"
    )
    with patch.dict("sys.modules", {"openai": MagicMock(OpenAI=mock_client_cls)}):
        with pytest.raises(RuntimeError, match="크레딧이 소진"):
            _call_openai("sk-test", "gpt-4o-mini", "hello")


# ── _call_ollama ─────────────────────────────────────────────────────────────


def test_call_ollama_success():
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"response": '{"category": "hardware"}'}
    mock_resp.raise_for_status = MagicMock()

    with patch.dict("sys.modules", {"httpx": MagicMock(post=MagicMock(return_value=mock_resp))}):
        # Need to call through the actual httpx.post
        import httpx
        with patch.object(httpx, "post", return_value=mock_resp):
            result = _call_ollama("http://localhost:11434", "llama3.2", "test prompt")
    assert '"category"' in result


def test_call_ollama_strips_think_tags():
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "response": '<think>reasoning</think>{"category": "network"}'
    }
    mock_resp.raise_for_status = MagicMock()

    import httpx
    with patch.object(httpx, "post", return_value=mock_resp):
        result = _call_ollama("http://localhost:11434", "llama3.2", "test")
    assert result == '{"category": "network"}'


# ── _maybe_refresh_oauth_token ───────────────────────────────────────────────


def test_maybe_refresh_no_refresh_token():
    """No refresh token → skip (no-op)."""
    row = _make_settings(openai_oauth_refresh_token=None)
    _maybe_refresh_oauth_token(row)  # should not raise


def test_maybe_refresh_no_expires_at():
    """Has refresh token but no expires_at → skip."""
    row = _make_settings(
        openai_oauth_refresh_token="rt-xxx",
        openai_oauth_token_expires_at=None,
    )
    _maybe_refresh_oauth_token(row)  # should not raise


def test_maybe_refresh_token_still_valid():
    """Token expires in 30 min → skip (> 5 min threshold)."""
    row = _make_settings(
        openai_oauth_refresh_token="rt-xxx",
        openai_oauth_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    _maybe_refresh_oauth_token(row)
    # api_key should not change
    assert row.openai_api_key == "sk-test-key"


def test_maybe_refresh_token_expired_refreshes():
    """Token expires in 2 min → should call refresh endpoint."""
    row = _make_settings(
        openai_oauth_refresh_token="rt-xxx",
        openai_oauth_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=2),
        openai_auth_method="oauth",
        openai_oauth_token_url="https://example.com/oauth/token",
        openai_oauth_client_id="client-123",
    )

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "access_token": "new-access-token",
        "refresh_token": "new-refresh-token",
        "expires_in": 3600,
    }

    mock_db = MagicMock()
    with patch("app.ai_service.httpx.post", return_value=mock_resp), \
         patch("app.ai_service.SessionLocal", return_value=mock_db):
        _maybe_refresh_oauth_token(row)

    assert row.openai_api_key == "new-access-token"
    assert row.openai_oauth_access_token == "new-access-token"
    assert row.openai_oauth_refresh_token == "new-refresh-token"
    mock_db.merge.assert_called_once_with(row)
    mock_db.commit.assert_called_once()


def test_maybe_refresh_codex_oauth_uses_hardcoded_url():
    """codex_oauth auth method → uses hardcoded auth.openai.com URL."""
    row = _make_settings(
        openai_oauth_refresh_token="rt-xxx",
        openai_oauth_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=2),
        openai_auth_method="codex_oauth",
    )

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"access_token": "new-token", "expires_in": 3600}

    mock_db = MagicMock()
    with patch("app.ai_service.httpx.post", return_value=mock_resp) as mock_post, \
         patch("app.ai_service.SessionLocal", return_value=mock_db):
        _maybe_refresh_oauth_token(row)

    # Should call the hardcoded Codex OAuth URL
    call_args = mock_post.call_args
    assert call_args[0][0] == "https://auth.openai.com/oauth/token"


def test_maybe_refresh_failure_logs_warning():
    """Refresh failure should not raise — just log warning."""
    row = _make_settings(
        openai_oauth_refresh_token="rt-xxx",
        openai_oauth_token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=2),
        openai_auth_method="oauth",
        openai_oauth_token_url="https://example.com/oauth/token",
        openai_oauth_client_id="client-123",
    )

    with patch("app.ai_service.httpx.post", side_effect=Exception("network error")):
        # Should not raise
        _maybe_refresh_oauth_token(row)

    # api_key should remain unchanged
    assert row.openai_api_key == "sk-test-key"


# ── _dispatch ────────────────────────────────────────────────────────────────


def test_dispatch_openai():
    row = _make_settings(provider="openai")
    with patch("app.ai_service._call_openai", return_value='{"ok": true}') as mock:
        result = _dispatch(row, "test prompt")
    assert result == '{"ok": true}'
    mock.assert_called_once_with("sk-test-key", "gpt-4o-mini", "test prompt")


def test_dispatch_ollama():
    row = _make_settings(provider="ollama")
    with patch("app.ai_service._call_ollama", return_value='{"ok": true}') as mock:
        result = _dispatch(row, "test prompt")
    assert result == '{"ok": true}'
    mock.assert_called_once_with("http://localhost:11434", "llama3.2", "test prompt")


def test_dispatch_unknown_provider():
    row = _make_settings(provider="unknown")
    with pytest.raises(ValueError, match="지원하지 않는"):
        _dispatch(row, "test")


def test_dispatch_openai_no_key():
    row = _make_settings(provider="openai", openai_api_key="")
    with pytest.raises(ValueError, match="API 키"):
        _dispatch(row, "test")


# ── classify_ticket ──────────────────────────────────────────────────────────


def test_classify_ticket_success():
    row = _make_settings()
    ai_response = json.dumps({
        "category": "hardware",
        "priority": "high",
        "confidence": 0.95,
        "reasoning": "프린터 관련 문제",
    })
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = classify_ticket(row, "프린터 고장", "프린터가 작동하지 않습니다")
    assert result["category"] == "hardware"
    assert result["priority"] == "high"
    assert result["confidence"] == 0.95


def test_classify_ticket_invalid_category():
    row = _make_settings()
    ai_response = json.dumps({
        "category": "invalid_cat",
        "priority": "high",
        "confidence": 0.8,
        "reasoning": "test",
    })
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = classify_ticket(row, "test", "test")
    assert result["category"] is None
    assert result["priority"] == "high"


def test_classify_ticket_invalid_priority():
    row = _make_settings()
    ai_response = json.dumps({
        "category": "network",
        "priority": "urgent",
        "confidence": 0.8,
        "reasoning": "test",
    })
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = classify_ticket(row, "test", "test")
    assert result["category"] == "network"
    assert result["priority"] is None


def test_classify_ticket_dispatch_failure():
    row = _make_settings()
    with patch("app.ai_service._dispatch", side_effect=Exception("API down")):
        result = classify_ticket(row, "test", "test")
    assert result["category"] is None
    assert result["priority"] is None
    assert result["confidence"] == 0.0
    assert "API down" in result["reasoning"]


def test_classify_ticket_defaults():
    """Missing confidence/reasoning in AI response → defaults applied."""
    row = _make_settings()
    ai_response = json.dumps({"category": "software", "priority": "low"})
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = classify_ticket(row, "test", "test")
    assert result["confidence"] == 0.8
    assert result["reasoning"] == ""


# ── summarize_ticket ─────────────────────────────────────────────────────────


def test_summarize_ticket_success():
    row = _make_settings()
    ai_response = json.dumps({
        "summary": "프린터 연결 문제 발생",
        "key_points": ["USB 케이블 점검 필요", "드라이버 재설치 시도"],
        "suggested_action": "현장 방문 점검",
    })
    comments = [
        {"author": {"name": "홍길동"}, "body": "USB 연결 확인했는데 안 됩니다"},
    ]
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = summarize_ticket(row, "프린터 고장", "프린터 불량", comments)
    assert result["summary"] == "프린터 연결 문제 발생"
    assert len(result["key_points"]) == 2


def test_summarize_ticket_empty_comments():
    row = _make_settings()
    ai_response = json.dumps({
        "summary": "요약",
        "key_points": [],
        "suggested_action": "확인 필요",
    })
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = summarize_ticket(row, "제목", "설명", [])
    assert result["summary"] == "요약"


def test_summarize_ticket_failure_raises():
    row = _make_settings()
    with patch("app.ai_service._dispatch", side_effect=Exception("timeout")):
        with pytest.raises(RuntimeError, match="AI 요약 생성 중 오류"):
            summarize_ticket(row, "제목", "설명", [])


def test_summarize_ticket_defaults():
    """Missing fields in AI response → defaults applied."""
    row = _make_settings()
    ai_response = json.dumps({})
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = summarize_ticket(row, "제목", "설명", [])
    assert result["summary"] == ""
    assert result["key_points"] == []
    assert result["suggested_action"] == ""


# ── suggest_kb ───────────────────────────────────────────────────────────────


def test_suggest_kb_success():
    row = _make_settings()
    ai_response = json.dumps({
        "suggestions": [
            {"id": 1, "title": "프린터 문제 해결", "score": 0.9, "reason": "관련 문서"},
        ],
    })
    kb_articles = [
        {"id": 1, "title": "프린터 문제 해결", "content_snippet": "USB 연결 확인..."},
    ]
    with patch("app.ai_service._dispatch", return_value=ai_response):
        result = suggest_kb(row, "프린터 고장", "작동 안함", kb_articles)
    assert len(result) == 1
    assert result[0]["id"] == 1


def test_suggest_kb_empty_articles():
    row = _make_settings()
    result = suggest_kb(row, "제목", "설명", [])
    assert result == []


def test_suggest_kb_dispatch_failure():
    row = _make_settings()
    kb_articles = [{"id": 1, "title": "doc", "content_snippet": "text"}]
    with patch("app.ai_service._dispatch", side_effect=Exception("fail")):
        result = suggest_kb(row, "제목", "설명", kb_articles)
    assert result == []


def test_suggest_kb_invalid_json():
    row = _make_settings()
    kb_articles = [{"id": 1, "title": "doc", "content_snippet": "text"}]
    with patch("app.ai_service._dispatch", return_value="not json"):
        result = suggest_kb(row, "제목", "설명", kb_articles)
    assert result == []
