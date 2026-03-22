"""Tickets router — combines all sub-module routers."""
from fastapi import APIRouter

router = APIRouter(prefix="/tickets", tags=["tickets"])

# ---------------------------------------------------------------------------
# Sub-module routers
# ---------------------------------------------------------------------------
from .search import search_router
from .export import export_router
from .bulk import bulk_router
from .crud import crud_router
from .comments import comments_router
from .stream import stream_router
from .custom_fields import custom_fields_router
from .resolution import resolution_router
from .links import links_router

router.include_router(search_router)
router.include_router(export_router)
router.include_router(bulk_router)
router.include_router(crud_router)
router.include_router(comments_router)
router.include_router(stream_router)
router.include_router(custom_fields_router)
router.include_router(resolution_router)
router.include_router(links_router)

# ---------------------------------------------------------------------------
# 하위 호환 재수출 — 기존 테스트 mock 경로("app.routers.tickets.*") 유지
# ---------------------------------------------------------------------------
from .helpers import (  # noqa: F401, E402
    _validate_magic_bytes,
    _strip_image_metadata,
    _scan_with_clamav,
    _sla_to_dict,
    _sanitize_comment,
    _parse_labels,
    _extract_meta,
    _dispatch_notification,
    _invalidate_ticket_list_cache,
    _detect_mime_from_bytes,
    _issue_to_response,
    _is_issue_assigned_to_user,
    _get_issue_requester,
    _can_requester_modify,
)
from ...config import get_settings  # noqa: F401, E402
from ...redis_client import get_redis as _get_redis  # noqa: F401, E402
from ...notifications import create_db_notification  # noqa: F401, E402
from ... import sla as sla_module  # noqa: F401, E402
from ...models import SLARecord, AuditLog  # noqa: F401, E402
