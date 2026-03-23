"""Dark-mode–aware HTML email templates for ITSM system notifications.

Each render_* function returns (subject, html_body) ready to pass to send_email().
The DB-driven Jinja2 templates (via _render_email_template) take precedence; these
functions are the static fallback used when no DB template is configured.

Design notes:
- Base uses @media (prefers-color-scheme: dark) for modern clients (Apple Mail,
  Gmail on iOS/macOS, Outlook 2019+ on macOS).
- Inline styles are duplicated on elements where @media overrides are unreliable
  (older Outlook ignores <style> blocks entirely, so light-mode defaults are safe).
- No table-based layout — div + max-width is sufficient for modern email clients
  and Gmail/Outlook web.
- All user-supplied text must be html.escape()d by the caller before passing to
  these functions (notifications.py already does this).
"""

import html as _html


# ---------------------------------------------------------------------------
# Status and priority display helpers
# ---------------------------------------------------------------------------

STATUS_MAP: dict[str, str] = {
    "open": "접수됨",
    "approved": "승인완료",
    "in_progress": "처리 중",
    "waiting": "추가정보 대기",
    "resolved": "처리 완료",
    "testing": "테스트중",
    "ready_for_release": "운영배포전",
    "released": "운영반영완료",
    "closed": "종료됨",
    "reopened": "재개됨",
}

PRIORITY_COLOR: dict[str, tuple[str, str]] = {
    # (light-bg, light-fg)
    "critical": ("#fee2e2", "#991b1b"),
    "high":     ("#ffedd5", "#9a3412"),
    "medium":   ("#fef9c3", "#854d0e"),
    "low":      ("#dcfce7", "#166534"),
}

PRIORITY_DARK_COLOR: dict[str, tuple[str, str]] = {
    # (dark-bg, dark-fg)
    "critical": ("#450a0a", "#fca5a5"),
    "high":     ("#431407", "#fdba74"),
    "medium":   ("#422006", "#fde047"),
    "low":      ("#052e16", "#86efac"),
}

PRIORITY_LABEL: dict[str, str] = {
    "critical": "긴급",
    "high":     "높음",
    "medium":   "보통",
    "low":      "낮음",
}


def _priority_badge(priority: str) -> str:
    p = priority.lower()
    lbg, lfg = PRIORITY_COLOR.get(p, ("#f1f5f9", "#475569"))
    dbg, dfg = PRIORITY_DARK_COLOR.get(p, ("#1e293b", "#94a3b8"))
    label = PRIORITY_LABEL.get(p, _html.escape(priority))
    return (
        f'<span class="priority-badge" style="'
        f"display:inline-block;padding:2px 10px;border-radius:12px;"
        f"font-size:12px;font-weight:600;"
        f"background:{lbg};color:{lfg};"
        f'">'
        f"<span class=\"dark-hide\">{label}</span>"
        f'<span class="dark-show" style="display:none">{label}</span>'
        f"</span>"
    )


# ---------------------------------------------------------------------------
# Base template
# ---------------------------------------------------------------------------

