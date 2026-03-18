'use client'

import { useEffect, useState } from 'react'
import { fetchQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply } from '@/lib/api'
import type { QuickReply } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

type FormData = { name: string; content: string; category: string }
const EMPTY_FORM: FormData = { name: '', content: '', category: '' }

export default function QuickRepliesPage() {
  const { isAgent } = useAuth()
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
        <p className="text-gray-500">에이전트 이상 권한이 필요합니다.</p>
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
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    try {
      await deleteQuickReply(id)
      setItems((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">빠른 답변 템플릿</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">자주 사용하는 답변을 등록하면 코멘트 입력 시 빠르게 선택할 수 있습니다.</p>
        </div>
        <button
          onClick={openCreate}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          + 새 답변 추가
        </button>
      </div>

      {error && <p className="text-sm text-red-600">⚠️ {error}</p>}

      {showForm && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{editing ? '빠른 답변 수정' : '새 빠른 답변'}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">이름 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예: 처리 완료 안내"
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">카테고리 (선택)</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="예: 일반, 하드웨어, 소프트웨어"
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">내용 *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                rows={6}
                placeholder="답변 내용을 입력하세요..."
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={closeForm} className="text-sm px-4 py-2 border dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">취소</button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.content.trim()}
              className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">불러오는 중...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-sm">등록된 빠른 답변이 없습니다.</p>
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
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    삭제
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
