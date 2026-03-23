"""Targeted coverage tests for app/routers/templates.py missing lines:
  134-138: get_ticket_links (link_router) — list links for a ticket
  148-162: create_ticket_link (link_router) — valid link creation
  172-176: delete_ticket_link (link_router) — 404 when not found
  180:     _link_to_dict helper (covered via above)
"""
import pytest
from unittest.mock import MagicMock

from app.models import TicketLink
from app.routers.templates import (
    get_ticket_links,
    create_ticket_link,
    delete_ticket_link,
    _link_to_dict,
    LinkCreate,
)


def _make_link(db, source_iid=1, target_iid=2, project_id="1", link_type="related"):
    lk = TicketLink(
        source_iid=source_iid,
        target_iid=target_iid,
        project_id=project_id,
        link_type=link_type,
        created_by="42",
    )
    db.add(lk)
    db.commit()
    db.refresh(lk)
    return lk


# ---------------------------------------------------------------------------
# Lines 134-138 — get_ticket_links (direct function call)
# ---------------------------------------------------------------------------

class TestGetTicketLinks:
    def test_returns_empty_list_when_no_links(self, db_session):
        """Lines 134-138: get_ticket_links returns empty list when no links exist."""
        user = {"sub": "42", "role": "user"}
        result = get_ticket_links(iid=1, project_id="1", db=db_session, _user=user)
        assert result == []

    def test_returns_links_for_ticket(self, db_session):
        """get_ticket_links returns all links for a given source_iid and project_id."""
        _make_link(db_session, source_iid=10, target_iid=20, project_id="1", link_type="related")
        _make_link(db_session, source_iid=10, target_iid=30, project_id="1", link_type="blocks")

        user = {"sub": "42", "role": "user"}
        result = get_ticket_links(iid=10, project_id="1", db=db_session, _user=user)
        assert len(result) == 2

    def test_filters_by_project_id(self, db_session):
        """get_ticket_links filters by project_id correctly."""
        _make_link(db_session, source_iid=5, target_iid=6, project_id="1", link_type="related")
        _make_link(db_session, source_iid=5, target_iid=7, project_id="2", link_type="related")

        user = {"sub": "42", "role": "user"}
        result = get_ticket_links(iid=5, project_id="1", db=db_session, _user=user)
        assert len(result) == 1
        assert result[0]["target_iid"] == 6

    def test_link_dict_structure(self, db_session):
        """_link_to_dict (line 180) returns all expected fields."""
        _make_link(db_session, source_iid=15, target_iid=16, project_id="1", link_type="duplicate_of")

        user = {"sub": "42", "role": "user"}
        result = get_ticket_links(iid=15, project_id="1", db=db_session, _user=user)
        assert len(result) == 1
        link = result[0]
        for field in ("id", "source_iid", "target_iid", "project_id", "link_type", "created_by", "created_at"):
            assert field in link


# ---------------------------------------------------------------------------
# Lines 148-162 — create_ticket_link (direct function call)
# ---------------------------------------------------------------------------

class TestCreateTicketLink:
    def test_create_valid_link_related(self, db_session):
        """Lines 152-162: create_ticket_link creates a link with 'related' type."""
        data = LinkCreate(target_iid=200, project_id="1", link_type="related")
        user = {"sub": "42", "role": "agent"}
        result = create_ticket_link(iid=100, data=data, db=db_session, user=user)

        assert result["source_iid"] == 100
        assert result["target_iid"] == 200
        assert result["link_type"] == "related"
        assert result["created_by"] == "42"

    def test_create_link_blocks_type(self, db_session):
        """create_ticket_link works for 'blocks' link type."""
        data = LinkCreate(target_iid=201, project_id="1", link_type="blocks")
        user = {"sub": "42", "role": "agent"}
        result = create_ticket_link(iid=101, data=data, db=db_session, user=user)
        assert result["link_type"] == "blocks"

    def test_create_link_duplicate_of_type(self, db_session):
        """create_ticket_link works for 'duplicate_of' link type."""
        data = LinkCreate(target_iid=202, project_id="1", link_type="duplicate_of")
        user = {"sub": "42", "role": "agent"}
        result = create_ticket_link(iid=102, data=data, db=db_session, user=user)
        assert result["link_type"] == "duplicate_of"

    def test_create_link_problem_of_type(self, db_session):
        """create_ticket_link works for 'problem_of' link type."""
        data = LinkCreate(target_iid=203, project_id="1", link_type="problem_of")
        user = {"sub": "42", "role": "agent"}
        result = create_ticket_link(iid=103, data=data, db=db_session, user=user)
        assert result["link_type"] == "problem_of"

    def test_create_link_invalid_type_raises_400(self, db_session):
        """Lines 148-150: Raises 400 HTTPException when link_type is not in allowed set."""
        from fastapi import HTTPException
        data = LinkCreate(target_iid=204, project_id="1", link_type="invalid_type")
        user = {"sub": "42", "role": "agent"}
        with pytest.raises(HTTPException) as exc_info:
            create_ticket_link(iid=104, data=data, db=db_session, user=user)
        assert exc_info.value.status_code == 400
        assert "허용된 링크 유형" in str(exc_info.value.detail)


# ---------------------------------------------------------------------------
# Lines 172-176 — delete_ticket_link (direct function call)
# ---------------------------------------------------------------------------

class TestDeleteTicketLink:
    def test_delete_existing_link(self, db_session):
        """delete_ticket_link removes an existing link successfully."""
        lk = _make_link(db_session, source_iid=50, target_iid=51, project_id="1")
        user = {"sub": "42", "role": "agent"}

        # Should not raise
        delete_ticket_link(iid=50, link_id=lk.id, db=db_session, _user=user)

        remaining = db_session.query(TicketLink).filter(TicketLink.id == lk.id).first()
        assert remaining is None

    def test_delete_nonexistent_link_raises_404(self, db_session):
        """Lines 172-174: Raises 404 HTTPException when link doesn't exist."""
        from fastapi import HTTPException
        user = {"sub": "42", "role": "agent"}
        with pytest.raises(HTTPException) as exc_info:
            delete_ticket_link(iid=50, link_id=99999, db=db_session, _user=user)
        assert exc_info.value.status_code == 404
        assert "링크를 찾을 수 없습니다" in str(exc_info.value.detail)

    def test_delete_link_wrong_source_iid_raises_404(self, db_session):
        """Returns 404 when link_id exists but source_iid doesn't match."""
        from fastapi import HTTPException
        lk = _make_link(db_session, source_iid=60, target_iid=61, project_id="1")
        user = {"sub": "42", "role": "agent"}

        with pytest.raises(HTTPException) as exc_info:
            delete_ticket_link(iid=999, link_id=lk.id, db=db_session, _user=user)
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# _link_to_dict helper directly
# ---------------------------------------------------------------------------

class TestLinkToDict:
    def test_link_to_dict_with_created_at(self, db_session):
        """_link_to_dict formats created_at as isoformat when present."""
        lk = _make_link(db_session, source_iid=70, target_iid=71)
        result = _link_to_dict(lk)
        assert result["id"] == lk.id
        assert result["source_iid"] == 70
        assert result["target_iid"] == 71
        # created_at may be None in SQLite or a datetime
        if lk.created_at:
            assert isinstance(result["created_at"], str)
        else:
            assert result["created_at"] is None
