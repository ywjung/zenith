"""Tests for /tickets/{iid}/custom-fields endpoints."""
from app.models import CustomFieldDef


def _create_field(client, admin_cookies, field_type="text", name="test_field", label="테스트 필드", options=None):
    """Helper: create a CustomFieldDef via admin API."""
    payload = {
        "name": name,
        "label": label,
        "field_type": field_type,
        "required": False,
        "sort_order": 0,
        "enabled": True,
    }
    if options:
        payload["options"] = options
    return client.post("/admin/custom-fields", json=payload, cookies=admin_cookies)


def test_get_custom_fields_requires_auth(client):
    resp = client.get("/tickets/1/custom-fields")
    assert resp.status_code == 401


def test_get_custom_fields_empty(client, user_cookies):
    resp = client.get("/tickets/1/custom-fields", cookies=user_cookies)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_custom_field_definition(client, admin_cookies):
    resp = _create_field(client, admin_cookies)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "test_field"
    assert data["field_type"] == "text"


def test_get_custom_fields_returns_definition(client, admin_cookies, user_cookies):
    _create_field(client, admin_cookies)
    resp = client.get("/tickets/1/custom-fields", cookies=user_cookies)
    assert resp.status_code == 200
    fields = resp.json()
    assert len(fields) >= 1
    assert fields[0]["name"] == "test_field"
    assert fields[0]["value"] is None