def get_base_template() -> str:
    """Return the HTML shell with dark-mode CSS. Use {CONTENT} and {CTA} as
    placeholders — call _render(content_html, cta_html) instead."""
    return """\
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{EMAIL_TITLE}</title>
  <style>
    /* ---- Reset ---- */
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}

    /* ---- Light mode defaults ---- */
    body {{
      background-color: #f8fafc;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                   'Helvetica Neue', Arial, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }}
    .wrapper {{
      width: 100%;
      padding: 32px 16px;
      background-color: #f8fafc;
    }}
    .container {{
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }}
    .header {{
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      padding: 28px 32px;
      text-align: left;
    }}
    .header-brand {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .header-star {{
      width: 32px;
      height: 32px;
      background: rgba(255,255,255,0.15);
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
    }}
    .header-title {{
      color: #ffffff;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }}
    .header-subtitle {{
      color: rgba(255,255,255,0.75);
      font-size: 12px;
      margin-top: 2px;
    }}
    .content {{
      padding: 32px;
      color: #1e293b;
    }}
    .content h2 {{
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
      letter-spacing: -0.3px;
    }}
    .content p {{
      color: #475569;
      margin-bottom: 12px;
    }}
    .meta-table {{
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }}
    .meta-table td {{
      padding: 10px 14px;
      font-size: 14px;
      vertical-align: top;
    }}
    .meta-table tr:not(:last-child) td {{
      border-bottom: 1px solid #e2e8f0;
    }}
    .meta-table .label {{
      font-weight: 600;
      color: #64748b;
      white-space: nowrap;
      width: 110px;
      background-color: #f8fafc;
    }}
    .meta-table .value {{
      color: #0f172a;
    }}
    .status-arrow {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }}
    .status-chip {{
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }}
    .chip-old {{ background:#f1f5f9; color:#475569; }}
    .chip-new {{ background:#dbeafe; color:#1d4ed8; }}
    .chip-resolved {{ background:#dcfce7; color:#166534; }}
    .chip-closed {{ background:#f1f5f9; color:#475569; }}
    .chip-critical {{ background:#fee2e2; color:#991b1b; }}

    .cta-wrap {{
      padding: 0 32px 28px;
      text-align: center;
    }}
    .cta-btn {{
      display: inline-block;
      padding: 12px 28px;
      background: #1d4ed8;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.2px;
    }}

    .divider {{
      height: 1px;
      background: #e2e8f0;
      margin: 0 32px 24px;
    }}

    .alert-box {{
      border-radius: 8px;
      padding: 14px 16px;
      margin: 16px 0;
      font-size: 14px;
    }}
    .alert-warn {{
      background: #fff7ed;
      border-left: 4px solid #f97316;
      color: #7c2d12;
    }}
    .alert-danger {{
      background: #fff1f2;
      border-left: 4px solid #ef4444;
      color: #7f1d1d;
    }}
    .alert-info {{
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
      color: #1e3a5f;
    }}

    .comment-box {{
      background: #f8fafc;
      border-left: 3px solid #cbd5e1;
      border-radius: 0 6px 6px 0;
      padding: 12px 16px;
      color: #475569;
      font-size: 14px;
      margin: 16px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }}

    .footer {{
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 20px 32px;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
    }}
    .footer a {{
      color: #64748b;
      text-decoration: none;
    }}

    /* ---- Dark mode overrides ---- */
    @media (prefers-color-scheme: dark) {{
      body {{
        background-color: #0f172a !important;
        color: #e2e8f0 !important;
      }}
      .wrapper {{
        background-color: #0f172a !important;
      }}
      .container {{
        background-color: #1e293b !important;
        border-color: #334155 !important;
      }}
      .content {{
        color: #e2e8f0 !important;
      }}
      .content h2 {{
        color: #f1f5f9 !important;
      }}
      .content p {{
        color: #cbd5e1 !important;
      }}
      .meta-table {{
        border-color: #334155 !important;
      }}
      .meta-table tr:not(:last-child) td {{
        border-bottom-color: #334155 !important;
      }}
      .meta-table .label {{
        background-color: #0f172a !important;
        color: #94a3b8 !important;
      }}
      .meta-table .value {{
        color: #e2e8f0 !important;
      }}
      .chip-old {{ background:#1e293b !important; color:#94a3b8 !important; }}
      .chip-new {{ background:#1e3a5f !important; color:#93c5fd !important; }}
      .chip-resolved {{ background:#052e16 !important; color:#86efac !important; }}
      .chip-closed {{ background:#1e293b !important; color:#94a3b8 !important; }}
      .chip-critical {{ background:#450a0a !important; color:#fca5a5 !important; }}
      .alert-warn {{
        background: #431407 !important;
        border-left-color: #fb923c !important;
        color: #fed7aa !important;
      }}
      .alert-danger {{
        background: #450a0a !important;
        border-left-color: #f87171 !important;
        color: #fecaca !important;
      }}
      .alert-info {{
        background: #0c1a2e !important;
        border-left-color: #60a5fa !important;
        color: #bfdbfe !important;
      }}
      .comment-box {{
        background: #0f172a !important;
        border-left-color: #475569 !important;
        color: #94a3b8 !important;
      }}
      .footer {{
        background-color: #0f172a !important;
        border-top-color: #334155 !important;
        color: #475569 !important;
      }}
      .divider {{
        background: #334155 !important;
      }}
    }}
  </style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-brand">
        <span class="header-star">&#10022;</span>
        <div>
          <div class="header-title">ZENITH ITSM</div>
          <div class="header-subtitle">IT Service Management</div>
        </div>
      </div>
    </div>
    <!-- Content -->
    <div class="content">
      {CONTENT}
    </div>
    {CTA}
    <!-- Footer -->
    <div class="footer">
      ZENITH ITSM &nbsp;&middot;&nbsp; 이 메일은 시스템에서 자동 발송됩니다.<br>
      문의: <a href="mailto:it-support@company.com">it-support@company.com</a>
    </div>
  </div>
</div>
</body>
</html>"""


