"""Coverage tests for app/routers/tickets/export.py.

Target lines:
  - export_tickets_csv: state branching (closed / other / all), category/priority filters
  - export_tickets_xlsx: openpyxl ImportError (107-108), state/category/priority branches
  - import_tickets_csv: missing columns (210-212), >500 rows (215-216),
    dry_run (238-240), actual create (242-263)
"""
import csv
import io
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Shared fake data
# ---------------------------------------------------------------------------

FAKE_ISSUE = {
    "iid": 1,
    "title": "테스트 티켓",
    "description": "**신청자:** 홍길동\n**이메일:** hong@example.com\n---\n내용",
    "state": "opened",
    "labels": ["cat::network", "prio::medium", "status::open"],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z",
    "web_url": "http://gitlab/issues/1",
    "author": {"id": 1, "username": "hong", "name": "홍길동"},
    "assignees": [],
    "assignee": None,
    "project_id": "1",
    "milestone": None,
}


def _csv_content(rows: list[dict], extra_cols: list[str] | None = None) -> bytes:
    """Build a CSV file bytes from a list of row dicts."""
    required = ["title", "description", "category", "priority", "employee_name", "employee_email"]
    fieldnames = required + (extra_cols or [])
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# export_tickets_csv — state branching
# ---------------------------------------------------------------------------

class TestExportCsv:
    def test_export_csv_no_filters_returns_200(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]):
            resp = client.get("/tickets/export/csv", cookies=admin_cookies)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    def test_export_csv_state_closed(self, client, admin_cookies):
        """state=closed → gl_state='closed', no label appended."""
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/csv?state=closed", cookies=admin_cookies)
        assert resp.status_code == 200
        mock_gl.assert_called_once()
        call_kwargs = mock_gl.call_args
        assert call_kwargs.kwargs.get("state") == "closed" or call_kwargs[1].get("state") == "closed"

    def test_export_csv_state_other(self, client, admin_cookies):
        """state=in_progress → gl_state='opened', label status::in_progress appended."""
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/csv?state=in_progress", cookies=admin_cookies)
        assert resp.status_code == 200
        call_kwargs = mock_gl.call_args
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("state") == "opened"
        assert "status::in_progress" in (kwargs.get("labels") or "")

    def test_export_csv_state_all(self, client, admin_cookies):
        """state=all → gl_state='all'."""
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/csv?state=all", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert kwargs.get("state") == "all"

    def test_export_csv_category_filter(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/csv?category=network", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert "cat::network" in (kwargs.get("labels") or "")

    def test_export_csv_priority_filter(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/csv?priority=high", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert "prio::high" in (kwargs.get("labels") or "")

    def test_export_csv_combined_filters(self, client, admin_cookies):
        """state + category + priority all at once."""
        with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]) as mock_gl:
            resp = client.get(
                "/tickets/export/csv?state=in_progress&category=software&priority=critical",
                cookies=admin_cookies,
            )
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        labels = kwargs.get("labels") or ""
        assert "status::in_progress" in labels
        assert "cat::software" in labels
        assert "prio::critical" in labels

    def test_export_csv_requires_auth(self, client):
        resp = client.get("/tickets/export/csv")
        assert resp.status_code in (401, 403)

    def test_export_csv_sanitizes_injection(self, client, admin_cookies):
        """CSV formula injection should be prefixed with apostrophe."""
        evil_issue = {
            **FAKE_ISSUE,
            "title": "=SUM(A1)",
            "description": "**신청자:** =evil\n**이메일:** a@b.com\n---",
        }
        with patch("app.gitlab_client.get_all_issues", return_value=[evil_issue]):
            resp = client.get("/tickets/export/csv", cookies=admin_cookies)
        assert resp.status_code == 200
        content = resp.text
        assert "'=SUM(A1)" in content or "=SUM(A1)" not in content.split("\n")[1]


# ---------------------------------------------------------------------------
# export_tickets_xlsx — ImportError + state branches
# ---------------------------------------------------------------------------

