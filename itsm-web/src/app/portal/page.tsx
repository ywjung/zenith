'use client'

import { useEffect, useState } from 'react'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { API_BASE } from '@/lib/constants'
import { useTranslations } from 'next-intl'

const PRIORITIES = [
  { value: 'low', color: 'text-gray-600 dark:text-gray-400' },
  { value: 'medium', color: 'text-blue-600 dark:text-blue-400' },
  { value: 'high', color: 'text-orange-600 dark:text-orange-400' },
  { value: 'critical', color: 'text-red-600 dark:text-red-400' },
]

interface CatalogItem {
  id: number
  name: string
  description: string | null
  category: string | null
  icon: string | null
  fields_schema: { name: string; label: string; type: string; required: boolean; options?: string[] }[]
}

export default function PortalPage() {
  const t = useTranslations()
  const { serviceTypes } = useServiceTypes()

  // 카탈로그
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogItem | null>(null)
  const [extraFields, setExtraFields] = useState<Record<string, string>>({})

  // 폼
  const [form, setForm] = useState({
    name: '',
    email: '',
    title: '',
    content: '',
    category: '',
    priority: 'medium',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ticket_iid: number; track_url: string } | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/service-catalog/public`)
      .then(r => r.ok ? r.json() : [])
      .then(setCatalogItems)
      .catch(() => {})
  }, [])

  function selectCatalog(item: CatalogItem) {
    setSelectedCatalog(item)
    setForm(f => ({ ...f, title: item.name, category: item.category || '' }))
    setExtraFields({})
  }

  function clearCatalog() {
    setSelectedCatalog(null)
    setExtraFields({})
    setForm(f => ({ ...f, title: '', category: '' }))
  }

  function buildContent(): string {
    let base = form.content
    if (selectedCatalog && Object.keys(extraFields).length > 0) {
      const extras = selectedCatalog.fields_schema
        .filter(f => extraFields[f.name])
        .map(f => `**${f.label}:** ${extraFields[f.name]}`)
        .join('\n')
      if (extras) base = extras + (base ? '\n\n' + base : '')
    }
    return base
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/portal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          title: form.title,
          content: buildContent(),
          category: form.category || undefined,
          priority: form.priority,
          catalog_item_id: selectedCatalog?.id ?? undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || t('portal.submit_failed'))
      }
      const data = await res.json()
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.error'))
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('portal.success_title')}</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          {t('portal.success_msg', { iid: result.ticket_iid })}
        </p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          {t('portal.success_hint')}
        </p>
        {result.track_url ? (
          <a
            href={result.track_url}
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            {t('portal.check_status')}
          </a>
        ) : null}
        <div className="mt-4">
          <a href="/portal" className="text-sm text-gray-500 dark:text-gray-400 hover:underline">
            {t('portal.submit_another') || '새 요청 제출'}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('portal.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {t('portal.no_gitlab')}
        </p>
      </div>

      {/* 서비스 카탈로그 */}
      {catalogItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('portal.catalog_title')} <span className="text-gray-400 dark:text-gray-500 font-normal">{t('portal.catalog_optional')}</span></h2>
            {selectedCatalog && (
              <button onClick={clearCatalog} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">{t('portal.catalog_reset')}</button>
            )}
          </div>

          {/* 카탈로그 카드 그리드 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {catalogItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectedCatalog?.id === item.id ? clearCatalog() : selectCatalog(item)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  selectedCatalog?.id === item.id
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-300 dark:ring-blue-700'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="text-xl mb-1">{item.icon || '📋'}</div>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">{item.description}</div>
                )}
              </button>
            ))}
          </div>

          {/* 선택된 카탈로그의 추가 필드 */}
          {selectedCatalog && selectedCatalog.fields_schema.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{selectedCatalog.icon} {selectedCatalog.name} — {t('portal.catalog_extra_info')}</p>
              {selectedCatalog.fields_schema.map(field => (
                <div key={field.name}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={extraFields[field.name] || ''}
                      onChange={e => setExtraFields(f => ({ ...f, [field.name]: e.target.value }))}
                      rows={3}
                      required={field.required}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={extraFields[field.name] || ''}
                      onChange={e => setExtraFields(f => ({ ...f, [field.name]: e.target.value }))}
                      required={field.required}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{t('portal.select_placeholder')}</option>
                      {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.type === 'date' ? (
                    <input
                      type="date"
                      value={extraFields[field.name] || ''}
                      onChange={e => setExtraFields(f => ({ ...f, [field.name]: e.target.value }))}
                      required={field.required}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={extraFields[field.name] || ''}
                      onChange={e => setExtraFields(f => ({ ...f, [field.name]: e.target.value }))}
                      required={field.required}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Contact Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('portal.requester_info')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portal.name_label')} *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder="홍길동"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portal.email_label')} *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                placeholder="hong@company.com"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Request Details */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('portal.request_detail')}</h2>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portal.subject_label')} *</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              maxLength={200}
              placeholder={t('portal.subject_placeholder')}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portal.content_label')} *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              required
              rows={6}
              placeholder={t('portal.content_placeholder')}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Category */}
        {serviceTypes.filter((t) => t.enabled).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('portal.category_label')} {t('portal.catalog_optional')}</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: '' }))}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                  form.category === ''
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {t('portal.uncategorized')}
              </button>
              {serviceTypes
                .filter((t) => t.enabled)
                .map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                      form.category === c.value
                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Priority */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('portal.priority_label')}</h2>
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, priority: p.value }))}
                className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                  form.priority === p.value
                    ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <span className={p.color}>{t(`ticket.priority.${p.value}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between gap-4">
          {error && <span className="text-sm text-red-600 dark:text-red-400">⚠️ {error}</span>}
          <div className="ml-auto">
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? t('portal.submitting') : t('portal.submit_btn')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
