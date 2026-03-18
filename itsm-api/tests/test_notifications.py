"""
Tests for notification link validation (LOW-06) and notification listing.
"""


# ── notification link validator (LOW-06) — unit test ─────────────────────────

def test_validate_notification_link_relative_path_accepted():
    from app.notifications import _validate_notification_link
    assert _validate_notification_link("/tickets/1") == "/tickets/1"
    assert _validate_notification_link("/admin/users") == "/admin/users"


def test_validate_notification_link_absolute_url_rejected():
    from app.notifications import _validate_notification_link
    assert _validate_notification_link("http://evil.com/phish") is None
    assert _validate_notification_link("https://attacker.io") is None


def test_validate_notification_link_double_slash_rejected():
    from app.notifications import _validate_notification_link
    assert _validate_notification_link("//example.com") is None


def test_validate_notification_link_crlf_rejected():
    from app.notifications import _validate_notification_link
    assert _validate_notification_link("/tickets/1\r\nSet-Cookie: bad=1") is None
    assert _validate_notification_link("/tickets/1\nXSS") is None


def test_validate_notification_link_none_passthrough():
    from app.notifications import _validate_notification_link
    assert _validate_notification_link(None) is None


# ── /notifications list ───────────────────────────────────────────────────────

def test_list_notifications_requires_auth(client):
    resp = client.get("/notifications/")
    assert resp.status_code == 401


def test_list_notifications_authenticated(client, user_cookies):
    resp = client.get("/notifications/", cookies=user_cookies)
    assert resp.status_code == 200
    data = resp.json()
    # Response is {"unread_count": N, "notifications": [...]}
    assert "unread_count" in data
    assert "notifications" in data


def test_mark_all_read_requires_auth(client):
    """PATCH /notifications/read-all requires auth."""
    resp = client.patch("/notifications/read-all")
    assert resp.status_code == 401


def test_mark_all_read(client, user_cookies):
    resp = client.patch("/notifications/read-all", cookies=user_cookies)
    assert resp.status_code in (200, 204)
