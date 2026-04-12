'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { adminFetch } from '@/lib/adminFetch'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'
import { useConfirm } from '@/components/ConfirmProvider'
import { errorMessage } from '@/lib/utils'

interface OutboundWebhook {
  id: number
  name: string
  url: string
  events: string[]
  enabled: boolean
  created_by: string
  created_at: string | null
  last_triggered_at: string | null
  last_status: number | null
}

const EVENT_VALUES = [
  'ticket_created',
  'ticket_updated',
  'status_changed',
  'comment_added',
  'assigned',
  'sla_warning',
  'sla_breach',
] as const

const EVENT_I18N_KEY: Record<string, string> = {
  ticket_created: 'ev_ticket_created',
  ticket_updated: 'ev_ticket_updated',
  status_changed: 'ev_status_changed',
  comment_added:  'ev_comment_added',
  assigned:       'ev_assigned',
  sla_warning:    'ev_sla_warning',
  sla_breach:     'ev_sla_breach',
}

const EMPTY_FORM = { name: '', url: '', secret: '', events: [] as string[], enabled: true }

function WebhooksContent() {
  const t = useTranslations('admin.outbound_webhooks')
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const [hooks, setHooks] = useState<OutboundWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    adminFetch('/admin/outbound-webhooks')
      .then(data => setHooks(data ?? []))
      .catch(() => setError(t('load_failed')))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [])

  const openCreate = () => { setForm({ ...EMPTY_FORM }); setEditId(null); setShowForm(true); setError(null) }
  const openEdit = (h: OutboundWebhook) => {
    setForm({ name: h.name, url: h.url, secret: '', events: h.events, enabled: h.enabled })
    setEditId(h.id); setShowForm(true); setError(null)
  }

  const toggleEvent = (ev: string) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev],
    }))
  }

  const handleSave = async () => {
    if (!form.name || !form.url) { setError(t('required_name_url')); return }
    if (form.events.length === 0) { setError(t('required_events')); return }
    setSaving(true); setError(null)
    const body = { name: form.name, url: form.url, secret: form.secret || null, events: form.events, enabled: form.enabled }
    try {
      if (editId) await adminFetch(`/admin/outbound-webhooks/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
      else await adminFetch('/admin/outbound-webhooks', { method: 'POST', body: JSON.stringify(body) })
      setShowForm(false); load()
      setSuccess(editId ? t('updated') : t('created'))
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) { setError(errorMessage(e, t('save_failed'))) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!(await confirm({ title: t('delete_confirm'), variant: 'danger' }))) return
    try {
      await adminFetch(`/admin/outbound-webhooks/${id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(errorMessage(e, t('delete_failed')))
    }
  }

  const handleTest = async (id: number) => {
    setTesting(id)
    try {
      const res = await adminFetch(`/admin/outbound-webhooks/${id}/test`, { method: 'POST' })
      setSuccess(res?.success ? t('test_success', { status: res.status }) : t('test_failed_http', { status: res?.status ?? '-' }))
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) { setError(errorMessage(e, t('test_failed'))) }
    finally { setTesting(null) }
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">{t('no_permission')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
          {t('new')}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 text-sm rounded-lg">✅ {success}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('loading')}</div>
      ) : hooks.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <div className="text-4xl mb-3">🔗</div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t('empty_title')}</p>
          <p className="text-sm text-gray-400 mt-1">{t('empty_hint')}</p>
          <button onClick={openCreate} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            {t('empty_cta')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {hooks.map(h => (
            <div key={h.id} className={`bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-5 ${!h.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${h.enabled ? 'bg-green-400' : 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{h.name}</span>
                    {!h.enabled && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">{t('disabled_badge')}</span>}
                    {h.last_status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${h.last_status >= 200 && h.last_status < 300 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {t('last_status', { status: h.last_status })}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{h.url}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {h.events.map(ev => (
                      <span key={ev} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-full px-2 py-0.5">
                        {EVENT_I18N_KEY[ev] ? t(EVENT_I18N_KEY[ev] as 'ev_ticket_created') : ev}
                      </span>
                    ))}
                  </div>
                  {h.last_triggered_at && (
                    <div className="text-xs text-gray-400 mt-1.5">
                      {t('last_triggered', { date: new Date(h.last_triggered_at).toLocaleString() })}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleTest(h.id)}
                    disabled={testing === h.id}
                    className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing === h.id ? t('sending') : t('test')}
                  </button>
                  <button onClick={() => openEdit(h)} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg hover:bg-gray-50">{t('edit')}</button>
                  <button onClick={() => handleDelete(h.id)} className="text-xs px-3 py-1.5 border border-red-200 dark:border-red-700 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">{t('delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scaleIn">
            <div className="p-6 border-b dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{editId ? t('form_edit_title') : t('form_new_title')}</h2>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('field_name')}</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('field_name_placeholder')} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('field_url')}</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder={t('field_url_placeholder')} className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('field_secret')}</label>
                <input type="password" autoComplete="off" value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  placeholder={t('field_secret_placeholder')} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('field_events')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_VALUES.map(value => (
                    <label key={value} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      form.events.includes(value) ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}>
                      <input type="checkbox" checked={form.events.includes(value)} onChange={() => toggleEvent(value)} className="w-4 h-4 text-blue-600" />
                      <span className="text-sm">{t(EVENT_I18N_KEY[value] as 'ev_ticket_created')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="enabled-wh" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4" />
                <label htmlFor="enabled-wh" className="text-sm text-gray-700 dark:text-gray-300">{t('enabled')}</label>
              </div>
            </div>
            <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">{t('cancel')}</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium">
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OutboundWebhooksPage() {
  return <RequireAuth><WebhooksContent /></RequireAuth>
}
