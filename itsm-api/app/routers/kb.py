"""Knowledge Base router."""
import json
import re
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..models import KBArticle
from ..rbac import require_agent, require_admin
from ..rate_limit import user_limiter, LIMIT_KB_CREATE, LIMIT_UPLOAD

_KB_CACHE_TTL = 300        # KB 목록 Redis 캐시 5분
_KB_ARTICLE_CACHE_TTL = 300  # KB 개별 아티클 캐시 5분
_KB_VIEW_COOLDOWN = 300    # 조회수 중복 카운트 방지 쿨다운 (5분)


def _get_redis():
    try:
        import redis as _r
        r = _r.from_url(get_settings().REDIS_URL, socket_connect_timeout=1, decode_responses=True)
        r.ping()
        return r
    except Exception:
        return None


def _invalidate_kb_cache():
    r = _get_redis()
    if r:
        keys = r.keys("itsm:kb:*")
        if keys:
            r.delete(*keys)

router = APIRouter(prefix="/kb", tags=["knowledge-base"])


def _slug_from_title(title: str) -> str:
    """Generate a URL-safe slug from a title."""
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    slug = re.sub(r"[\s_-]+", "-", slug)
    slug = slug.strip("-")
    return slug or "article"


def _ensure_unique_slug(db: Session, base_slug: str, exclude_id: Optional[int] = None) -> str:
    slug = base_slug
    counter = 1
    while True:
        q = db.query(KBArticle).filter(KBArticle.slug == slug)
        if exclude_id:
            q = q.filter(KBArticle.id != exclude_id)
        if not q.first():
            return slug
        slug = f"{base_slug}-{counter}"
        counter += 1


class ArticleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500, description="아티클 제목")
    content: str = Field(..., min_length=1, description="아티클 본문")
    category: Optional[str] = None
    published: bool = False
    tags: List[str] = []  # F-8


