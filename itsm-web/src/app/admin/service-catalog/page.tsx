'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'

interface FieldDef {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'date'
  required: boolean
  options?: string[]  // for select type
}

interface CatalogItem {
  id: number
  name: string
  description: string | null
  category: string | null
  icon: string | null
  fields_schema: FieldDef[]
  is_active: boolean
  order: number
  requires_approval: boolean
  approver_username: string | null
  approval_note: string | null
  created_by: string
  updated_at: string | null
}

const FIELD_TYPES = ['text', 'textarea', 'select', 'date'] as const
const EMPTY_FIELD: FieldDef = { name: '', label: '', type: 'text', required: false }

function FieldEditor({ fields, onChange }: { fields: FieldDef[]; onChange: (fields: FieldDef[]) => void }) {
  const t = useTranslations('admin.service_catalog')
  function update(idx: number, patch: Partial<FieldDef>) {
    const next = fields.map((f, i) => i === idx ? { ...f, ...patch } : f)
    onChange(next)
  }
  function remove(idx: number) { onChange(fields.filter((_, i) => i !== idx)) }
  function add() { onChange([...fields, { ...EMPTY_FIELD }]) }

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="border dark:border-gray-600 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-gray-800/40">
          <div className="flex gap-2">
            <input
              placeholder={t('field_id_placeholder')}
              value={f.name}
              onChange={e => update(i, { name: e.target.value })}
              className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              placeholder={t('field_label_placeholder')}
              value={f.label}
              onChange={e => update(i, { label: e.target.value })}
              className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={f.type}
              onChange={e => update(i, { type: e.target.value as FieldDef['type'] })}
              className="text-xs border dark:border-gray-600 rounded px-1.5 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none"
            >
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
              <input type="checkbox" checked={f.required} onChange={e => update(i, { required: e.target.checked })} />
              {t('required')}
            </label>
            <button onClick={() => remove(i)} className="text-xs text-red-500 hover:text-red-700 px-1" aria-label={t('remove_aria')}>✕</button>
          </div>
          {f.type === 'select' && (
            <input
              placeholder={t('options_placeholder')}
              value={(f.options || []).join(', ')}
              onChange={e => update(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        {t('add_field')}
      </button>
    </div>
  )
}

interface FormState {
  name: string
  description: string
  category: string
  icon: string
  fields_schema: FieldDef[]
  is_active: boolean
  order: number
  requires_approval: boolean
  approver_username: string
  approval_note: string
}

const EMPTY_FORM: FormState = {
  name: '', description: '', category: '', icon: '📋',
  fields_schema: [], is_active: true, order: 0,
  requires_approval: false, approver_username: '', approval_note: '',
}

export default function ServiceCatalogAdminPage() {
  const t = useTranslations('admin.service_catalog')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/service-catalog`, { credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || t('load_failed'))
      setItems(await res.json())
    } catch (e: unknown) {
      setError(errorMessage(e, t('load_failed')))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowModal(true)
  }

  function openEdit(item: CatalogItem) {
    setEditId(item.id)
    setForm({
      name: item.name,
      description: item.description || '',
      category: item.category || '',
      icon: item.icon || '📋',
      fields_schema: item.fields_schema || [],
      is_active: item.is_active,
      order: item.order,
      requires_approval: item.requires_approval ?? false,
      approver_username: item.approver_username || '',
      approval_note: item.approval_note || '',
    })
    setError(null)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError(t('name_required')); return }
    setSaving(true); setError(null)
    try {
      const url = editId ? `${API_BASE}/service-catalog/${editId}` : `${API_BASE}/service-catalog`
      const method = editId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          category: form.category.trim() || null,
          icon: form.icon.trim() || null,
          fields_schema: form.fields_schema,
          is_active: form.is_active,
          order: form.order,
          requires_approval: form.requires_approval,
          approver_username: form.approver_username.trim() || null,
          approval_note: form.approval_note.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || t('save_failed'))
      }
      setShowModal(false)
      await load()
    } catch (err: unknown) {
      setError(errorMessage(err, t('generic_error')))
    } finally { setSaving(false) }
  }

  async function handleToggleActive(item: CatalogItem) {
    try {
      const res = await fetch(`${API_BASE}/service-catalog/${item.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !item.is_active }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || t('toggle_failed'))
      }
      await load()
    } catch (e: unknown) {
      setError(errorMessage(e, t('toggle_failed')))
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`${API_BASE}/service-catalog/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || t('delete_failed'))
      }
      setDeleteId(null)
      await load()
    } catch (e: unknown) {
      setError(errorMessage(e, t('delete_failed')))
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              {t('title')}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('subtitle')}</p>
          </div>
          <button
            onClick={openCreate}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium"
          >
            {t('add_item')}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">{t('loading')}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <div className="text-3xl mb-2">📦</div>
            <p>{t('empty')}</p>
            <button onClick={openCreate} className="mt-2 text-blue-600 dark:text-blue-400 hover:underline text-xs">{t('add_first')}</button>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div
                key={item.id}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                  item.is_active
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                    : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 opacity-60'
                }`}
              >
                <span className="text-2xl shrink-0 mt-0.5">{item.icon || '📋'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{item.name}</span>
                    {item.category && (
                      <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">{item.category}</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      item.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                    }`}>
                      {item.is_active ? t('active') : t('inactive')}
                    </span>
                    <span className="text-xs text-gray-400">{t('order_prefix', { n: item.order })}</span>
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.description}</p>
                  )}
                  {item.fields_schema.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {t('fields_count', { n: item.fields_schema.length, list: item.fields_schema.map(f => f.label || f.name).join(', ') })}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleActive(item)}
                    className="text-xs px-2 py-1 border dark:border-gray-600 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    {item.is_active ? t('disable') : t('enable')}
                  </button>
                  <button
                    onClick={() => openEdit(item)}
                    className="text-xs px-2 py-1 border dark:border-gray-600 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    {t('edit')}
                  </button>
                  <button
                    onClick={() => setDeleteId(item.id)}
                    className="text-xs px-2 py-1 border border-red-200 dark:border-red-800 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 생성/편집 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scaleIn">
            <div className="p-5 border-b dark:border-gray-700">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {editId ? t('edit_title') : t('new_title')}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('name_label')}</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t('name_placeholder')}
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('icon_label')}</label>
                  <input
                    value={form.icon}
                    onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                    placeholder="📦"
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('category_label')}</label>
                  <input
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder={t('category_placeholder')}
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('description_label')}</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder={t('description_placeholder')}
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('order_label')}</label>
                  <input
                    type="number"
                    value={form.order}
                    onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))}
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="rounded"
                    />
                    {t('enabled_toggle')}
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  {t('extra_fields_label')} <span className="text-gray-400 font-normal">{t('extra_fields_hint')}</span>
                </label>
                <FieldEditor
                  fields={form.fields_schema}
                  onChange={fields => setForm(f => ({ ...f, fields_schema: fields }))}
                />
              </div>

              {/* 승인 워크플로우 */}
              <div className="border-t dark:border-gray-700 pt-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={form.requires_approval}
                    onChange={e => setForm(f => ({ ...f, requires_approval: e.target.checked }))}
                    className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
                  />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {t('approval_required')} <span className="text-gray-400 font-normal">{t('approval_required_hint')}</span>
                  </span>
                </label>
                {form.requires_approval && (
                  <div className="space-y-2 ml-5">
                    <input
                      placeholder={t('approver_placeholder')}
                      value={form.approver_username}
                      onChange={e => setForm(f => ({ ...f, approver_username: e.target.value }))}
                      className="w-full text-xs border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <textarea
                      placeholder={t('approval_note_placeholder')}
                      value={form.approval_note}
                      onChange={e => setForm(f => ({ ...f, approval_note: e.target.value }))}
                      rows={2}
                      className="w-full text-xs border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    />
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400">⚠️ {error}</p>}
            </div>
            <div className="p-5 border-t dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="text-sm px-4 py-2 border dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 max-w-sm w-full animate-scaleIn">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">{t('delete_title')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('delete_confirm')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="text-sm px-3 py-1.5 border dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400">{t('cancel')}</button>
              <button onClick={() => handleDelete(deleteId)} className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-medium">{t('delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