def _render(content_html: str, cta_url: str | None, cta_label: str, email_title: str) -> str:
    """Inject content and optional CTA button into the base template."""
    base = get_base_template()

    if cta_url:
        cta_block = (
            '<div class="cta-wrap">'
            f'<a href="{cta_url}" class="cta-btn">{cta_label}</a>'
            "</div>"
        )
    else:
        cta_block = ""

    return (
        base
        .replace("{EMAIL_TITLE}", email_title)
        .replace("{CONTENT}", content_html)
        .replace("{CTA}", cta_block)
    )


def _ticket_meta_row(label: str, value: str) -> str:
    return (
        f'<tr>'
        f'<td class="label">{label}</td>'
        f'<td class="value">{value}</td>'
        f'</tr>'
    )


# ---------------------------------------------------------------------------
# Public render functions
# ---------------------------------------------------------------------------

def render_ticket_created(ticket_data: dict) -> tuple[str, str]:
    """티켓 생성 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    employee = _html.escape(str(ticket_data.get("employee_name", "")))
    priority = _html.escape(str(ticket_data.get("priority", "medium")))
    category = _html.escape(str(ticket_data.get("category", "")))
    description = _html.escape(str(ticket_data.get("description", "")))
    portal_url = ticket_data.get("portal_url", "#")

    priority_badge = _priority_badge(priority)

    content = f"""\
<h2>새 티켓이 등록됐습니다</h2>
<p>IT 팀에 새 지원 요청이 접수되었습니다. 아래 내용을 확인하고 처리해 주세요.</p>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("신청자", employee)}
  {_ticket_meta_row("우선순위", priority_badge)}
  {_ticket_meta_row("카테고리", category)}
</table>
{f'<div class="comment-box">{description}</div>' if description else ""}
"""

    html_body = _render(content, portal_url, "티켓 확인하기", f"새 티켓 #{iid}")
    subject = f"[ITSM] 새 티켓 #{iid}: {ticket_data.get('title', '')}"
    return subject, html_body


def render_ticket_status_changed(
    ticket_data: dict,
    old_status: str,
    new_status: str,
    actor_name: str = "",
) -> tuple[str, str]:
    """상태 변경 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    actor_esc = _html.escape(str(actor_name))
    portal_url = ticket_data.get("portal_url", "#")

    old_ko = STATUS_MAP.get(old_status, old_status)
    new_ko = STATUS_MAP.get(new_status, new_status)

    terminal = new_status in ("resolved", "closed")
    new_chip_class = "chip-resolved" if terminal else "chip-new"
    new_chip_class = "chip-closed" if new_status == "closed" else new_chip_class

    status_html = (
        f'<span class="status-arrow">'
        f'<span class="status-chip chip-old">{old_ko}</span>'
        f' &rarr; '
        f'<span class="status-chip {new_chip_class}">{new_ko}</span>'
        f"</span>"
    )

    content = f"""\
<h2>티켓 상태가 변경됐습니다</h2>
<p>티켓 <strong>#{iid}</strong>의 상태가 업데이트되었습니다.</p>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("상태 변경", status_html)}
  {_ticket_meta_row("처리자", actor_esc) if actor_esc else ""}
</table>
"""

    html_body = _render(content, portal_url, "티켓 확인하기", f"티켓 #{iid} 상태 변경")
    subject = f"[ITSM] 티켓 #{iid} 상태 변경: {new_ko}"
    return subject, html_body


