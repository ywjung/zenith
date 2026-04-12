'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useConfirm } from '@/components/ConfirmProvider'
import { fetchCustomFieldDefs, createCustomFieldDef, updateCustomFieldDef, deleteCustomFieldDef } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { CustomFieldDef } from '@/types'
import { errorMessage } from '@/lib/utils'

const FIELD_TYPE_VALUES = ['text', 'number', 'select', 'checkbox'] as const
const FIELD_TYPE_KEY: Record<string, string> = {
  text: 'type_text', number: 'type_number', select: 'type_select', checkbox: 'type_checkbox',
}

const EMPTY_FORM = {
  name: '',
  label: '',
  field_type: 'text',
  options: [] as string[],
  required: false,
  sort_order: 0,
}

export default function CustomFieldsPage() {
  const t = useTranslations('admin.custom_fields')
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const [fields, setFields] = useState<CustomFieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [optionInput, setOptionInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const list = await fetchCustomFieldDefs(true)
      setFields(list)
    } catch {
      setError(t('load_failed'))
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setOptionInput('')
    setShowForm(true)
  }

  function openEdit(f: CustomFieldDef) {
    setEditId(f.id)
    setForm({
      name: f.name,
      label: f.label,
      field_type: f.field_type,
      options: f.options || [],
      required: f.required,
      sort_order: f.sort_order,
    })
    setOptionInput('')
    setShowForm(true)
  }

  function addOption() {
    const opt = optionInput.trim()
    if (!opt || form.options.includes(opt)) return
    setForm(prev => ({ ...prev, options: [...prev.options, opt] }))
    setOptionInput('')
  }

  function removeOption(opt: string) {
    setForm(prev => ({ ...prev, options: prev.options.filter(o => o !== opt) }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (editId !== null) {
        await updateCustomFieldDef(editId, {
          label: form.label,
          field_type: form.field_type,
          options: form.options,
          required: form.required,
          sort_order: form.sort_order,
        })
      } else {
        await createCustomFieldDef({
          name: form.name,
          label: form.label,
          field_type: form.field_type,
          options: form.options,
          required: form.required,
          sort_order: form.sort_order,
        })
      }
      setShowForm(false)
      await load()
    } catch (err) {
      setError(errorMessage(err, t('save_failed')))
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(f: CustomFieldDef) {
    try {
      await updateCustomFieldDef(f.id, { enabled: !f.enabled })
      await load()
    } catch {
      setError(t('toggle_failed'))
    }
  }

  async function handleDelete(f: CustomFieldDef) {
    if (!(await confirm({ title: t('delete_confirm', { label: f.label }), variant: 'danger' }))) return
    try {
      await deleteCustomFieldDef(f.id)
      await load()
    } catch {
      setError(t('delete_failed'))
    }
  }

  if (!isAdmin) return <div className="p-6 text-gray-500">{t('no_permission')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {t('add')}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-6 bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
            {editId !== null ? t('edit_title') : t('new_title')}
          </h2>
          <div className="space-y-4">
            {editId === null && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('field_key')} <span className="text-gray-400">{t('field_key_hint')}</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('field_key_placeholder')}
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('field_label_label')}</label>
              <input
                value={form.label}
                onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder={t('field_label_placeholder')}
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('field_type_label')}</label>
              <select
                value={form.field_type}
                onChange={e => setForm(prev => ({ ...prev, field_type: e.target.value, options: [] }))}
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FIELD_TYPE_VALUES.map(v => (
                  <option key={v} value={v}>{t(FIELD_TYPE_KEY[v] as 'type_text')}</option>
                ))}
              </select>
            </div>
            {form.field_type === 'select' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('options_label')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={optionInput}
                    onChange={e => setOptionInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                    placeholder={t('option_placeholder')}
                    className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={addOption} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">{t('add_option')}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.options.map(opt => (
                    <span key={opt} className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full">
                      {opt}
                      <button onClick={() => removeOption(opt)} className="text-blue-400 hover:text-blue-600 leading-none" aria-label={t('option_remove_aria')}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={e => setForm(prev => ({ ...prev, required: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                {t('required')}
              </label>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400">{t('sort_order')}</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={e => setForm(prev => ({ ...prev, sort_order: Number(e.target.value) }))}
                  className="w-16 border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t dark:border-gray-700">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.label.trim() || (editId === null && !form.name.trim())}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition-colors"
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('loading')}</div>
      ) : fields.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p>{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map(f => (
            <div key={f.id} className={`bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 flex items-center gap-4 ${!f.enabled ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{f.label}</span>
                  <span className="text-xs text-gray-400 font-mono">{f.name}</span>
                  {f.required && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">{t('badge_required')}</span>}
                  {!f.enabled && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">{t('badge_inactive')}</span>}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t(FIELD_TYPE_KEY[f.field_type] as 'type_text')}
                  {f.field_type === 'select' && f.options.length > 0 && (
                    <span className="ml-2 text-blue-500">[{f.options.join(', ')}]</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleEnabled(f)}
                  className="text-xs px-2 py-1 rounded border dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {f.enabled ? t('disable') : t('enable')}
                </button>
                <button
                  onClick={() => openEdit(f)}
                  className="text-xs px-2 py-1 rounded border dark:border-gray-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  {t('edit')}
                </button>
                <button
                  onClick={() => handleDelete(f)}
                  className="text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
