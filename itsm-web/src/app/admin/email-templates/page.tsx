'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { adminFetch } from '@/lib/adminFetch'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'
import { errorMessage } from '@/lib/utils'

interface EmailTemplate {
  id: number
  event_type: string
  subject: string
  html_body: string
  enabled: boolean
  updated_by: string | null
  updated_at: string | null
}

const EVENT_META: Record<string, { i18nPrefix: string; icon: string }> = {
  ticket_created: { i18nPrefix: 'ev_ticket_created', icon: '🎫' },
  status_changed: { i18nPrefix: 'ev_status_changed', icon: '🔄' },
  comment_added:  { i18nPrefix: 'ev_comment_added',  icon: '💬' },
  sla_warning:    { i18nPrefix: 'ev_sla_warning',    icon: '⏰' },
  sla_breach:     { i18nPrefix: 'ev_sla_breach',     icon: '🚨' },
}

const TEMPLATE_VARS: Record<string, string[]> = {
  ticket_created: ['iid', 'title', 'employee_name', 'priority', 'category', 'description', 'portal_url'],
  status_changed: ['iid', 'title', 'old_status', 'new_status', 'actor_name', 'portal_url'],
  comment_added:  ['iid', 'title', 'author_name', 'comment_preview', 'portal_url'],
  sla_warning:    ['iid', 'minutes_left', 'portal_url'],
  sla_breach:     ['iid', 'portal_url'],
}


function EmailTemplatesContent() {
  const t = useTranslations('admin.email_templates')
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
    adminFetch('/admin/email-templates')
      .then(setTemplates)
      .catch(() => setError(t('load_failed')))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const eventLabel = (ev: string) => {
    const meta = EVENT_META[ev]
    if (!meta) return ev
    return t(`${meta.i18nPrefix}_label` as 'ev_ticket_created_label')
  }
  const eventDesc = (ev: string) => {
    const meta = EVENT_META[ev]
    if (!meta) return ''
    return t(`${meta.i18nPrefix}_desc` as 'ev_ticket_created_desc')
  }
  const eventIcon = (ev: string) => EVENT_META[ev]?.icon ?? '📧'

  const selectTemplate = (tmpl: EmailTemplate) => {
    setSelected(tmpl); setSubject(tmpl.subject); setHtmlBody(tmpl.html_body)
    setEnabled(tmpl.enabled); setEditing(false); setPreview(null)
    setError(null); setSuccess(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true); setError(null)
    try {
      const data = await adminFetch(`/admin/email-templates/${selected.event_type}`, {
        method: 'PUT', body: JSON.stringify({ subject, html_body: htmlBody, enabled }),
      })
      setTemplates(ts => ts.map(tt => tt.event_type === selected.event_type ? data : tt))
      setSelected(data); setEditing(false)
      setSuccess(t('save_success')); setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(errorMessage(e, t('save_failed')))
    } finally { setSaving(false) }
  }

  const handlePreview = async () => {
    if (!selected) return
    setPreviewLoading(true); setPreview(null)
    try {
      const data = await adminFetch(`/admin/email-templates/${selected.event_type}/preview`, {
        method: 'POST', body: JSON.stringify({ subject, html_body: htmlBody, enabled }),
      })
      setPreview(data)
    } catch (e) {
      setError(errorMessage(e, t('preview_failed')))
    } finally { setPreviewLoading(false) }
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">{t('no_permission')}</div>

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {t('title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('subtitle')}
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('loading')}</div>
      ) : (
        <div className="flex gap-6">
          <div className="w-64 shrink-0 space-y-2">
            {templates.map(tmpl => (
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
                  <span className="text-sm font-medium">{eventIcon(tmpl.event_type)} {eventLabel(tmpl.event_type)}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${tmpl.enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                    {tmpl.enabled ? t('active') : t('inactive')}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{eventDesc(tmpl.event_type)}</p>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="flex-1 min-w-0">
              <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {eventIcon(selected.event_type)} {eventLabel(selected.event_type)}
                    </h2>
                    {selected.updated_by && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t('last_updated', { by: selected.updated_by, date: selected.updated_at ? new Date(selected.updated_at).toLocaleString() : '' })}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!editing && (
                      <button onClick={() => setEditing(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        {t('edit')}
                      </button>
                    )}
                    {editing && (
                      <>
                        <button onClick={handlePreview} disabled={previewLoading} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                          {previewLoading ? t('previewing') : t('preview')}
                        </button>
                        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                          {saving ? t('saving') : t('save')}
                        </button>
                        <button onClick={() => { selectTemplate(selected); setEditing(false) }} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md hover:bg-gray-50">
                          {t('cancel')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-md">{error}</div>}
                {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 text-sm rounded-md">{success}</div>}

                <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('available_vars')}</p>
                  <div className="flex flex-wrap gap-1">
                    {(TEMPLATE_VARS[selected.event_type] ?? []).map(v => (
                      <code key={v} className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded font-mono text-blue-600 dark:text-blue-400">
                        {`{{ ${v} }}`}
                      </code>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('subject')}</label>
                  {editing ? (
                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  ) : (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-md px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-200">{selected.subject}</div>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('html_body')}</label>
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
                    <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">{t('enable_template')}</label>
                  </div>
                )}
              </div>

              {preview && (
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('preview_title')}</h3>
                  <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-sm">
                    <span className="font-medium text-gray-600 dark:text-gray-400">{t('preview_subject')}</span>
                    <span className="text-gray-900 dark:text-gray-100">{preview.subject}</span>
                  </div>
                  <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-600">{t('preview_render')}</div>
                    <iframe
                      srcDoc={preview.html_body}
                      sandbox=""
                      className="w-full min-h-[200px] border-0"
                      title={t('preview_alt')}
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
              {t('select_hint')}
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
