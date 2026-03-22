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
