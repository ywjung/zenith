#!/usr/bin/env python3
"""Security audit test script — verifies 13 security improvements via static analysis.

Each test reads the relevant source file(s) and checks for expected patterns.
No ITSM modules are imported; all checks are done via plain file I/O.
"""

import re
import sys
from pathlib import Path

BASE = Path(__file__).parent

RESULTS: list[tuple[str, bool, str]] = []


def check(test_name: str, passed: bool, detail: str) -> bool:
    status = "PASS" if passed else "FAIL"
    RESULTS.append((test_name, passed, detail))
    print(f"[{status}] {test_name}: {detail}")
    return passed


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def read(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# TEST 1: H-4 — Webhook body size limit
# ---------------------------------------------------------------------------
def test_h4():
    src = read("itsm-api/app/routers/webhooks.py")

    t1 = "_MAX_WEBHOOK_BODY = 1 * 1024 * 1024" in src
    t2 = "if len(body) > _MAX_WEBHOOK_BODY:" in src
    t3 = "raise HTTPException(status_code=413" in src

    passed = t1 and t2 and t3
    details = []
    if not t1:
        details.append("MISSING: _MAX_WEBHOOK_BODY = 1 * 1024 * 1024")
    if not t2:
        details.append("MISSING: if len(body) > _MAX_WEBHOOK_BODY:")
    if not t3:
        details.append("MISSING: raise HTTPException(status_code=413")
    if passed:
        details.append("All 3 checks present")
    return check("H-4 Webhook body size limit (1MB)", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 2: H-6 — Admin user list pagination
# ---------------------------------------------------------------------------
def test_h6():
    src = read("itsm-api/app/routers/admin.py")

    t1 = "page: int = Query" in src
    t2 = "per_page: int = Query" in src
    t3 = "q.count()" in src
    t4 = "offset((page - 1) * per_page).limit(per_page)" in src
    t5_total = '"total"' in src or "'total'" in src
    t5_page  = '"page"' in src  or "'page'" in src
    t5_perp  = '"per_page"' in src or "'per_page'" in src
    t5_items = '"items"' in src  or "'items'" in src

    # Verify the return for list_users specifically contains all four keys
    # Find the list_users function block up to the next @router decorator
    lu_match = re.search(
        r'@router\.get\("/users"\).*?(?=@router\.|$)',
        src,
        re.DOTALL,
    )
    lu_src = lu_match.group(0) if lu_match else ""
    lu_total = '"total"' in lu_src
    lu_page  = '"page"' in lu_src
    lu_perp  = '"per_page"' in lu_src
    lu_items = '"items"' in lu_src

    passed = t1 and t2 and t3 and t4 and lu_total and lu_page and lu_perp and lu_items
    details = []
    if not t1: details.append("MISSING page: int = Query")
    if not t2: details.append("MISSING per_page: int = Query")
    if not t3: details.append("MISSING q.count()")
    if not t4: details.append("MISSING offset((page-1)*per_page).limit(per_page)")
    if not (lu_total and lu_page and lu_perp and lu_items):
        details.append(f"Return keys missing in list_users: total={lu_total} page={lu_page} per_page={lu_perp} items={lu_items}")
    if passed:
        details.append("All pagination checks passed")
    return check("H-6 Admin user list pagination", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 3: H-7 — Pending approval blocks status transition
# ---------------------------------------------------------------------------
def test_h7():
    src = read("itsm-api/app/routers/tickets.py")

    t1 = 'ApprovalRequest.status == "pending"' in src
    t2 = "status_code=409" in src
    t3 = "대기 중인 승인 요청이 있어" in src

    passed = t1 and t2 and t3
    details = []
    if not t1: details.append('MISSING: ApprovalRequest.status == "pending"')
    if not t2: details.append("MISSING: status_code=409")
    if not t3: details.append("MISSING: 대기 중인 승인 요청이 있어")
    if passed: details.append("All 3 pending-approval checks present")
    return check("H-7 Pending approval blocks status transition", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 4: C-2 — Portal track rate limit reduced to 5/minute
# ---------------------------------------------------------------------------
def test_c2():
    src = read("itsm-api/app/routers/portal.py")

    # Escape curly braces for regex matching of the route string
    # Route: /track/{token}  (curly braces are literal in the source string)
    track_match = re.search(
        r'@router\.get\("/track/\{token\}".*?def portal_track',
        src,
        re.DOTALL,
    )
    region = track_match.group(0) if track_match else ""

    has_5 = '"5/minute"' in region or "'5/minute'" in region
    has_10 = '"10/minute"' in region or "'10/minute'" in region

    passed = has_5 and not has_10
    details = []
    if not region:  details.append('ERROR: could not find /track/{token} route region')
    if not has_5:   details.append('MISSING "5/minute" in /track/{token} decorator')
    if has_10:      details.append('BAD: "10/minute" still present in /track/{token} decorator')
    if passed:      details.append('"5/minute" present, "10/minute" absent')
    return check("C-2 Portal track rate limit (5/minute)", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 5: C-4 — CSP no unsafe-inline/unsafe-eval in main script-src
# ---------------------------------------------------------------------------
def test_c4():
    src = read("nginx/conf.d/default.conf")

    # The main CSP is the one on the outer server block (not inside /docs etc.)
    # It appears on a line that starts with "  add_header Content-Security-Policy"
    # and is NOT inside a /docs, /redoc, /metrics, /docs/oauth2-redirect sub-block.
    # Strategy: find the first add_header Content-Security-Policy line.
    csp_lines = []
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("add_header Content-Security-Policy"):
            csp_lines.append(stripped)

    if not csp_lines:
        return check("C-4 Main CSP no unsafe-inline/eval in script-src", False,
                     "MISSING: no Content-Security-Policy header found")

    main_csp = csp_lines[0]  # first occurrence = outer server block (line 20)

    # Extract script-src directive from main CSP
    script_src_match = re.search(r"script-src ([^;]+);", main_csp)
    if not script_src_match:
        return check("C-4 Main CSP no unsafe-inline/eval in script-src", False,
                     "MISSING: script-src directive not found in main CSP")

    script_src = script_src_match.group(1)
    no_unsafe_inline = "unsafe-inline" not in script_src
    no_unsafe_eval   = "unsafe-eval"   not in script_src

    # Also verify style-src still has unsafe-inline (Tailwind)
    style_src_match = re.search(r"style-src ([^;]+);", main_csp)
    style_has_unsafe_inline = False
    if style_src_match:
        style_has_unsafe_inline = "unsafe-inline" in style_src_match.group(1)

    passed = no_unsafe_inline and no_unsafe_eval
    details = []
    if not no_unsafe_inline: details.append(f"BAD: unsafe-inline found in script-src: {script_src!r}")
    if not no_unsafe_eval:   details.append(f"BAD: unsafe-eval found in script-src: {script_src!r}")
    if passed:
        details.append(f"script-src OK: {script_src!r}")
        details.append(f"style-src unsafe-inline present (Tailwind): {style_has_unsafe_inline}")
    return check("C-4 Main CSP no unsafe-inline/eval in script-src", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 6: M-6 — URL scheme whitelisting in MarkdownRenderer
# ---------------------------------------------------------------------------
def test_m6():
    src = read("itsm-web/src/components/MarkdownRenderer.tsx")

    t1 = "ALLOWED_URL_PATTERN" in src
    t2 = "/^(https?:|mailto:|/|#)/i" in src or "/^(https?:|mailto:|/|#)/i" in src
    # Also accept the actual pattern with escaped chars
    t2 = t2 or bool(re.search(r'ALLOWED_URL_PATTERN\s*=\s*/\^', src))
    t3 = "if (!ALLOWED_URL_PATTERN.test(href))" in src
    t4 = "return <span>{children}</span>" in src

    passed = t1 and t2 and t3 and t4
    details = []
    if not t1: details.append("MISSING: ALLOWED_URL_PATTERN constant")
    if not t2: details.append("MISSING: /^(https?:|mailto:|/|#)/i pattern")
    if not t3: details.append("MISSING: if (!ALLOWED_URL_PATTERN.test(href))")
    if not t4: details.append("MISSING: return <span>{children}</span>")
    if passed: details.append("All URL whitelist checks present")
    return check("M-6 URL scheme whitelisting in MarkdownRenderer", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 7: M-7 — Metrics token auth in nginx
# ---------------------------------------------------------------------------
def test_m7():
    src = read("nginx/conf.d/default.conf")

    # Find /metrics location block
    metrics_match = re.search(
        r'location\s*=\s*/metrics\s*\{([^}]+)\}',
        src,
        re.DOTALL,
    )
    if not metrics_match:
        return check("M-7 Metrics token auth in nginx", False,
                     "MISSING: location = /metrics block not found")

    block = metrics_match.group(1)
    t1 = "$http_x_metrics_token" in block
    t2 = "return 403" in block
    t3 = "$metrics_expected" in block

    passed = t1 and t2 and t3
    details = []
    if not t1: details.append("MISSING: $http_x_metrics_token")
    if not t2: details.append("MISSING: return 403")
    if not t3: details.append("MISSING: $metrics_expected")
    if passed: details.append("All metrics auth checks present")
    return check("M-7 Metrics token auth in nginx", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 8: M-8 — GuestToken deduplication before add
# ---------------------------------------------------------------------------
def test_m8():
    src = read("itsm-api/app/routers/portal.py")

    t1 = "db.query(GuestToken).filter(" in src
    t2 = "GuestToken.email ==" in src
    t3 = "GuestToken.ticket_iid ==" in src
    t4 = ".delete(synchronize_session=False)" in src

    # Verify delete comes BEFORE db.add(guest_token)
    delete_pos = src.find(".delete(synchronize_session=False)")
    add_pos    = src.find("db.add(guest_token)")
    order_ok   = (delete_pos != -1 and add_pos != -1 and delete_pos < add_pos)

    passed = t1 and t2 and t3 and t4 and order_ok
    details = []
    if not t1: details.append("MISSING: db.query(GuestToken).filter(")
    if not t2: details.append("MISSING: GuestToken.email ==")
    if not t3: details.append("MISSING: GuestToken.ticket_iid ==")
    if not t4: details.append("MISSING: .delete(synchronize_session=False)")
    if not order_ok:
        details.append(f"BAD ORDER: delete_pos={delete_pos}, add_pos={add_pos} (delete must come first)")
    if passed: details.append("GuestToken dedup delete present and ordered before db.add")
    return check("M-8 GuestToken deduplication before db.add", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 9: M-9 — Custom field type validation
# ---------------------------------------------------------------------------
def test_m9():
    src = read("itsm-api/app/routers/tickets.py")

    t1 = 'fdef.field_type == "number"' in src
    # float(value) inside try block — check both are close together
    number_block_match = re.search(
        r'fdef\.field_type == "number".*?float\(value\)',
        src, re.DOTALL
    )
    t2 = bool(number_block_match)
    t3 = 'fdef.field_type == "checkbox"' in src
    t4 = 'fdef.field_type == "select"' in src and "fdef.options" in src
    # 400 status in the validation section
    t5 = "status_code=400" in src

    passed = t1 and t2 and t3 and t4 and t5
    details = []
    if not t1: details.append('MISSING: fdef.field_type == "number"')
    if not t2: details.append("MISSING: float(value) near number field check")
    if not t3: details.append('MISSING: fdef.field_type == "checkbox"')
    if not t4: details.append('MISSING: fdef.field_type == "select" with fdef.options')
    if not t5: details.append("MISSING: HTTPException with status_code=400")
    if passed: details.append("All custom field type validation checks present")
    return check("M-9 Custom field type validation", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 10: M-10 — AuditLog for failed refresh token
# ---------------------------------------------------------------------------
def test_m10():
    src = read("itsm-api/app/routers/auth.py")

    t1 = "from ..audit import write_audit_log" in src
    t2 = '"auth.refresh.invalid_token"' in src or "'auth.refresh.invalid_token'" in src
    t3 = '"auth.refresh.expired"' in src or "'auth.refresh.expired'" in src

    # Verify write_audit_log is called on both branches (invalid and expired)
    invalid_match = re.search(
        r'write_audit_log\([^)]*auth\.refresh\.invalid_token[^)]*\)',
        src, re.DOTALL,
    )
    expired_match = re.search(
        r'write_audit_log\([^)]*auth\.refresh\.expired[^)]*\)',
        src, re.DOTALL,
    )
    t4 = bool(invalid_match)
    t5 = bool(expired_match)

    passed = t1 and t2 and t3 and t4 and t5
    details = []
    if not t1: details.append("MISSING: from ..audit import write_audit_log")
    if not t2: details.append("MISSING: auth.refresh.invalid_token event string")
    if not t3: details.append("MISSING: auth.refresh.expired event string")
    if not t4: details.append("MISSING: write_audit_log call for invalid_token branch")
    if not t5: details.append("MISSING: write_audit_log call for expired branch")
    if passed: details.append("Both audit log calls present (invalid_token and expired)")
    return check("M-10 AuditLog on failed refresh token", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 11: C-1 — DOMPurify replaces custom sanitizer
# ---------------------------------------------------------------------------
def test_c1():
    src = read("itsm-web/src/components/MarkdownRenderer.tsx")

    t1 = "import DOMPurify from 'isomorphic-dompurify'" in src
    t2 = "DOMPurify.sanitize(" in src

    # Old regex approach — should NOT be present
    old_regex = re.search(r'\.replace\(<\(script\|iframe', src)
    t3_absent = old_regex is None

    passed = t1 and t2 and t3_absent
    details = []
    if not t1: details.append("MISSING: import DOMPurify from 'isomorphic-dompurify'")
    if not t2: details.append("MISSING: DOMPurify.sanitize(")
    if not t3_absent: details.append("BAD: old regex sanitizer pattern still present")
    if passed: details.append("DOMPurify import and usage confirmed; old regex absent")
    return check("C-1 DOMPurify replaces custom sanitizer", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 12: L-5 — localStorage.clear on logout
# ---------------------------------------------------------------------------
def test_l5():
    src = read("itsm-web/src/context/AuthContext.tsx")

    # Extract logout function: find from 'const logout' to 'const isDeveloper' (next top-level const)
    logout_start = src.find("const logout")
    logout_end   = src.find("const isDeveloper", logout_start)
    if logout_start == -1:
        logout_body = ""
    elif logout_end == -1:
        logout_body = src[logout_start:]
    else:
        logout_body = src[logout_start:logout_end]

    t1 = "sessionStorage.clear()" in logout_body
    t2 = "localStorage.clear()" in logout_body
    # Old item-by-item removal should not be present in logout
    t3_absent = "localStorage.removeItem" not in logout_body

    passed = t1 and t2 and t3_absent
    details = []
    if not t1: details.append("MISSING: sessionStorage.clear() in logout()")
    if not t2: details.append("MISSING: localStorage.clear() in logout()")
    if not t3_absent: details.append("BAD: localStorage.removeItem still present (old approach)")
    if passed: details.append("Both clear() calls present; removeItem absent")
    return check("L-5 localStorage.clear on logout", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# TEST 13: L-6 — @mention username validation
# ---------------------------------------------------------------------------
def test_l6():
    src = read("itsm-api/app/routers/tickets.py")

    # Regex pattern must be present
    t1 = bool(re.search(r'\^(\[a-zA-Z0-9_\\.\\-\]|\[a-zA-Z0-9_\.\-\])\{1,100\}\$', src))
    # Allow the raw string forms too
    if not t1:
        t1 = "^[a-zA-Z0-9_.\\-]{1,100}$" in src or "^[a-zA-Z0-9_.-]{1,100}$" in src or r"^[a-zA-Z0-9_.\-]{1,100}$" in src

    # data-id pattern must also have length cap {1,100}
    # Source: r'data-id="([^"]{1,100})"'  — the {1,100} quantifier caps capture length
    t2 = bool(re.search(r'data-id="[^"\\[\\]]+\{1,100\}"', src)) or \
         bool(re.search(r'data-id=.*\{1,100\}', src))

    # _USERNAME_RE used to filter
    t3 = "_USERNAME_RE" in src and "_USERNAME_RE.match(" in src

    # Should NOT have uncapped findall (old: [^"]+)
    bad_match = re.search(r'data-id="\[\\^"\]\+"', src)
    t4_absent = bad_match is None

    passed = t1 and t2 and t3 and t4_absent
    details = []
    if not t1: details.append("MISSING: username regex ^[a-zA-Z0-9_.\\-]{1,100}$")
    if not t2: details.append("MISSING: data-id length cap {1,100} in findall")
    if not t3: details.append("MISSING: _USERNAME_RE / _USERNAME_RE.match usage")
    if not t4_absent: details.append("BAD: uncapped data-id=[^\"]+ still present")
    if passed: details.append("Username regex and length-capped findall confirmed")
    return check("L-6 @mention username validation", passed, " | ".join(details))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("ITSM Security Audit — Static Analysis Tests")
    print("=" * 70)
    print()

    tests = [
        test_h4,
        test_h6,
        test_h7,
        test_c2,
        test_c4,
        test_m6,
        test_m7,
        test_m8,
        test_m9,
        test_m10,
        test_c1,
        test_l5,
        test_l6,
    ]

    for t in tests:
        try:
            t()
        except Exception as e:
            check(t.__name__, False, f"EXCEPTION: {e}")

    print()
    print("=" * 70)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = len(RESULTS) - passed
    print(f"SUMMARY: {passed}/{len(RESULTS)} tests passed, {failed} failed")
    print("=" * 70)

    if failed:
        print("\nFailed tests:")
        for name, ok, detail in RESULTS:
            if not ok:
                print(f"  - {name}: {detail}")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
