'use client'

import { useEffect, useState } from 'react'
import { fetchQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } from '@/lib/api'
import type { QuickReply } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { useTranslations } from 'next-intl'

type FormData = { name: string; content: string; category: string }
const EMPTY_FORM: FormData = { name: '', content: '', category: '' }

export default function QuickRepliesPage() {
  const { isAgent } = useAuth()
  const t = useTranslations('admin')
  const [items, setItems] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<QuickReply | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAgent) return
    fetchQuickReplies()
      .then(setItems)
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

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(item: QuickReply) {
    setEditing(item)
    setForm({ name: item.name, content: item.content, category: item.category ?? '' })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.content.trim()) return
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), content: form.content.trim(), category: form.category || undefined }
      if (editing) {
        const updated = await updateQuickReply(editing.id, payload)
        setItems((prev) => prev.map((r) => (r.id === editing.id ? updated : r)))
      } else {
        const created = await createQuickReply(payload)
        setItems((prev) => [...prev, created])
      }
      closeForm()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('quick_replies.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t('quick_replies.delete_confirm'))) return
    try {
      await deleteQuickReply(id)
      setItems((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('quick_replies.delete_failed'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t('quick_replies.title')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('quick_replies.description')}</p>
        </div>
        <button
          onClick={openCreate}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          {t('quick_replies.add_btn')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">⚠️ {error}</p>}

      {showForm && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{editing ? t('quick_replies.edit_title') : t('quick_replies.new_title')}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('quick_replies.field_name')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('quick_replies.field_name_placeholder')}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('quick_replies.field_category')}</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder={t('quick_replies.field_category_placeholder')}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('quick_replies.field_content')}</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                rows={6}
                placeholder={t('quick_replies.field_content_placeholder')}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={closeForm} className="text-sm px-4 py-2 border dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">{t('common.cancel')}</button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.content.trim()}
              className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-sm">{t('quick_replies.no_items')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.name}</span>
                    {item.category && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{item.category}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap line-clamp-3">{item.content}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(item)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