class ArticlePatch(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None  # F-8


@router.get("/articles")
def list_articles(
    q: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[str] = Query(default=None, description="쉼표로 구분된 태그 (F-8)"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "user")
    is_agent = role in ("agent", "admin")

    # Redis 캐시 (필터 없을 때만 — 검색·태그·카테고리 필터 시 캐시 우회)
    use_cache = not q and not category and not tags
    cache_key = f"itsm:kb:list:{role}:{page}:{per_page}"
    if use_cache:
        r = _get_redis()
        if r:
            cached = r.get(cache_key)
            if cached:
                return json.loads(cached)

    query = db.query(KBArticle)
    if not is_agent:
        query = query.filter(KBArticle.published == True)  # noqa: E712

    if q:
        try:
            fts_filter = sa_text(
                "to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', :q)"
            ).bindparams(q=q)
            query = query.filter(fts_filter)
        except Exception:
            like = f"%{q}%"
            query = query.filter(
                KBArticle.title.ilike(like) | KBArticle.content.ilike(like)
            )
    if category:
        query = query.filter(KBArticle.category == category)
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            query = query.filter(KBArticle.tags.contains(tag_list))

    total = query.count()
    articles = (
        query.order_by(KBArticle.updated_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    result = {
        "total": total,
        "page": page,
        "per_page": per_page,
        "articles": [_article_to_dict(a, include_content=False) for a in articles],
    }
    if use_cache:
        r = _get_redis()
        if r:
            r.setex(cache_key, _KB_CACHE_TTL, json.dumps(result, default=str))
    return result


@router.get("/articles/{id_or_slug}")
def get_article(
    id_or_slug: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "user")
    is_agent = role in ("agent", "admin")

    # Redis 캐시 확인 (published 아티클만)
    cache_key = f"itsm:kb:article:{id_or_slug}"
    r = _get_redis()
    if r and not is_agent:
        cached = r.get(cache_key)
        if cached:
            return json.loads(cached)

    article = None
    if id_or_slug.isdigit():
        article = db.query(KBArticle).filter(KBArticle.id == int(id_or_slug)).first()
    if not article:
        article = db.query(KBArticle).filter(KBArticle.slug == id_or_slug).first()
    if not article:
        raise HTTPException(status_code=404, detail="아티클을 찾을 수 없습니다.")

    if not article.published and not is_agent:
        raise HTTPException(status_code=403, detail="권한이 부족합니다.")

    # 조회수 증가 — Redis로 사용자별 쿨다운 적용 (중복 카운트 방지)
    user_id = str(user.get("sub", "anon"))
    view_key = f"itsm:kb:view:{article.id}:{user_id}"
    already_viewed = False
    if r:
        try:
            already_viewed = bool(r.get(view_key))
            if not already_viewed:
                r.setex(view_key, _KB_VIEW_COOLDOWN, "1")
        except Exception:
            pass
    if not already_viewed:
        article.view_count = (article.view_count or 0) + 1
        db.commit()

    result = _article_to_dict(article, include_content=True)
    if r and article.published and not is_agent:
        r.setex(cache_key, _KB_ARTICLE_CACHE_TTL, json.dumps(result, default=str))
    return result


@router.get("/suggest")
def suggest_kb_articles(
    q: str = Query(..., min_length=2, description="검색어 (티켓 제목 기반)"),
    limit: int = Query(default=3, le=5),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 제목 입력 시 관련 KB 아티클 자동 추천.

    PostgreSQL FTS 유사도 기반 TOP N 반환.
    에이전트 댓글 작성 시에도 활용 가능.
    """
    try:
        # websearch_to_tsquery: OR 연산 지원, 긴 제목 입력 시에도 부분 매칭
        # 예) "Docker 설치 방법" → Docker | 설치 | 방법 (AND 대신 OR)
        results = (
            db.query(KBArticle)
            .filter(
                KBArticle.published == True,  # noqa: E712
                sa_text(
                    "to_tsvector('simple', title || ' ' || content) @@ "
                    "websearch_to_tsquery('simple', :q)"
                ).bindparams(q=q),
            )
            .order_by(KBArticle.view_count.desc())
            .limit(limit)
            .all()
        )
        # websearch 결과가 없으면 단어 분리 OR 검색으로 폴백
        if not results:
            words = q.split()[:5]  # 최대 5개 단어
            or_query = " | ".join(words)
            results = (
                db.query(KBArticle)
                .filter(
                    KBArticle.published == True,  # noqa: E712
                    sa_text(
                        "to_tsvector('simple', title || ' ' || content) @@ "
                        "to_tsquery('simple', :q)"
                    ).bindparams(q=or_query),
                )
                .order_by(KBArticle.view_count.desc())
                .limit(limit)
                .all()
            )
    except Exception:
        # FTS 폴백
        like = f"%{q}%"
        results = (
            db.query(KBArticle)
            .filter(
                KBArticle.published == True,  # noqa: E712
                (KBArticle.title.ilike(like) | KBArticle.content.ilike(like)),
            )
            .order_by(KBArticle.view_count.desc())
            .limit(limit)
            .all()
        )
    return [
        {
            "id": a.id,
            "slug": a.slug,
            "title": a.title,
            "category": a.category,
            "view_count": a.view_count,
        }
        for a in results
    ]


@router.post("/articles", status_code=201)
@(user_limiter.limit(LIMIT_KB_CREATE) if user_limiter else lambda f: f)
def create_article(
    request: Request,
    data: ArticleCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_agent),
):
    base_slug = _slug_from_title(data.title)
    slug = _ensure_unique_slug(db, base_slug)
    article = KBArticle(
        title=data.title,
        slug=slug,
        content=data.content,
        category=data.category,
        tags=data.tags,  # F-8
        author_id=str(user.get("sub", "")),
        author_name=user.get("name", user.get("username", "")),
        published=data.published,
    )
    db.add(article)
    db.commit()
    db.refresh(article)
    _invalidate_kb_cache()
    return _article_to_dict(article, include_content=True)


@router.put("/articles/{article_id}")
def update_article(
    article_id: int,
    data: ArticleCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="아티클을 찾을 수 없습니다.")

    old_title = article.title
    article.title = data.title
    article.content = data.content
    article.category = data.category
    article.tags = data.tags  # F-8
    article.published = data.published

    if data.title != old_title:
        base_slug = _slug_from_title(data.title)
        article.slug = _ensure_unique_slug(db, base_slug, exclude_id=article_id)

    article.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(article)
    _invalidate_kb_cache()
    return _article_to_dict(article, include_content=True)


@router.delete("/articles/{article_id}", status_code=204)
def delete_article(
    article_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_admin),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="아티클을 찾을 수 없습니다.")
    db.delete(article)
    db.commit()
    _invalidate_kb_cache()


@router.patch("/articles/{article_id}/publish")
def publish_article(
    article_id: int,
    published: bool = True,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_agent),
):
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="아티클을 찾을 수 없습니다.")
    article.published = published
    article.updated_at = datetime.utcnow()
    db.commit()
    _invalidate_kb_cache()
    return {"id": article.id, "published": article.published}


@router.post("/articles/upload", response_model=dict)
@(user_limiter.limit(LIMIT_UPLOAD) if user_limiter else lambda f: f)
async def upload_kb_attachment(
    request: Request,
    file: UploadFile = File(...),
    project_id: Optional[str] = Query(default=None),
    _user: dict = Depends(require_agent),
):
    """KB 아티클용 파일 첨부 업로드.

    티켓 첨부와 동일한 보안 검증(MIME + magic bytes)을 적용한다.
    GitLab 프로젝트에 업로드하고 마크다운 삽입 문자열을 반환한다.
    """
    # 티켓 라우터의 검증 로직 재사용
    from .tickets import (
        MAX_FILE_SIZE,
        ALLOWED_MIME_TYPES,
        _validate_magic_bytes,
    )
    from .. import gitlab_client

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="파일 크기는 10MB를 초과할 수 없습니다.")

    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="허용되지 않는 파일 형식입니다.")

    _validate_magic_bytes(content, mime)
    # 이미지 EXIF 메타데이터 제거
    from .tickets import _strip_image_metadata, _scan_with_clamav
    content = _strip_image_metadata(content, mime)
    # ClamAV 바이러스 스캔
    _scan_with_clamav(content, file.filename or "file")

    pid = project_id or get_settings().GITLAB_PROJECT_ID
    try:
        result = gitlab_client.upload_file(pid, file.filename or "file", content, mime)
        return {
            "markdown": result.get("markdown", ""),
            "url": result.get("url", ""),
            "full_path": result.get("full_path", ""),
            "proxy_path": result.get("proxy_path", result.get("full_path", "")),
            "name": file.filename,
            "size": len(content),
            "mime": mime,
        }
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("KB file upload failed: %s", e)
        raise HTTPException(status_code=502, detail="파일 업로드에 실패했습니다.")


def _article_to_dict(article: KBArticle, include_content: bool = True) -> dict:
    result = {
        "id": article.id,
        "title": article.title,
        "slug": article.slug,
        "category": article.category,
        "tags": article.tags or [],  # F-8
        "author_id": article.author_id,
        "author_name": article.author_name,
        "published": article.published,
        "view_count": article.view_count,
        "created_at": article.created_at.isoformat() if article.created_at else None,
        "updated_at": article.updated_at.isoformat() if article.updated_at else None,
    }
    if include_content:
        result["content"] = article.content
    return result