class TestExportXlsx:
    def test_export_xlsx_openpyxl_missing_returns_501(self, client, admin_cookies):
        """When openpyxl is not importable, endpoint should return 501."""
        import builtins
        _real_import = builtins.__import__

        def _fail_openpyxl(name, *args, **kwargs):
            if name == "openpyxl":
                raise ImportError("openpyxl not found")
            return _real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=_fail_openpyxl):
            resp = client.get("/tickets/export/xlsx", cookies=admin_cookies)
        assert resp.status_code == 501

    def test_export_xlsx_success(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[FAKE_ISSUE]):
            resp = client.get("/tickets/export/xlsx", cookies=admin_cookies)
        assert resp.status_code == 200
        assert "spreadsheetml" in resp.headers["content-type"]

    def test_export_xlsx_state_closed(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/xlsx?state=closed", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert kwargs.get("state") == "closed"

    def test_export_xlsx_state_other(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/xlsx?state=waiting", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert kwargs.get("state") == "opened"

    def test_export_xlsx_state_all(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get("/tickets/export/xlsx?state=all", cookies=admin_cookies)
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        assert kwargs.get("state") == "all"

    def test_export_xlsx_category_and_priority(self, client, admin_cookies):
        with patch("app.gitlab_client.get_all_issues", return_value=[]) as mock_gl:
            resp = client.get(
                "/tickets/export/xlsx?category=hardware&priority=low", cookies=admin_cookies
            )
        assert resp.status_code == 200
        kwargs = mock_gl.call_args.kwargs if mock_gl.call_args.kwargs else mock_gl.call_args[1]
        labels = kwargs.get("labels") or ""
        assert "cat::hardware" in labels
        assert "prio::low" in labels


# ---------------------------------------------------------------------------
# import_tickets_csv
# ---------------------------------------------------------------------------

class TestImportCsv:
    def test_import_csv_missing_columns_returns_422(self, client, admin_cookies):
        """CSV without required columns → 422."""
        content = b"title,description\ntest ticket,some desc"
        resp = client.post(
            "/tickets/import/csv",
            files={"file": ("test.csv", content, "text/csv")},
            cookies=admin_cookies,
        )
        assert resp.status_code == 422
        assert "누락된 필수 컬럼" in resp.json()["detail"]

    def test_import_csv_missing_some_columns(self, client, admin_cookies):
        """Only partial required columns present → 422 listing missing ones."""
        content = b"title,description,category\nfoo,bar,baz"
        resp = client.post(
            "/tickets/import/csv",
            files={"file": ("test.csv", content, "text/csv")},
            cookies=admin_cookies,
        )
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert "priority" in detail or "employee_name" in detail or "employee_email" in detail

    def test_import_csv_too_many_rows_returns_422(self, client, admin_cookies):
        """More than 500 rows → 422."""
        rows = [
            {
                "title": f"t{i}", "description": "d", "category": "network",
                "priority": "medium", "employee_name": "홍길동", "employee_email": f"a{i}@b.com",
            }
            for i in range(501)
        ]
        content = _csv_content(rows)
        resp = client.post(
            "/tickets/import/csv",
            files={"file": ("test.csv", content, "text/csv")},
            cookies=admin_cookies,
        )
        assert resp.status_code == 422
        assert "500행" in resp.json()["detail"]

    def test_import_csv_dry_run(self, client, admin_cookies):
        """dry_run=true → no GitLab calls, returns success list."""
        rows = [
            {
                "title": "네트워크 장애 티켓", "description": "네트워크 연결이 안 됩니다",
                "category": "network", "priority": "high",
                "employee_name": "홍길동", "employee_email": "hong@ex.com",
            }
        ]
        content = _csv_content(rows)
        with patch("app.gitlab_client.create_issue") as mock_create:
            resp = client.post(
                "/tickets/import/csv?dry_run=true",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["total"] == 1
        assert len(data["success"]) == 1
        assert data["success"][0]["title"] == "네트워크 장애 티켓"
        mock_create.assert_not_called()

    def test_import_csv_dry_run_multiple_rows(self, client, admin_cookies):
        """dry_run with 3 rows → 3 success entries, no GitLab calls."""
        rows = [
            {
                "title": f"소프트웨어 티켓 {i:03d}", "description": "소프트웨어 문제가 발생했습니다",
                "category": "software", "priority": "medium",
                "employee_name": "테스트사용자", "employee_email": f"t{i}@ex.com",
            }
            for i in range(3)
        ]
        content = _csv_content(rows)
        with patch("app.gitlab_client.create_issue") as mock_create:
            resp = client.post(
                "/tickets/import/csv?dry_run=true",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        assert resp.json()["total"] == 3
        assert len(resp.json()["success"]) == 3
        mock_create.assert_not_called()

    def test_import_csv_actual_create(self, client, admin_cookies):
        """Normal import → gitlab create_issue is called once per valid row."""
        rows = [
            {
                "title": "하드웨어 교체 요청 티켓", "description": "모니터가 고장났습니다",
                "category": "hardware", "priority": "critical",
                "employee_name": "홍길동", "employee_email": "hong@ex.com",
            }
        ]
        content = _csv_content(rows)
        mock_issue = {**FAKE_ISSUE, "iid": 99, "title": "하드웨어 교체 요청 티켓"}
        with patch("app.gitlab_client.create_issue", return_value=mock_issue) as mock_create:
            resp = client.post(
                "/tickets/import/csv",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["total"] == 1
        assert data["success"][0]["iid"] == 99
        mock_create.assert_called_once()

    def test_import_csv_actual_create_with_optional_cols(self, client, admin_cookies):
        """Optional department/location columns are included in GitLab description."""
        rows = [
            {
                "title": "옵셔널 컬럼 테스트 티켓", "description": "부서 및 위치 정보 포함",
                "category": "network", "priority": "low",
                "employee_name": "김철수", "employee_email": "kim@ex.com",
                "department": "IT팀", "location": "서울",
            }
        ]
        content = _csv_content(rows, extra_cols=["department", "location"])
        mock_issue = {**FAKE_ISSUE, "iid": 55}
        with patch("app.gitlab_client.create_issue", return_value=mock_issue) as mock_create:
            resp = client.post(
                "/tickets/import/csv",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        assert resp.json()["success"][0]["iid"] == 55
        call_kwargs = mock_create.call_args.kwargs if mock_create.call_args.kwargs else mock_create.call_args[1]
        assert "IT팀" in call_kwargs.get("description", "")
        assert "서울" in call_kwargs.get("description", "")

    def test_import_csv_create_failure_goes_to_failed(self, client, admin_cookies):
        """When gitlab create_issue raises, row goes to failed list."""
        rows = [
            {
                "title": "GitLab 실패 테스트 티켓", "description": "이 티켓은 생성에 실패합니다",
                "category": "other", "priority": "medium",
                "employee_name": "이영희", "employee_email": "lee@ex.com",
            }
        ]
        content = _csv_content(rows)
        with patch("app.gitlab_client.create_issue", side_effect=Exception("GitLab down")):
            resp = client.post(
                "/tickets/import/csv",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["total"] == 1
        assert len(data["failed"]) == 1
        assert data["failed"][0]["row"] == 2

    def test_import_csv_mixed_success_and_failure(self, client, admin_cookies):
        """Two rows, second one fails validation (empty title)."""
        rows = [
            {
                "title": "정상적인 티켓 제목입니다", "description": "정상적인 설명 내용입니다",
                "category": "network", "priority": "medium",
                "employee_name": "홍길동", "employee_email": "hong@ex.com",
            },
            {
                "title": "", "description": "설명이 있어도 제목이 없으면 실패",
                "category": "network", "priority": "medium",
                "employee_name": "홍길동", "employee_email": "hong@ex.com",
            },
        ]
        content = _csv_content(rows)
        mock_issue = {**FAKE_ISSUE, "iid": 10}
        with patch("app.gitlab_client.create_issue", return_value=mock_issue):
            resp = client.post(
                "/tickets/import/csv",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["total"] == 2

    def test_import_csv_cp949_encoding(self, client, admin_cookies):
        """CP949 encoded file should decode without error."""
        required = "title,description,category,priority,employee_name,employee_email\n"
        row = "CP949 인코딩 테스트,한글 설명 내용 테스트입니다,network,medium,홍길동,hong@ex.com\n"
        content = (required + row).encode("cp949")
        mock_issue = {**FAKE_ISSUE, "iid": 77}
        with patch("app.gitlab_client.create_issue", return_value=mock_issue):
            resp = client.post(
                "/tickets/import/csv?dry_run=true",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201

    def test_import_csv_with_project_id_param(self, client, admin_cookies):
        """project_id query param is passed through to gitlab."""
        rows = [
            {
                "title": "프로젝트 ID 파라미터 테스트", "description": "project_id 파라미터 전달 테스트",
                "category": "network", "priority": "medium",
                "employee_name": "홍길동", "employee_email": "hong@ex.com",
            }
        ]
        content = _csv_content(rows)
        mock_issue = {**FAKE_ISSUE, "iid": 33}
        with patch("app.gitlab_client.create_issue", return_value=mock_issue) as mock_create:
            resp = client.post(
                "/tickets/import/csv?project_id=42",
                files={"file": ("test.csv", content, "text/csv")},
                cookies=admin_cookies,
            )
        assert resp.status_code == 201
        call_kwargs = mock_create.call_args.kwargs if mock_create.call_args.kwargs else mock_create.call_args[1]
        assert call_kwargs.get("project_id") == "42"