def render_sla_warning(ticket_data: dict, remaining_minutes: int) -> tuple[str, str]:
    """SLA 임박 경고 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    project_id = _html.escape(str(ticket_data.get("project_id", "")))
    portal_url = ticket_data.get("portal_url", "#")

    hours = remaining_minutes // 60
    mins = remaining_minutes % 60
    if hours > 0:
        time_str = f"{hours}시간 {mins}분" if mins else f"{hours}시간"
    else:
        time_str = f"{mins}분"

    content = f"""\
<h2>SLA 기한이 임박했습니다</h2>
<p>아래 티켓의 SLA 기한까지 <strong>{time_str}</strong>이 남았습니다. 즉시 확인해 주세요.</p>
<div class="alert-box alert-warn">
  <strong>&#9888; 경고</strong>&nbsp; 티켓 <strong>#{iid}</strong>의 SLA 기한이 임박했습니다.
  {f"프로젝트: {project_id}" if project_id else ""}
</div>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("남은 시간", f"<strong style='color:#f97316'>{time_str}</strong>")}
  {_ticket_meta_row("프로젝트", project_id) if project_id else ""}
</table>
"""

    html_body = _render(content, portal_url, "티켓 바로 처리하기", f"SLA 경고 — 티켓 #{iid}")
    subject = f"[ITSM] ⏰ SLA 임박 경고 - 티켓 #{iid} ({time_str} 남음)"
    return subject, html_body


def render_sla_breached(ticket_data: dict) -> tuple[str, str]:
    """SLA 위반 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    project_id = _html.escape(str(ticket_data.get("project_id", "")))
    portal_url = ticket_data.get("portal_url", "#")

    content = f"""\
<h2>SLA 기한이 초과됐습니다</h2>
<p>아래 티켓의 SLA 기한이 지났습니다. 즉시 처리가 필요합니다.</p>
<div class="alert-box alert-danger">
  <strong>&#9888; SLA 위반</strong>&nbsp; 티켓 <strong>#{iid}</strong>의 SLA 기한이 초과됐습니다.
  {f"프로젝트: {project_id}" if project_id else ""}
</div>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("상태", '<span class="status-chip chip-critical">SLA 초과</span>')}
  {_ticket_meta_row("프로젝트", project_id) if project_id else ""}
</table>
"""

    html_body = _render(content, portal_url, "즉시 처리하기", f"SLA 위반 — 티켓 #{iid}")
    subject = f"[ITSM] ⚠️ SLA 초과 - 티켓 #{iid}"
    return subject, html_body


def render_approval_requested(
    ticket_data: dict,
    approver_name: str,
    requester_name: str,
) -> tuple[str, str]:
    """승인 요청 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    approver_esc = _html.escape(str(approver_name))
    requester_esc = _html.escape(str(requester_name))
    portal_url = ticket_data.get("portal_url", "#")

    content = f"""\
