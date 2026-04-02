"""Knowledge Base router."""
import json
import re
from datetime import datetime, timezone
from typing import Annotated, Optional, List

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text as sa_text, func as sa_func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_scope
from ..config import get_settings
from ..database import get_db
from ..models import KBArticle
from ..rbac import require_pl, require_agent, require_admin
from ..rate_limit import user_limiter, LIMIT_KB_CREATE, LIMIT_UPLOAD
from ..redis_client import get_redis as _get_redis

_KB_CACHE_TTL = 300        # KB 목록 Redis 캐시 5분
_KB_ARTICLE_CACHE_TTL = 300  # KB 개별 아티클 캐시 5분
_KB_VIEW_COOLDOWN = 300    # 조회수 중복 카운트 방지 쿨다운 (5분)


def _invalidate_kb_cache():
    from ..redis_client import get_redis, scan_delete
    r = get_redis()
    if r:
        scan_delete(r, "itsm:kb:*")


def _sync_kb_search_index(article_id: int, article_title: str, article_content: str,
                           article_published: bool) -> None:
    """KB 아티클을 ticket_search_index에 즉시 반영한다.

    published=True 일 때만 색인, False(비공개/삭제)면 인덱스에서 제거한다.
    실패해도 KB 저장 자체는 영향받지 않으므로 예외를 삼킨다.
    """
    try:
        import re as _re
        from ..database import SessionLocal
        from ..models import TicketSearchIndex
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy import func as sa_func

        kb_project_id = "__kb__"  # KB 전용 pseudo project_id

        def _strip(text: str) -> str:
            t = _re.sub(r"<[^>]+>", " ", text)
            t = _re.sub(r"[#*`_~\[\]!>|]", " ", t)
            return _re.sub(r"\s+", " ", t).strip()[:2000]

        with SessionLocal() as db:
            if not article_published:
                # 비공개 전환 / 삭제 시 인덱스에서 제거
                db.query(TicketSearchIndex).filter(
                    TicketSearchIndex.iid == article_id,
                    TicketSearchIndex.project_id == kb_project_id,
                ).delete(synchronize_session=False)
                db.commit()
                return

            stmt = pg_insert(TicketSearchIndex).values(
                iid=article_id,
                project_id=kb_project_id,
                title=article_title,
                description_text=_strip(article_content),
                state="opened",
                labels_json=[],
                assignee_username=None,
                created_at=sa_func.now(),
                updated_at=sa_func.now(),
            ).on_conflict_do_update(
                index_elements=["iid", "project_id"],
                set_={
                    "title": article_title,
                    "description_text": _strip(article_content),
                    "state": "opened",
                    "updated_at": sa_func.now(),
                    "synced_at": sa_func.now(),
                },
            )
            db.execute(stmt)
            db.commit()
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).warning("KB search index sync failed for article %s: %s", article_id, exc)

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
    tags: List[Annotated[str, Field(max_length=50)]] = Field(default=[], max_length=20)  # F-8: max 20 tags, each ≤50 chars


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
    user: dict = Depends(require_scope("kb:read")),
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

    _base_query = query  # saved for LIKE fallback
    if q:
        try:
            # pg_trgm similarity OR FTS: 한국어 부분 매칭 개선
            fts_filter = sa_text(
                "(to_tsvector('simple', title || ' ' || content) @@ plainto_tsquery('simple', :q))"
                " OR (title % :q2)"
                " OR (content % :q3)"
            ).bindparams(q=q, q2=q, q3=q)
            query = query.filter(fts_filter)
        except Exception:
            _q_esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            _like = f"%{_q_esc}%"
            query = _base_query.filter(
                KBArticle.title.ilike(_like, escape="\\") | KBArticle.content.ilike(_like, escape="\\")
            )
    if category:
        query = query.filter(KBArticle.category == category)
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            query = query.filter(KBArticle.tags.contains(tag_list))

    # count + all 이중 쿼리 → 윈도우 함수로 단일 쿼리
    from sqlalchemy import over as _over
    from sqlalchemy.orm import load_only as _load_only
    count_col = sa_func.count().over().label("_total")
    def _exec(q):
        return (
            q.add_columns(count_col)
            .order_by(KBArticle.updated_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

    try:
        rows = _exec(query)
    except Exception:
        # FTS/trgm not available (e.g. SQLite in tests) — fall back to LIKE
        if q:
            _q_esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            _like = f"%{_q_esc}%"
            fallback_query = _base_query.filter(
                KBArticle.title.ilike(_like, escape="\\") | KBArticle.content.ilike(_like, escape="\\")
            )
            if category:
                fallback_query = fallback_query.filter(KBArticle.category == category)
            rows = _exec(fallback_query)
        else:
            raise
    total = rows[0][1] if rows else 0
    articles = [r[0] for r in rows]
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
            # set(nx=True)로 원자적으로 확인+설정 — r.get() + setex() 사이 race condition 방지
            set_result = r.set(view_key, "1", ex=_KB_VIEW_COOLDOWN, nx=True)
            already_viewed = (set_result is None)
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
    category: str | None = Query(default=None, description="티켓 카테고리 (카테고리 일치 시 점수 보너스)"),
    desc: str | None = Query(default=None, description="티켓 설명 발췌 (최대 300자, 쿼리 보강용)"),
    limit: int = Query(default=3, le=5),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """티켓 제목·설명·카테고리 기반 관련 KB 아티클 추천.

    - ts_rank_cd 가중치 벡터 (title=A, content=D) 기반 관련성 정렬
    - 카테고리 일치 시 +0.15 점수 보너스
    - 최소 관련성 임계값(0.001) 미충족 결과 제외
    - 3단계 폴백: FTS → trgm word_similarity → OR FTS → LIKE
    """
    import re as _re

    # 설명 발췌: 마크다운 제거 후 최대 150자
    desc_clean = ""
    if desc:
        desc_clean = _re.sub(r'[#*`>\[\]()\-_~|!]', ' ', desc)
        desc_clean = _re.sub(r'\s+', ' ', desc_clean).strip()[:150]

    # 검색어: 제목 + 설명 발췌 결합 (설명이 있으면 추가 컨텍스트 제공)
    combined_q = q.strip()
    if desc_clean:
        combined_q = combined_q + " " + desc_clean

    cat = (category or "").strip() or None
    _MIN_RANK = 0.001   # FTS 최소 관련성 임계값
    _MIN_TRGM = 0.08    # trgm word_similarity 최소 임계값

    def _row_to_dict(r) -> dict:
        return {"id": r.id, "slug": r.slug, "title": r.title, "category": r.category, "view_count": r.view_count}

    try:
        # ── 1단계: ts_rank_cd 가중치 벡터 기반 FTS ──────────────────────────────
        # title(A=1.0) >> content(D=0.1) → 제목 매칭이 내용 매칭보다 훨씬 높은 점수
        # CTE를 이용해 rank 계산을 한 번만 수행
        rows = db.execute(
            sa_text("""
                WITH ranked AS (
                    SELECT id, title, slug, category, view_count,
                        ts_rank_cd(
                            setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                            setweight(to_tsvector('simple', coalesce(content, '')), 'D'),
                            websearch_to_tsquery('simple', :q)
                        ) + CASE WHEN (:cat IS NOT NULL AND category = :cat) THEN 0.15 ELSE 0 END AS rank
                    FROM kb_articles
                    WHERE published = true
                      AND (
                          setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                          setweight(to_tsvector('simple', coalesce(content, '')), 'D')
                      ) @@ websearch_to_tsquery('simple', :q)
                )
                SELECT * FROM ranked WHERE rank >= :min_rank ORDER BY rank DESC LIMIT :limit
            """),
            {"q": combined_q, "cat": cat, "min_rank": _MIN_RANK, "limit": limit},
        ).fetchall()

        if rows:
            return [_row_to_dict(r) for r in rows]

        # ── 2단계: pg_trgm word_similarity — 한국어 서브스트링 부분 매칭 ──────────
        # word_similarity: 짧은 검색어가 긴 문자열 안에 포함될 때 유리
        rows = db.execute(
            sa_text("""
                WITH sim AS (
                    SELECT id, title, slug, category, view_count,
                        greatest(word_similarity(:q, title), 0) * 2
                        + greatest(word_similarity(:q, content), 0)
                        + CASE WHEN (:cat IS NOT NULL AND category = :cat) THEN 0.3 ELSE 0 END AS score
                    FROM kb_articles
                    WHERE published = true
                      AND (word_similarity(:q, title) > :min_sim
                           OR word_similarity(:q, content) > :min_sim2)
                )
                SELECT * FROM sim WHERE score > 0 ORDER BY score DESC LIMIT :limit
            """),
            {"q": q, "cat": cat, "min_sim": _MIN_TRGM, "min_sim2": _MIN_TRGM * 0.5, "limit": limit},
        ).fetchall()

        if rows:
            return [_row_to_dict(r) for r in rows]

        # ── 3단계: 단어 OR FTS 폴백 (임계값 없음) ────────────────────────────────
        # to_tsquery 토큰으로 허용되지 않는 문자 제거 후 OR 쿼리 생성
        import re as _re2
        words = [_re2.sub(r"[^\w가-힣]", "", w) for w in q.split()[:5] if _re2.sub(r"[^\w가-힣]", "", w)]
        if words:
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
            if results:
                return [
                    {"id": a.id, "slug": a.slug, "title": a.title, "category": a.category, "view_count": a.view_count}
                    for a in results
                ]

        return []

    except Exception:
        # 트랜잭션 abort 상태 해제 후 LIKE 폴백 실행
        db.rollback()
        # LIKE 폴백 — MED-04: LIKE 메타문자 이스케이프
        _q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{_q}%"
        results = (
            db.query(KBArticle)
            .filter(
                KBArticle.published == True,  # noqa: E712
                (KBArticle.title.ilike(like, escape="\\") | KBArticle.content.ilike(like, escape="\\")),
            )
            .order_by(KBArticle.view_count.desc())
            .limit(limit)
            .all()
        )
        return [
            {"id": a.id, "slug": a.slug, "title": a.title, "category": a.category, "view_count": a.view_count}
            for a in results
        ]


@router.post("/articles", status_code=201)
@(user_limiter.limit(LIMIT_KB_CREATE) if user_limiter else lambda f: f)
def create_article(
    request: Request,
    data: ArticleCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_pl),
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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # slug 중복 (동시 생성 race condition) → 타임스탬프 suffix 붙여 재시도
        import time
        article.slug = f"{slug}-{int(time.time())}"
        db.add(article)
        db.commit()
    db.refresh(article)
    _invalidate_kb_cache()
    _sync_kb_search_index(article.id, article.title, article.content, article.published)
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

    # 수정 전 내용 스냅샷 저장 (최근 10개만 유지)
    from ..models import KBRevision
    last_rev = (
        db.query(KBRevision)
        .filter(KBRevision.article_id == article_id)
        .order_by(KBRevision.revision_number.desc())
        .first()
    )
    next_rev_num = (last_rev.revision_number + 1) if last_rev else 1
    snapshot = KBRevision(
        article_id=article_id,
        revision_number=next_rev_num,
        title=article.title,
        content=article.content,
        category=article.category,
        tags=article.tags,
        editor_name=_user.get("name") or _user.get("username"),
    )
    db.add(snapshot)
    # 10개 초과 시 가장 오래된 것 삭제
    old_revs = (
        db.query(KBRevision)
        .filter(KBRevision.article_id == article_id)
        .order_by(KBRevision.revision_number.asc())
        .all()
    )
    if len(old_revs) >= 10:
        for old in old_revs[: len(old_revs) - 9]:
            db.delete(old)

    old_title = article.title
    article.title = data.title
    article.content = data.content
    article.category = data.category
    article.tags = data.tags  # F-8
    article.published = data.published

    if data.title != old_title:
        base_slug = _slug_from_title(data.title)
        article.slug = _ensure_unique_slug(db, base_slug, exclude_id=article_id)

    article.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(article)
    _invalidate_kb_cache()
    _sync_kb_search_index(article.id, article.title, article.content, article.published)
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
    from ..models import KBRevision
    db.query(KBRevision).filter(KBRevision.article_id == article_id).delete(synchronize_session=False)
    db.delete(article)
    db.commit()
    _invalidate_kb_cache()


@router.get("/articles/{article_id}/revisions")
def get_article_revisions(
    article_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_pl),
):
    """KB 문서 수정 이력 목록 반환 (최근 10개, 본문 미포함)."""
    from ..models import KBRevision
    revisions = (
        db.query(KBRevision)
        .filter(KBRevision.article_id == article_id)
        .order_by(KBRevision.revision_number.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": r.id,
            "revision_number": r.revision_number,
            "title": r.title,
            "category": r.category,
            "editor_name": r.editor_name,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in revisions
    ]


@router.get("/articles/{article_id}/revisions/{revision_id}")
def get_article_revision_detail(
    article_id: int,
    revision_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_pl),
):
    """특정 버전의 전체 내용 반환 (본문 포함)."""
    from ..models import KBRevision
    rev = db.query(KBRevision).filter(
        KBRevision.id == revision_id,
        KBRevision.article_id == article_id,
    ).first()
    if not rev:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다.")
    return {
        "id": rev.id,
        "article_id": rev.article_id,
        "revision_number": rev.revision_number,
        "title": rev.title,
        "content": rev.content,
        "category": rev.category,
        "tags": rev.tags,
        "editor_name": rev.editor_name,
        "created_at": rev.created_at.isoformat() if rev.created_at else None,
    }


@router.post("/articles/{article_id}/revisions/{revision_id}/restore")
def restore_article_revision(
    article_id: int,
    revision_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_pl),
):
    """특정 버전으로 아티클 내용을 복원한다."""
    from ..models import KBRevision
    article = db.query(KBArticle).filter(KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="아티클을 찾을 수 없습니다.")
    rev = db.query(KBRevision).filter(
        KBRevision.id == revision_id,
        KBRevision.article_id == article_id,
    ).first()
    if not rev:
        raise HTTPException(status_code=404, detail="이력을 찾을 수 없습니다.")

    # 복원 전 현재 내용을 새 리비전으로 저장
    last_rev = (
        db.query(KBRevision)
        .filter(KBRevision.article_id == article_id)
        .order_by(KBRevision.revision_number.desc())
        .first()
    )
    next_rev_num = (last_rev.revision_number + 1) if last_rev else 1
    db.add(KBRevision(
        article_id=article_id,
        revision_number=next_rev_num,
        title=article.title,
        content=article.content,
        category=article.category,
        tags=article.tags,
        editor_name=user.get("name") or user.get("username", ""),
        change_summary=f"버전 {rev.revision_number}으로 복원 전 자동 저장",
    ))

    article.title = rev.title
    article.content = rev.content
    article.category = rev.category
    article.tags = rev.tags
    article.updated_at = datetime.now(timezone.utc)
    db.commit()
    _invalidate_kb_cache()
    return {"ok": True, "restored_revision": rev.revision_number}


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
    article.updated_at = datetime.now(timezone.utc)
    db.commit()
    _invalidate_kb_cache()
    _sync_kb_search_index(article.id, article.title, article.content, article.published)
    return {"id": article.id, "published": article.published}


