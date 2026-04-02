'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useTranslations } from 'next-intl'

interface Announcement {
  id: number
  title: string
  content: string
  type: 'info' | 'warning' | 'critical'
  enabled: boolean
  expires_at: string | null
  created_by: string
  created_at: string
}

const TYPE_STYLE = {
  info:     { icon: 'ℹ️', bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-400',  text: 'text-blue-800 dark:text-blue-300',   badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  warning:  { icon: '⚠️', bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-400', text: 'text-yellow-800 dark:text-yellow-300', badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' },
  critical: { icon: '🚨', bg: 'bg-red-50 dark:bg-red-900/20',       border: 'border-red-500',   text: 'text-red-900 dark:text-red-300',    badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
}

const EMPTY: Omit<Announcement, 'id' | 'created_by' | 'created_at'> = {
  title: '', content: '', type: 'info', enabled: true, expires_at: null,
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function PreviewBanner({ title, content, type }: { title: string; content: string; type: string }) {
  const cfg = TYPE_STYLE[type as keyof typeof TYPE_STYLE] ?? TYPE_STYLE.info
  if (!title && !content) return null
  return (
    <div className={`border-l-4 px-4 py-2.5 flex items-start gap-3 text-sm rounded-r-lg ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className="shrink-0 text-base">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        {title && <span className="font-semibold">{title}</span>}
        {content && <span className="ml-2 opacity-80">{content}</span>}
      </div>
      <button className="shrink-0 opacity-50 text-lg leading-none" disabled>×</button>
    </div>
  )
}

export default function AnnouncementsPage() {
  const t = useTranslations('admin')

  const TYPE_CONFIG = {
    info:     { ...TYPE_STYLE.info,     label: t('announcements.type_info_label') },
    warning:  { ...TYPE_STYLE.warning,  label: t('announcements.type_warning_label') },
    critical: { ...TYPE_STYLE.critical, label: t('announcements.type_critical_label') },
  }

  const [list, setList] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState<number | null>(null)      // null = 신규
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/announcements`, { credentials: 'include' })
      if (r.ok) setList(await r.json())
      else setError(t('announcements.load_error'))
    } catch { setError(t('announcements.network_error')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY })
    setShowForm(true)
    setError('')
  }

  function openEdit(ann: Announcement) {
    setEditId(ann.id)
    setForm({
      title: ann.title,
      content: ann.content,
      type: ann.type,
      enabled: ann.enabled,
      expires_at: ann.expires_at ? ann.expires_at.slice(0, 16) : null,  // datetime-local format
    })
    setShowForm(true)
    setError('')
  }

  async function handleSave() {
    if (!form.title.trim()) { setError(t('announcements.field_title_required')); return }
    setSaving(true)
    setError('')
    const body = {
      ...form,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    }
    try {
      const url = editId !== null
        ? `${API_BASE}/admin/announcements/${editId}`
        : `${API_BASE}/admin/announcements`
      const r = await fetch(url, {
        method: editId !== null ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.detail ?? t('announcements.save_failed'))
      } else {
        setShowForm(false)
        await load()
      }
    } catch { setError(t('announcements.network_error')) }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    const r = await fetch(`${API_BASE}/admin/announcements/${id}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (r.ok) { setDeleteConfirm(null); await load() }
    else setError(t('announcements.delete_failed'))
  }

  async function toggleEnabled(ann: Announcement) {
    try {
      const r = await fetch(`${API_BASE}/admin/announcements/${ann.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ann, enabled: !ann.enabled }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.detail ?? t('announcements.toggle_failed'))
        return
      }
      await load()
    } catch { setError(t('announcements.network_error')) }
  }

  const activeCount = list.filter(a => a.enabled).length

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              {t('announcements.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('announcements.description')}
            </p>
            <div className="flex gap-3 mt-3 text-sm">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                {t('announcements.total_count')} <strong className="text-gray-900 dark:text-gray-100">{list.length}개</strong>
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${activeCount > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                {t('announcements.active_count')} <strong>{activeCount}개</strong>
              </span>
            </div>
          </div>
          <button
            onClick={openNew}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            {t('announcements.add_btn')}
          </button>
        </div>
      </div>

      {/* 유형 안내 */}
      <div className="grid grid-cols-3 gap-3">
        {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG.info][]).map(([key, cfg]) => (
          <div key={key} className={`rounded-xl border-l-4 px-4 py-3 ${cfg.bg} ${cfg.border}`}>
            <div className="flex items-center gap-2">
              <span>{cfg.icon}</span>
              <span className={`font-semibold text-sm ${cfg.text}`}>{cfg.label}</span>
            </div>
            <p className={`text-xs mt-1 ${cfg.text} opacity-70`}>
              {key === 'info'     && t('announcements.type_info_desc')}
              {key === 'warning'  && t('announcements.type_warning_desc')}
              {key === 'critical' && t('announcements.type_critical_desc')}
            </p>
          </div>
        ))}
      </div>

      {/* 오류 메시지 */}
      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-blue-200 dark:border-blue-700 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20 rounded-t-2xl">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">
              {editId !== null ? t('announcements.edit_title') : t('announcements.new_title')}
            </h3>
            <button
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
            >×</button>
          </div>

          <div className="p-6 space-y-5">
            {/* 유형 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('announcements.field_type')}</label>
              <div className="flex gap-3">
                {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG.info][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: key as Announcement['type'] }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                      form.type === key
                        ? `${cfg.bg} ${cfg.border} ${cfg.text}`
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <span>{cfg.icon}</span> {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 제목 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('announcements.field_title')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t('announcements.field_title_placeholder')}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
                maxLength={200}
              />
            </div>

            {/* 내용 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('announcements.field_content')}</label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={t('announcements.field_content_placeholder')}
                rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none dark:bg-gray-700 dark:text-gray-200"
                maxLength={500}
              />
            </div>

            {/* 만료일시 + 활성화 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('announcements.field_expires_at')} <span className="text-gray-400 dark:text-gray-500 font-normal">{t('announcements.field_expires_at_hint')}</span>
                </label>
                <input
                  type="datetime-local"
                  value={form.expires_at ?? ''}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value || null }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('announcements.field_enabled')}</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    form.enabled
                      ? 'bg-green-50 border-green-400 text-green-700 dark:bg-green-900/20 dark:border-green-600 dark:text-green-400'
                      : 'bg-gray-50 border-gray-300 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400'
                  }`}
                >
                  <span className="text-base">{form.enabled ? '✅' : '⏸️'}</span>
                  {form.enabled ? t('announcements.status_active') : t('announcements.status_inactive')}
                </button>
              </div>
            </div>

            {/* 미리보기 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('announcements.preview_title')}</label>
              <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-700/50">
                <PreviewBanner title={form.title} content={form.content} type={form.type} />
                {!form.title && !form.content && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">{t('announcements.preview_empty')}</p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
                ⚠️ {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                {saving ? t('common.saving') : editId !== null ? t('announcements.update_btn') : t('announcements.save_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm animate-pulse">{t('common.loading')}</div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-4xl mb-3">📢</p>
            <p className="text-gray-500 text-sm">{t('announcements.no_announcements')}</p>
            <button onClick={openNew} className="mt-3 text-blue-600 text-sm hover:underline">
              {t('announcements.add_first')}
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3 text-left w-20">{t('announcements.col_type')}</th>
                <th className="px-5 py-3 text-left">{t('announcements.col_title')}</th>
                <th className="px-5 py-3 text-center w-24">{t('announcements.col_status')}</th>
                <th className="px-5 py-3 text-left w-36">{t('announcements.col_expires')}</th>
                <th className="px-5 py-3 text-left w-32">{t('announcements.col_author')}</th>
                <th className="px-5 py-3 text-center w-28">{t('announcements.col_manage')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {list.map(ann => {
                const cfg = TYPE_CONFIG[ann.type] ?? TYPE_CONFIG.info
                const isExpired = ann.expires_at ? new Date(ann.expires_at) < new Date() : false
                return (
                  <tr key={ann.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${!ann.enabled || isExpired ? 'opacity-50' : ''}`}>
                    {/* 유형 */}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>

                    {/* 제목 / 내용 */}
                    <td className="px-5 py-3 max-w-0">
                      <div className={`border-l-4 pl-3 ${cfg.border}`}>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{ann.title}</p>
                        {ann.content && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{ann.content}</p>
                        )}
                      </div>
                    </td>

                    {/* 상태 */}
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => toggleEnabled(ann)}
                        title={ann.enabled ? t('announcements.toggle_deactivate_title') : t('announcements.toggle_activate_title')}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          ann.enabled && !isExpired
                            ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30'
                            : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                        }`}
                      >
                        {isExpired ? t('announcements.status_expired') : ann.enabled ? t('announcements.status_visible') : t('announcements.status_hidden')}
                      </button>
                    </td>

                    {/* 만료 */}
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {ann.expires_at ? (
                        <span className={isExpired ? 'text-red-500 font-medium' : ''}>
                          {formatDate(ann.expires_at)}
                          {isExpired && ` ${t('announcements.expires_label')}`}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">{t('announcements.expires_indefinite')}</span>
                      )}
                    </td>

                    {/* 등록자/일시 */}
                    <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
                      <div>{ann.created_by}</div>
                      <div>{formatDate(ann.created_at)}</div>
                    </td>

                    {/* 관리 버튼 */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(ann)}
                          className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          {t('common.edit')}
                        </button>
                        {deleteConfirm === ann.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDelete(ann.id)}
                              className="text-xs px-2 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                              {t('common.delete')}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(ann.id)}
                            className="text-xs px-3 py-1.5 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 사용 안내 */}
      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
        <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-3">{t('announcements.guide_title')}</h4>
        <ul className="text-xs text-amber-700 dark:text-amber-500 space-y-2 leading-relaxed">
          <li>• {t('announcements.guide_1')}</li>
          <li>• {t('announcements.guide_2')}</li>
          <li>• {t('announcements.guide_3')}</li>
          <li>• {t('announcements.guide_4')}</li>
          <li>• {t('announcements.guide_5')}</li>
          <li>• {t('announcements.guide_6')}</li>
        </ul>
      </div>
    </div>
  )
}
