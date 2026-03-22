"""Tests for /admin/export and /admin/import endpoints (data_export.py)."""
import io
import json


# ── export ────────────────────────────────────────────────────────────────────

def test_export_unknown_target_400(client, admin_cookies):
    resp = client.get("/admin/export/unknown-target", cookies=admin_cookies)
    assert resp.status_code == 400


def test_export_requires_admin(client, user_cookies):
    resp = client.get("/admin/export/quick-replies", cookies=user_cookies)
    assert resp.status_code == 403


def test_export_quick_replies_json_empty(client, admin_cookies):
    resp = client.get("/admin/export/quick-replies?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["target"] == "quick-replies"
    assert data["count"] == 0
    assert data["data"] == []


def test_export_assignment_rules_json_empty(client, admin_cookies):
    resp = client.get("/admin/export/assignment-rules?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200
    assert resp.json()["target"] == "assignment-rules"


def test_export_sla_policies_json(client, admin_cookies):
    resp = client.get("/admin/export/sla-policies?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200


def test_export_announcements_json(client, admin_cookies):
    resp = client.get("/admin/export/announcements?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200


def test_export_escalation_policies_json(client, admin_cookies):
    resp = client.get("/admin/export/escalation-policies?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200


def test_export_quick_replies_csv_empty(client, admin_cookies):
    resp = client.get("/admin/export/quick-replies?fmt=csv", cookies=admin_cookies)
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]


def test_export_csv_with_data(client, admin_cookies, db_session):
    from app.models import QuickReply

    qr = QuickReply(name="빠른답변", content="내용", category="일반", created_by="admin")
    db_session.add(qr)
    db_session.commit()

    resp = client.get("/admin/export/quick-replies?fmt=csv", cookies=admin_cookies)
    assert resp.status_code == 200
    content = resp.content.decode("utf-8-sig")
    assert "name" in content
    assert "빠른답변" in content


def test_export_json_with_data(client, admin_cookies, db_session):
    from app.models import QuickReply

    qr = QuickReply(name="테스트답변", content="내용2", category="일반", created_by="admin")
    db_session.add(qr)
    db_session.commit()

    resp = client.get("/admin/export/quick-replies?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    names = [r["name"] for r in data["data"]]
    assert "테스트답변" in names


# ── import ────────────────────────────────────────────────────────────────────

def test_import_unknown_target_400(client, admin_cookies):
    f = io.BytesIO(b'[]')
    resp = client.post(
        "/admin/import/unknown-target",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_non_json_file_400(client, admin_cookies):
    f = io.BytesIO(b"col1,col2\nval1,val2")
    resp = client.post(
        "/admin/import/quick-replies",
        files={"file": ("data.csv", f, "text/csv")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_invalid_json_400(client, admin_cookies):
    f = io.BytesIO(b"not valid json {{{")
    resp = client.post(
        "/admin/import/quick-replies",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_wrong_payload_type_400(client, admin_cookies):
    """Payload that is neither list nor dict with 'data' key."""
    f = io.BytesIO(json.dumps("just a string").encode())
    resp = client.post(
        "/admin/import/quick-replies",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_announcements_append_from_list(client, admin_cookies):
    """Import announcements from a list payload (lines 153-161, 193-213)."""
    rows = [{"title": "임포트공지", "content": "내용", "type": "info"}]
    f = io.BytesIO(json.dumps(rows).encode())
    resp = client.post(
        "/admin/import/announcements?mode=append",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["imported"] >= 1
    assert data["target"] == "announcements"


def test_import_announcements_from_dict_with_data_key(client, admin_cookies):
    """Import from {data: [...]} wrapper (lines 151-152)."""
    payload = {"target": "announcements", "data": [
        {"title": "임포트공지2", "content": "내용2", "type": "warning"}
    ]}
    f = io.BytesIO(json.dumps(payload).encode())
    resp = client.post(
        "/admin/import/announcements?mode=append",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    assert resp.json()["imported"] >= 1


def test_import_replace_mode(client, admin_cookies, db_session):
    from app.models import Announcement

    # Pre-populate
    db_session.add(Announcement(title="기존공지", content="본문", type="info", created_by="admin"))
    db_session.commit()

    rows = [{"title": "교체공지", "content": "새본문", "type": "info"}]
    f = io.BytesIO(json.dumps(rows).encode())
    resp = client.post(
        "/admin/import/announcements?mode=replace",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    assert resp.json()["mode"] == "replace"


def test_import_skips_non_dict_rows(client, admin_cookies):
    rows = ["not-a-dict", {"title": "valid", "content": "c", "type": "info"}, 123]
    f = io.BytesIO(json.dumps(rows).encode())
    resp = client.post(
        "/admin/import/announcements?mode=append",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["skipped"] >= 2  # non-dict rows skipped


def test_import_skips_rows_with_no_writable_fields(client, admin_cookies):
    rows = [{"id": 999, "created_at": "2024-01-01"}]  # only readonly fields
    f = io.BytesIO(json.dumps(rows).encode())
    resp = client.post(
        "/admin/import/announcements?mode=append",
        files={"file": ("data.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    assert resp.json()["skipped"] >= 1


def test_import_requires_admin(client, user_cookies):
    f = io.BytesIO(b'[]')
    resp = client.post(
        "/admin/import/quick-replies",
        files={"file": ("data.json", f, "application/json")},
        cookies=user_cookies,
    )
    assert resp.status_code == 403


def test_telemetry_import_path_not_registered(client, admin_cookies):
    """Verify that /admin/export route is mounted under /admin."""
    resp = client.get("/admin/export/quick-replies?fmt=json", cookies=admin_cookies)
    assert resp.status_code == 200


def test_import_file_too_large(client, admin_cookies):
    """File > 10MB → 400 (line 144)."""
    big = b"x" * (10 * 1024 * 1024 + 1)
    f = io.BytesIO(big)
    resp = client.post(
        "/admin/import/quick-replies?mode=append",
        files={"file": ("big.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_data_not_list(client, admin_cookies):
    """data field is not a list → 400 (line 159)."""
    payload = json.dumps({"data": "not-a-list"})
    f = io.BytesIO(payload.encode())
    resp = client.post(
        "/admin/import/quick-replies?mode=append",
        files={"file": ("bad.json", f, "application/json")},
        cookies=admin_cookies,
    )
    assert resp.status_code == 400


def test_import_row_db_exception_skipped(client, admin_cookies):
    """DB exception during row import → row skipped (lines 208-211)."""
    from unittest.mock import patch
    rows = [{"reply": "안녕하세요", "category": "일반"}]
    f = io.BytesIO(json.dumps(rows).encode())
    with patch("sqlalchemy.orm.session.Session.add", side_effect=Exception("DB error")):
        resp = client.post(
            "/admin/import/quick-replies?mode=append",
            files={"file": ("data.json", f, "application/json")},
            cookies=admin_cookies,
        )
    assert resp.status_code == 201
    assert resp.json()["skipped"] >= 1