<h2>승인 요청이 도착했습니다</h2>
<p>안녕하세요, <strong>{approver_esc}</strong>님.</p>
<p><strong>{requester_esc}</strong>님이 아래 티켓에 대한 승인을 요청했습니다.</p>
<div class="alert-box alert-info">
  티켓 <strong>#{iid}</strong>을 검토하고 승인 또는 반려해 주세요.
</div>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("요청자", requester_esc)}
</table>
"""

    html_body = _render(content, portal_url, "승인 요청 검토하기", f"승인 요청 — 티켓 #{iid}")
    subject = f"[ITSM] 티켓 #{iid} 승인 요청"
    return subject, html_body


def render_approval_decided(
    ticket_data: dict,
    requester_name: str,
    decision: str,
    decider_name: str,
    reason: str | None = None,
) -> tuple[str, str]:
    """승인/반려 결과 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    requester_esc = _html.escape(str(requester_name))
    decider_esc = _html.escape(str(decider_name))
    portal_url = ticket_data.get("portal_url", "#")

    decision_ko = "승인" if decision == "approved" else "반려"
    chip_class = "chip-resolved" if decision == "approved" else "chip-critical"
    alert_class = "alert-info" if decision == "approved" else "alert-warn"

    reason_row = (
        _ticket_meta_row("사유", _html.escape(str(reason)))
        if reason else ""
    )

    content = f"""\
<h2>티켓 {decision_ko} 결과 안내</h2>
<p>안녕하세요, <strong>{requester_esc}</strong>님.</p>
<div class="alert-box {alert_class}">
  티켓 <strong>#{iid}</strong>이(가) <strong>{decision_ko}</strong>되었습니다.
</div>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("결과", f'<span class="status-chip {chip_class}">{decision_ko}</span>')}
  {_ticket_meta_row("처리자", decider_esc)}
  {reason_row}
</table>
"""

    html_body = _render(content, portal_url, "티켓 확인하기", f"티켓 #{iid} {decision_ko}")
    subject = f"[ITSM] 티켓 #{iid} {decision_ko} 완료"
    return subject, html_body


def render_comment_added(
    ticket_data: dict,
    commenter: str,
    comment_preview: str,
) -> tuple[str, str]:
    """댓글 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    commenter_esc = _html.escape(str(commenter))
    preview_esc = _html.escape(str(comment_preview))
    portal_url = ticket_data.get("portal_url", "#")

    content = f"""\
<h2>티켓에 새 댓글이 달렸습니다</h2>
<p>티켓 <strong>#{iid}</strong>에 댓글이 추가됐습니다.</p>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("작성자", commenter_esc)}
</table>
<div class="comment-box">{preview_esc}</div>
"""

    html_body = _render(content, portal_url, "댓글 확인하기", f"티켓 #{iid} 새 댓글")
    subject = f"[ITSM] 티켓 #{iid} 새 댓글"
    return subject, html_body


def render_assigned(
    ticket_data: dict,
    assignee_name: str,
    actor_name: str,
) -> tuple[str, str]:
    """담당자 배정 알림 — (subject, html_body)."""
    iid = ticket_data.get("iid", "?")
    title = _html.escape(str(ticket_data.get("title", "")))
    assignee_esc = _html.escape(str(assignee_name))
    actor_esc = _html.escape(str(actor_name))
    portal_url = ticket_data.get("portal_url", "#")

    content = f"""\
<h2>담당자로 배정됐습니다</h2>
<p>안녕하세요, <strong>{assignee_esc}</strong>님. 아래 티켓의 담당자로 배정됐습니다.</p>
<table class="meta-table">
  {_ticket_meta_row("티켓 번호", f"<strong>#{iid}</strong>")}
  {_ticket_meta_row("제목", title)}
  {_ticket_meta_row("배정자", actor_esc)}
</table>
"""

    html_body = _render(content, portal_url, "티켓 확인하기", f"담당자 배정 — 티켓 #{iid}")
    subject = f"[ITSM] 티켓 #{iid} 담당자로 배정됐습니다"
    return subject, html_body