@router.post("/articles/upload", response_model=dict)
@(user_limiter.limit(LIMIT_UPLOAD) if user_limiter else lambda f: f)
async def upload_kb_attachment(
    request: Request,
    file: UploadFile = File(...),
    project_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _user: dict = Depends(require_pl),
):
    """KB 아티클용 파일 첨부 업로드.

    티켓 첨부와 동일한 보안 검증(MIME + magic bytes)을 적용한다.
    GitLab 프로젝트에 업로드하고 마크다운 삽입 문자열을 반환한다.
    """
    # 티켓 라우터의 검증 로직 재사용
    from .tickets.helpers import (
        MAX_FILE_SIZE,
        ALLOWED_MIME_TYPES,
        _validate_magic_bytes,
        _strip_image_metadata,
    )
    from ..clamav import scan_bytes as _clam_scan
    from ..audit import write_audit_log
    from .. import gitlab_client

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="파일 크기는 10MB를 초과할 수 없습니다.")

    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="허용되지 않는 파일 형식입니다.")

    _validate_magic_bytes(content, mime)
    # 이미지 EXIF 메타데이터 제거
    content = _strip_image_metadata(content, mime)
    # ClamAV 바이러스 스캔
    fname = file.filename or "file"
    is_safe, detail = _clam_scan(content, fname)
    if not is_safe:
        write_audit_log(
            db, _user, "kb.upload.infected", "kb_file", fname,
            new_value={"virus": detail, "filename": fname},
            request=request,
        )
        raise HTTPException(
            status_code=422,
            detail=f"파일에서 악성코드가 감지되었습니다: {detail}",
        )

    # MinIO 우선 업로드 시도, 미설정 또는 실패 시 GitLab 폴백
    from .. import storage as _storage
    minio_result = _storage.upload_file(content, file.filename or "file", mime)
    if minio_result:
        return {
            "markdown": f"![{file.filename}]({minio_result['url']})" if mime.startswith("image/") else f"[{file.filename}]({minio_result['url']})",
            "url": minio_result["url"],
            "full_path": minio_result["url"],
            "proxy_path": minio_result["url"],
            "name": file.filename,
            "size": len(content),
            "mime": mime,
            "storage": "minio",
        }

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
            "storage": "gitlab",
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
