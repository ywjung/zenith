"""
AI Service — OpenAI / Ollama / Anthropic 통합 추상화

기능:
  classify_ticket   : 카테고리·우선순위 자동 분류
  summarize_ticket  : 티켓+댓글 스레드 요약
  suggest_kb        : 관련 KB 문서 추천
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

VALID_CATEGORIES = {"hardware", "software", "network", "account", "other"}
VALID_PRIORITIES = {"low", "medium", "high", "critical"}

# ──────────────────────────────────────────────────────────────
# Prompt templates
# ──────────────────────────────────────────────────────────────
_CLASSIFY_PROMPT = """당신은 IT 서비스 데스크 분류 전문가입니다.
아래 티켓을 분석하여 카테고리와 우선순위를 결정하세요.

제목: {title}
설명: {description}

카테고리: hardware(하드웨어), software(소프트웨어), network(네트워크), account(계정), other(기타)
우선순위 기준:
  critical — 서비스 전체 중단·보안 침해·다수 사용자 영향
  high     — 업무 완전 중단·데드라인 임박·주요 기능 불능
  medium   — 부분 기능 이상·우회 가능
  low      — 일반 문의·불편 사항·비긴급

JSON만 반환하세요 (다른 텍스트 없이):
{{
  "category": "one of: hardware|software|network|account|other",
  "priority": "one of: low|medium|high|critical",
  "confidence": 0.0~1.0,
  "reasoning": "분류 근거 한 문장 (한국어)"
}}"""

_SUMMARIZE_PROMPT = """IT 서비스 데스크 티켓과 댓글 스레드를 분석하세요.

제목: {title}
설명: {description}

댓글:
{comments}

JSON만 반환하세요:
{{
  "summary": "현재 상황 2-3문장 요약 (한국어)",
  "key_points": ["핵심포인트1", "핵심포인트2", "핵심포인트3"],
  "suggested_action": "권장 다음 조치 (한국어)"
}}"""

_KB_SUGGEST_PROMPT = """IT 서비스 데스크 티켓과 관련성이 높은 지식베이스 문서를 추천하세요.

티켓 제목: {title}
티켓 설명: {description}

지식베이스 목록:
{kb_list}

JSON만 반환하세요 (연관도 높은 순, 최대 3개):
{{
  "suggestions": [
    {{"id": 정수, "title": "문서제목", "score": 0.0~1.0, "reason": "추천 이유 한 문장"}}
  ]
}}"""


# ──────────────────────────────────────────────────────────────
# Provider implementations
# ──────────────────────────────────────────────────────────────
def _call_openai(api_key: str, model: str, prompt: str) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai 패키지가 설치되지 않았습니다. pip install openai")
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content.strip()


def _call_ollama(base_url: str, model: str, prompt: str) -> str:
    try:
        import httpx
    except ImportError:
        raise RuntimeError("httpx 패키지가 설치되지 않았습니다.")
    resp = httpx.post(
        f"{base_url.rstrip('/')}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False, "format": "json"},
        timeout=120.0,
    )
    resp.raise_for_status()
    data = resp.json()
    raw = data.get("response", "")
    # qwen3 등 thinking 모델은 <think>...</think> 블록을 앞에 붙이는 경우가 있음
    # format=json 옵션 사용 시에는 일반적으로 발생하지 않지만 방어적으로 처리
    raw = _strip_think_tags(raw)
    return raw


def _strip_think_tags(text: str) -> str:
    """<think>...</think> 및 /think 태그 제거 후 첫 번째 JSON 블록 추출."""
    import re
    # <think>...</think> 제거
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # /think 태그만 있는 경우 제거
    text = re.sub(r"</?\s*think\s*>", "", text, flags=re.IGNORECASE)
    text = text.strip()
    # 중괄호 기준으로 첫 번째 JSON 객체 추출
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        return text[start : end + 1]
    return text


def _call_anthropic(api_key: str, prompt: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic 패키지가 설치되지 않았습니다.")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


def _dispatch(settings_row: Any, prompt: str) -> str:
    """provider에 따라 AI 호출 후 raw 문자열 반환."""
    provider = settings_row.provider
    if provider == "openai":
        if not settings_row.openai_api_key:
            raise ValueError("OpenAI API 키가 설정되지 않았습니다.")
        return _call_openai(settings_row.openai_api_key, settings_row.openai_model, prompt)
    elif provider == "ollama":
        return _call_ollama(settings_row.ollama_base_url, settings_row.ollama_model, prompt)
    else:
        raise ValueError(f"지원하지 않는 AI provider: {provider}")


def _parse_json(raw: str) -> dict:
    """JSON 파싱 — 코드블록 감싸진 경우도 처리."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────
def classify_ticket(settings_row: Any, title: str, description: str) -> dict:
    """
    티켓 카테고리·우선순위 자동 분류.

    Returns:
        {category, priority, confidence, reasoning}
    """
    prompt = _CLASSIFY_PROMPT.format(
        title=title,
        description=(description or "")[:1500],
    )
    try:
        raw = _dispatch(settings_row, prompt)
        result = _parse_json(raw)
    except Exception as e:
        logger.warning("AI classify failed: %s", e)
        return {"category": None, "priority": None, "confidence": 0.0, "reasoning": str(e)}

    if result.get("category") not in VALID_CATEGORIES:
        result["category"] = None
    if result.get("priority") not in VALID_PRIORITIES:
        result["priority"] = None
    result.setdefault("confidence", 0.8)
    result.setdefault("reasoning", "")
    return result


def summarize_ticket(settings_row: Any, title: str, description: str, comments: list) -> dict:
    """
    티켓+댓글 스레드 요약.

    Returns:
        {summary, key_points, suggested_action}
    """
    comments_text = "\n".join([
        f"[{c.get('author', {}).get('name', '?')}] {c.get('body', '').strip()[:500]}"
        for c in comments[-30:]
    ]) or "(댓글 없음)"

    prompt = _SUMMARIZE_PROMPT.format(
        title=title,
        description=(description or "")[:800],
        comments=comments_text,
    )
    try:
        raw = _dispatch(settings_row, prompt)
        result = _parse_json(raw)
    except Exception as e:
        logger.warning("AI summarize failed: %s", e)
        raise RuntimeError(f"AI 요약 생성 중 오류: {e}") from e

    result.setdefault("summary", "")
    result.setdefault("key_points", [])
    result.setdefault("suggested_action", "")
    return result


def suggest_kb(settings_row: Any, title: str, description: str, kb_articles: list) -> list:
    """
    관련 KB 문서 추천.

    kb_articles: [{id, title, content_snippet}, ...]
    Returns:
        [{id, title, score, reason}, ...]
    """
    if not kb_articles:
        return []

    kb_list = "\n".join([
        f"{i+1}. [ID:{a['id']}] {a['title']}: {str(a.get('content_snippet', ''))[:200]}"
        for i, a in enumerate(kb_articles[:20])
    ])

    prompt = _KB_SUGGEST_PROMPT.format(
        title=title,
        description=(description or "")[:800],
        kb_list=kb_list,
    )
    try:
        raw = _dispatch(settings_row, prompt)
        result = _parse_json(raw)
        return result.get("suggestions", [])
    except Exception as e:
        logger.warning("AI kb_suggest failed: %s", e)
        return []
