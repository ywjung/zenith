'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

interface EmailTemplate {
  id: number
  event_type: string
  subject: string
  html_body: string
  enabled: boolean
  updated_by: string | null
  updated_at: string | null
}

const EVENT_LABELS: Record<string, { label: string; desc: string; icon: string }> = {
  ticket_created: { label: '티켓 생성', desc: '새 티켓 등록 시 IT팀 및 담당자에게 발송', icon: '🎫' },
  status_changed: { label: '상태 변경', desc: '티켓 상태 변경 시 신청자 및 구독자에게 발송', icon: '🔄' },
  comment_added:  { label: '댓글 추가', desc: '새 댓글 등록 시 신청자 및 구독자에게 발송', icon: '💬' },
  sla_warning:    { label: 'SLA 경고', desc: 'SLA 기한 60분 전 IT팀에 발송', icon: '⏰' },
  sla_breach:     { label: 'SLA 위반', desc: 'SLA 기한 초과 시 IT팀에 발송', icon: '🚨' },
}

const TEMPLATE_VARS: Record<string, string[]> = {
  ticket_created: ['iid', 'title', 'employee_name', 'priority', 'category', 'description', 'portal_url'],
  status_changed: ['iid', 'title', 'old_status', 'new_status', 'actor_name', 'portal_url'],
  comment_added:  ['iid', 'title', 'author_name', 'comment_preview', 'portal_url'],
  sla_warning:    ['iid', 'minutes_left', 'portal_url'],
  sla_breach:     ['iid', 'portal_url'],
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

function EmailTemplatesContent() {
  const { isAdmin } = useAuth()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<EmailTemplate | null>(null)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState('')
  const [htmlBody, setHtmlBody] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ subject: string; html_body: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/admin/email-templates')
      .then(setTemplates)
      .catch(() => setError('템플릿 로드 실패'))
      .finally(() => setLoading(false))
  }, [])

  const selectTemplate = (tmpl: EmailTemplate) => {
    setSelected(tmpl); setSubject(tmpl.subject); setHtmlBody(tmpl.html_body)
    setEnabled(tmpl.enabled); setEditing(false); setPreview(null)
    setError(null); setSuccess(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      const data = await apiFetch(`/admin/email-templates/${selected.event_type}`, {
        method: 'PUT', body: JSON.stringify({ subject, html_body: htmlBody, enabled }),
      })
      setTemplates(ts => ts.map(t => t.event_type === selected.event_type ? data : t))
      setSelected(data); setEditing(false)
      setSuccess('저장됐습니다.'); setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally { setSaving(false) }
  }

  const handlePreview = async () => {
    if (!selected) return
    setPreviewLoading(true); setPreview(null)
    try {
      const data = await apiFetch(`/admin/email-templates/${selected.event_type}/preview`, {
        method: 'POST', body: JSON.stringify({ subject, html_body: htmlBody, enabled }),
      })
      setPreview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기 실패')
    } finally { setPreviewLoading(false) }
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">관리자 권한이 필요합니다.</div>

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          이메일 템플릿 관리
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          이벤트별 이메일 알림 내용을 커스터마이즈합니다. Jinja2 문법({`{{ 변수 }}`})을 지원합니다.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : (
        <div className="flex gap-6">
          {/* 좌측: 템플릿 목록 */}
          <div className="w-64 shrink-0 space-y-2">
            {templates.map(tmpl => {
              const meta = EVENT_LABELS[tmpl.event_type] ?? { label: tmpl.event_type, icon: '📧', desc: '' }
              return (
                <button
                  key={tmpl.event_type}
                  onClick={() => selectTemplate(tmpl)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selected?.event_type === tmpl.event_type
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600 text-blue-800 dark:text-blue-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{meta.icon} {meta.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${tmpl.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                      {tmpl.enabled ? '활성' : '비활성'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{meta.desc}</p>
                </button>
              )
            })}
          </div>

          {/* 우측: 편집 영역 */}
          {selected ? (
            <div className="flex-1 min-w-0">
              <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {EVENT_LABELS[selected.event_type]?.icon} {EVENT_LABELS[selected.event_type]?.label ?? selected.event_type}
                    </h2>
                    {selected.updated_by && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        마지막 수정: {selected.updated_by} · {selected.updated_at ? new Date(selected.updated_at).toLocaleString('ko-KR') : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!editing && (
                      <button onClick={() => setEditing(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        편집
                      </button>
                    )}
                    {editing && (
                      <>
                        <button onClick={handlePreview} disabled={previewLoading} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50">
                          {previewLoading ? '미리보기 중...' : '미리보기'}
                        </button>
                        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                          {saving ? '저장 중...' : '저장'}
                        </button>
                        <button onClick={() => { selectTemplate(selected); setEditing(false) }} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md hover:bg-gray-50">
                          취소
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-md">{error}</div>}
                {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 text-sm rounded-md">{success}</div>}

                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">사용 가능한 변수:</p>
                  <div className="flex flex-wrap gap-1">
                    {(TEMPLATE_VARS[selected.event_type] ?? []).map(v => (
                      <code key={v} className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded font-mono text-blue-600 dark:text-blue-400">
                        {`{{ ${v} }}`}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">제목</label>
                  {editing ? (
                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  ) : (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-200">{selected.subject}</div>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">HTML 본문</label>
                  {editing ? (
                    <textarea value={htmlBody} onChange={e => setHtmlBody(e.target.value)} rows={16}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y" />
                  ) : (
                    <pre className="bg-gray-50 dark:bg-gray-700/50 rounded-md px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">{selected.html_body}</pre>
                  )}
                </div>

                {editing && (
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 text-blue-600" />
                    <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">템플릿 활성화 (비활성화 시 기본 하드코딩 템플릿 사용)</label>
                  </div>
                )}
              </div>

              {preview && (
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">미리보기 (샘플 데이터)</h3>
                  <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-sm">
                    <span className="font-medium text-gray-600 dark:text-gray-400">제목: </span>
                    <span className="text-gray-900 dark:text-gray-100">{preview.subject}</span>
                  </div>
                  <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-600">HTML 렌더링</div>
                    {/* sandbox iframe — XSS 방지: script 실행 차단 */}
                    <iframe
                      srcDoc={preview.html_body}
                      sandbox="allow-same-origin"
                      className="w-full min-h-[200px] border-0"
                      title="이메일 미리보기"
                      onLoad={(e) => {
                        const iframe = e.currentTarget
                        const body = iframe.contentDocument?.body
                        if (body) iframe.style.height = `${body.scrollHeight + 32}px`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              좌측에서 편집할 템플릿을 선택하세요.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function EmailTemplatesPage() {
  return (
    <RequireAuth>
      <EmailTemplatesContent />
    </RequireAuth>
  )
}
