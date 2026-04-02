'use client'

import { useEffect, useState } from 'react'
import { fetchTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/lib/api'
import type { TicketTemplate } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { useTranslations } from 'next-intl'

type FormData = { name: string; category: string; description: string; enabled: boolean }
const EMPTY_FORM: FormData = { name: '', category: '', description: '', enabled: true }

function TemplatesContent() {
  const { isAgent } = useAuth()
  const { serviceTypes, getEmoji, getLabel } = useServiceTypes()
  const t = useTranslations('admin')

  function catMeta(value: string) {
    const found = serviceTypes.find(t => t.value === value)
    return found ? { icon: found.emoji, label: found.label } : { icon: '📋', label: value }
  }
  const [templates, setTemplates] = useState<TicketTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TicketTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [catFilter, setCatFilter] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!isAgent) return
    fetchTemplates()
      .then(setTemplates)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAgent])

  if (!isAgent) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500">{t('common.no_permission_agent')}</p>
      </div>
    )
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setExpanded(null)
  }

  const openEdit = (t: TicketTemplate) => {
    setEditing(t)
    setForm({ name: t.name, category: t.category || '', description: t.description, enabled: t.enabled })
    setShowForm(true)
    setExpanded(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const payload = { ...form, category: form.category || undefined }
      if (editing) {
        const updated = await updateTemplate(editing.id, payload)
        setTemplates((prev) => prev.map((t) => (t.id === editing.id ? updated : t)))
      } else {
        const created = await createTemplate(payload)
        setTemplates((prev) => [created, ...prev])
      }
      setShowForm(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('templates.save_failed'))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('templates.delete_confirm'))) return
    try {
      await deleteTemplate(id)
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('templates.delete_failed'))
    }
  }

  const handleToggleEnabled = async (tmpl: TicketTemplate) => {
    try {
      const updated = await updateTemplate(tmpl.id, {
        name: tmpl.name,
        category: tmpl.category,
        description: tmpl.description,
        enabled: !tmpl.enabled,
      })
      setTemplates((prev) => prev.map((x) => (x.id === tmpl.id ? updated : x)))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('templates.toggle_failed'))
    }
  }

  const filtered = templates.filter((t) => !catFilter || t.category === catFilter)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {t('templates.title')}
        </h1>
      </div>
      <div className="flex items-start justify-between mb-5 gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('templates.description')}</p>
        <button
          onClick={openCreate}
          className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          {t('templates.add_btn')}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4">⚠️ {error}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-xl p-5 mb-6 shadow-sm">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">{editing ? t('templates.edit_title') : t('templates.new_title')}</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('templates.field_name')}</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
                placeholder={t('templates.field_name_placeholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('templates.field_category')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">{t('templates.field_category_none')}</option>
                {serviceTypes.map((c) => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-5">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('templates.field_content')}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
              rows={7}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              placeholder={t('templates.field_content_placeholder')}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700">{t('common.save')}</button>
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 dark:border-gray-600 px-5 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {/* Category filter tabs */}
      <div className="flex gap-0.5 mb-4 border-b border-gray-200 dark:border-gray-700">
        {[{ value: '', emoji: '📂', label: t('templates.filter_all') }, ...serviceTypes].map((c) => {
          const count = c.value === '' ? templates.length : templates.filter((t) => t.category === c.value).length
          return (
            <button
              key={c.value}
              onClick={() => setCatFilter(c.value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors whitespace-nowrap -mb-px ${
                catFilter === c.value
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <span>{c.emoji}</span>
              <span>{c.label}</span>
              <span className={`text-xs rounded-full px-1.5 min-w-[1.25rem] text-center ${
                catFilter === c.value ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t('common.loading')}</div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-400">
              <div className="text-3xl mb-2">📋</div>
              <p>{t('templates.no_templates')}</p>
            </div>
          )}

          {filtered.map((tmpl) => (
            <div
              key={tmpl.id}
              className={`bg-white dark:bg-gray-800 rounded-xl border transition-all ${tmpl.enabled ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-700/50 opacity-60'}`}
            >
              <div className="px-5 py-4 flex items-center gap-4">
                <button
                  onClick={() => setExpanded(expanded === tmpl.id ? null : tmpl.id)}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0 w-5 text-center"
                >
                  {expanded === tmpl.id ? '▾' : '▸'}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{tmpl.name}</span>
                    {tmpl.category && (
                      <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full border border-blue-100 dark:border-blue-700">
                        {catMeta(tmpl.category).icon} {catMeta(tmpl.category).label}
                      </span>
                    )}
                    {!tmpl.enabled && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{t('templates.inactive_badge')}</span>
                    )}
                  </div>
                  {expanded !== tmpl.id && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{tmpl.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggleEnabled(tmpl)}
                    className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                      tmpl.enabled
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30'
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tmpl.enabled ? t('common.active') : t('common.inactive')}
                  </button>
                  <button onClick={() => openEdit(tmpl)} className="text-xs text-blue-600 hover:underline">{t('common.edit')}</button>
                  <button
                    onClick={() => handleDelete(tmpl.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {expanded === tmpl.id && (
                <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-700">
                  <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 mt-3 leading-relaxed">
                    {tmpl.description}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TemplatesPage() {
  return <TemplatesContent />
}
