'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

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
  created_by: string
  updated_at: string | null
}

const FIELD_TYPES = ['text', 'textarea', 'select', 'date'] as const
const EMPTY_FIELD: FieldDef = { name: '', label: '', type: 'text', required: false }

function FieldEditor({ fields, onChange }: { fields: FieldDef[]; onChange: (fields: FieldDef[]) => void }) {
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
              placeholder="필드 ID (영문)"
              value={f.name}
              onChange={e => update(i, { name: e.target.value })}
              className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              placeholder="레이블"
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
              필수
            </label>
            <button onClick={() => remove(i)} className="text-xs text-red-500 hover:text-red-700 px-1">✕</button>
          </div>
          {f.type === 'select' && (
            <input
              placeholder="선택지 (쉼표 구분)"
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
        + 필드 추가
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
}

const EMPTY_FORM: FormState = {
  name: '', description: '', category: '', icon: '📋',
  fields_schema: [], is_active: true, order: 0,
}

export default function ServiceCatalogAdminPage() {
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '목록 조회 실패')
      setItems(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '목록 조회 실패')
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
    })
    setError(null)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('이름을 입력하세요.'); return }
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
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || '저장 실패')
      }
      setShowModal(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
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
        throw new Error(err.detail || '상태 변경에 실패했습니다.')
      }
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다.')
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`${API_BASE}/service-catalog/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '삭제에 실패했습니다.')
      }
      setDeleteId(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">서비스 카탈로그</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">포털에서 신청 가능한 서비스 항목을 관리합니다.</p>
          </div>
          <button
            onClick={openCreate}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium"
          >
            + 항목 추가
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <div className="text-3xl mb-2">📦</div>
            <p>카탈로그 항목이 없습니다.</p>
            <button onClick={openCreate} className="mt-2 text-blue-600 dark:text-blue-400 hover:underline text-xs">첫 항목 추가하기</button>
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
                      {item.is_active ? '활성' : '비활성'}
                    </span>
                    <span className="text-xs text-gray-400">순서 {item.order}</span>
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.description}</p>
                  )}
                  {item.fields_schema.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      필드 {item.fields_schema.length}개: {item.fields_schema.map(f => f.label || f.name).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleActive(item)}
                    className="text-xs px-2 py-1 border dark:border-gray-600 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    {item.is_active ? '비활성화' : '활성화'}
                  </button>
                  <button
                    onClick={() => openEdit(item)}
                    className="text-xs px-2 py-1 border dark:border-gray-600 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    편집
                  </button>
                  <button
                    onClick={() => setDeleteId(item.id)}
                    className="text-xs px-2 py-1 border border-red-200 dark:border-red-800 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 생성/편집 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b dark:border-gray-700">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {editId ? '카탈로그 항목 편집' : '새 카탈로그 항목'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">이름 *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="예: 노트북 지급 신청"
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">아이콘 (이모지)</label>
                  <input
                    value={form.icon}
                    onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                    placeholder="📦"
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">카테고리</label>
                  <input
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="예: 하드웨어"
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">설명</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder="간단한 항목 설명"
                    className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">표시 순서</label>
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
                    활성화
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  추가 입력 필드 <span className="text-gray-400 font-normal">(포털 신청 시 표시됩니다)</span>
                </label>
                <FieldEditor
                  fields={form.fields_schema}
                  onChange={fields => setForm(f => ({ ...f, fields_schema: fields }))}
                />
              </div>

              {error && <p className="text-xs text-red-600 dark:text-red-400">⚠️ {error}</p>}
            </div>
            <div className="p-5 border-t dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="text-sm px-4 py-2 border dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">항목 삭제</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">이 카탈로그 항목을 삭제할까요?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="text-sm px-3 py-1.5 border dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400">취소</button>
              <button onClick={() => handleDelete(deleteId)} className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-medium">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