def test_set_custom_fields_text(client, admin_cookies):
    create = _create_field(client, admin_cookies, name="my_field", label="내 필드")
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/1/custom-fields",
        json={str(fid): "hello"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    # Verify value was saved
    result = client.get("/tickets/1/custom-fields", cookies=admin_cookies)
    saved = next((f for f in result.json() if f["id"] == fid), None)
    assert saved["value"] == "hello"


def test_set_custom_fields_update_existing(client, admin_cookies):
    create = _create_field(client, admin_cookies, name="upd_field", label="업데이트 필드")
    fid = create.json()["id"]
    client.put("/tickets/2/custom-fields", json={str(fid): "initial"}, cookies=admin_cookies)
    client.put("/tickets/2/custom-fields", json={str(fid): "updated"}, cookies=admin_cookies)
    result = client.get("/tickets/2/custom-fields", cookies=admin_cookies)
    saved = next((f for f in result.json() if f["id"] == fid), None)
    assert saved["value"] == "updated"


def test_set_custom_fields_number_invalid(client, admin_cookies):
    create = _create_field(client, admin_cookies, name="num_field", label="숫자 필드", field_type="number")
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/1/custom-fields",
        json={str(fid): "not-a-number"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_set_custom_fields_select_invalid_option(client, admin_cookies):
    create = _create_field(
        client, admin_cookies, name="sel_field", label="선택 필드",
        field_type="select", options=["opt1", "opt2"]
    )
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/1/custom-fields",
        json={str(fid): "invalid_option"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_set_custom_fields_select_valid_option(client, admin_cookies):
    create = _create_field(
        client, admin_cookies, name="sel_ok_field", label="선택 필드 OK",
        field_type="select", options=["opt1", "opt2"]
    )
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/3/custom-fields",
        json={str(fid): "opt1"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


def test_set_custom_fields_unknown_field_ignored(client, admin_cookies):
    resp = client.put(
        "/tickets/1/custom-fields",
        json={"99999": "value"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


def test_set_custom_fields_non_integer_key_ignored(client, admin_cookies):
    """Non-integer field_id is silently skipped (lines 73-74)."""
    resp = client.put(
        "/tickets/1/custom-fields",
        json={"not_an_int": "value"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


def test_set_custom_fields_checkbox_invalid(client, admin_cookies):
    """Checkbox field with invalid value returns 400 (lines 86-87)."""
    create = _create_field(
        client, admin_cookies, name="chk_field", label="체크박스 필드",
        field_type="checkbox"
    )
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/1/custom-fields",
        json={str(fid): "not-a-bool"},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_set_custom_fields_checkbox_valid(client, admin_cookies):
    """Checkbox field with valid bool value succeeds."""
    create = _create_field(
        client, admin_cookies, name="chk_ok_field", label="체크박스 OK",
        field_type="checkbox"
    )
    fid = create.json()["id"]
    resp = client.put(
        "/tickets/5/custom-fields",
        json={str(fid): True},
        cookies=admin_cookies,
    )
    assert resp.status_code == 200


# ─── Direct function-level unit tests (routes are shadowed by admin/__init__.py) ──────

from unittest.mock import MagicMock, patch
from fastapi import HTTPException
import pytest

from app.routers.custom_fields import (
    _field_to_dict,
    FieldCreate,
    FieldUpdate,
    list_fields,
    create_field,
    update_field,
    delete_field,
    get_ticket_custom_fields,
    set_ticket_custom_fields,
)
from app.models import CustomFieldDef, TicketCustomValue


def _make_field_obj(
    id_=1, name="f1", label="F1", field_type="text",
    options=None, required=False, enabled=True, sort_order=0,
    created_by="admin", created_at=None,
):
    f = MagicMock(spec=CustomFieldDef)
    f.id = id_
    f.name = name
    f.label = label
    f.field_type = field_type
    f.options = options
    f.required = required
    f.enabled = enabled
    f.sort_order = sort_order
    f.created_by = created_by
    f.created_at = created_at
    return f


# ─── _field_to_dict ─────────────────────────────────────────────────────────

def test_field_to_dict_basic():
    f = _make_field_obj()
    d = _field_to_dict(f)
    assert d["name"] == "f1"
    assert d["options"] == []
    assert d["created_at"] is None


def test_field_to_dict_with_datetime():
    from datetime import datetime
    dt = datetime(2025, 1, 1, 12, 0, 0)
    f = _make_field_obj(created_at=dt)
    d = _field_to_dict(f)
    assert "2025-01-01" in d["created_at"]


# ─── FieldCreate validator ────────────────────────────────────────────────────

def test_field_create_invalid_name_raises():
    with pytest.raises(Exception):
        FieldCreate(name="Bad Name!", label="L", field_type="text")


def test_field_create_invalid_type_raises():
    with pytest.raises(Exception):
        FieldCreate(name="goodname", label="L", field_type="wrong")


def test_field_update_invalid_type_raises():
    with pytest.raises(Exception):
        FieldUpdate(field_type="nope")


def test_field_update_valid_none_type():
    fu = FieldUpdate(field_type=None)
    assert fu.field_type is None


# ─── list_fields ─────────────────────────────────────────────────────────────

def test_list_fields_enabled_only(db_session):
    f1 = CustomFieldDef(name="aa", label="AA", field_type="text", enabled=True, sort_order=0, created_by="admin")
    f2 = CustomFieldDef(name="bb", label="BB", field_type="text", enabled=False, sort_order=0, created_by="admin")
    db_session.add_all([f1, f2])
    db_session.commit()
    result = list_fields(include_disabled=False, db=db_session, _user={})
    names = [r["name"] for r in result]
    assert "aa" in names
    assert "bb" not in names


def test_list_fields_include_disabled(db_session):
    f1 = CustomFieldDef(name="cc", label="CC", field_type="text", enabled=False, sort_order=0, created_by="admin")
    db_session.add(f1)
    db_session.commit()
    result = list_fields(include_disabled=True, db=db_session, _user={})
    names = [r["name"] for r in result]
    assert "cc" in names


# ─── create_field ─────────────────────────────────────────────────────────────

def test_create_field_success(db_session):
    body = FieldCreate(name="newfield", label="New", field_type="text")
    user = {"username": "admin"}
    result = create_field(body=body, db=db_session, user=user)
    assert result["name"] == "newfield"
    assert result["created_by"] == "admin"


def test_create_field_conflict(db_session):
    db_session.add(CustomFieldDef(name="dup", label="D", field_type="text", enabled=True, sort_order=0, created_by="admin"))
    db_session.commit()
    body = FieldCreate(name="dup", label="Dup2", field_type="text")
    with pytest.raises(HTTPException) as exc:
        create_field(body=body, db=db_session, user={"username": "admin"})
    assert exc.value.status_code == 409


# ─── update_field ─────────────────────────────────────────────────────────────

def test_update_field_not_found(db_session):
    body = FieldUpdate(label="New label")
    with pytest.raises(HTTPException) as exc:
        update_field(field_id=9999, body=body, db=db_session, _user={})
    assert exc.value.status_code == 404


def test_update_field_success(db_session):
    f = CustomFieldDef(name="upd", label="Old", field_type="text", enabled=True, sort_order=0, created_by="admin")
    db_session.add(f)
    db_session.commit()
    body = FieldUpdate(label="Updated")
    result = update_field(field_id=f.id, body=body, db=db_session, _user={})
    assert result["label"] == "Updated"


# ─── delete_field ─────────────────────────────────────────────────────────────

def test_delete_field_not_found(db_session):
    with pytest.raises(HTTPException) as exc:
        delete_field(field_id=9999, db=db_session, _user={})
    assert exc.value.status_code == 404


def test_delete_field_success(db_session):
    f = CustomFieldDef(name="del", label="Del", field_type="text", enabled=True, sort_order=0, created_by="admin")
    db_session.add(f)
    db_session.commit()
    delete_field(field_id=f.id, db=db_session, _user={})
    assert db_session.query(CustomFieldDef).filter(CustomFieldDef.id == f.id).first() is None


# ─── get_ticket_custom_fields ─────────────────────────────────────────────────

def test_get_ticket_custom_fields_empty(db_session):
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = 1
        result = get_ticket_custom_fields(iid=1, project_id=None, db=db_session, _user={})
    assert result == []


def test_get_ticket_custom_fields_with_value(db_session):
    f = CustomFieldDef(name="cf1", label="CF1", field_type="text", enabled=True, sort_order=0, created_by="admin")
    db_session.add(f)
    db_session.commit()
    val = TicketCustomValue(gitlab_issue_iid=5, project_id="1", field_id=f.id, value="myval")
    db_session.add(val)
    db_session.commit()
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = 1
        result = get_ticket_custom_fields(iid=5, project_id="1", db=db_session, _user={})
    assert len(result) == 1
    assert result[0]["value"] == "myval"


# ─── set_ticket_custom_fields ─────────────────────────────────────────────────

def test_set_ticket_custom_fields_unknown_field(db_session):
    """Unknown field names are silently skipped."""
    with patch("app.config.get_settings") as mock_cfg:
        mock_cfg.return_value.GITLAB_PROJECT_ID = 1
        result = set_ticket_custom_fields(iid=1, values={"nonexistent": "val"}, project_id="1", db=db_session, _user={})
    assert result == []


def test_set_ticket_custom_fields_commit_error():
    """Commit errors are caught and re-raised as 500."""
    mock_field = MagicMock()
    mock_field.name = "ce_field"
    mock_field.id = 1

    mock_db = MagicMock()
    # active_fields query chain: db.query(...).filter(...).all()
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_field]
    # db.execute succeeds
    mock_db.execute.return_value = None
    # db.commit fails → should trigger rollback + 500
    mock_db.commit.side_effect = Exception("commit failed")

    mock_stmt = MagicMock()
    mock_stmt.values.return_value.on_conflict_do_update.return_value = mock_stmt

    with (
        patch("app.config.get_settings") as mock_cfg,
        patch("app.routers.custom_fields.pg_insert", return_value=mock_stmt),
    ):
        mock_cfg.return_value.GITLAB_PROJECT_ID = 1
        with pytest.raises(HTTPException) as exc:
            set_ticket_custom_fields(iid=1, values={"ce_field": "v"}, project_id="1", db=mock_db, _user={})
        assert exc.value.status_code == 500
        mock_db.rollback.assert_called_once()
