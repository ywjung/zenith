'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

// cron 프리셋
const CRON_PRESETS = [
  { label: '매일 09:00', value: '0 9 * * *' },
  { label: '매주 월요일 09:00', value: '0 9 * * 1' },
  { label: '매월 1일 09:00', value: '0 9 1 * *' },
  { label: '매 분기 첫날 09:00', value: '0 9 1 1,4,7,10 *' },
]

const CATEGORY_OPTIONS = [
  { value: 'hardware', label: '하드웨어' },
  { value: 'software', label: '소프트웨어' },
  { value: 'network', label: '네트워크' },
  { value: 'account', label: '계정/권한' },
  { value: 'other', label: '기타' },
]

const PRIORITY_OPTIONS = [
  { value: 'critical', label: '긴급' },
  { value: 'high', label: '높음' },
  { value: 'medium', label: '보통' },
  { value: 'low', label: '낮음' },
]

interface RecurringTicket {
  id: number
  title: string
  description: string | null
  category: string
  priority: string
  project_id: string
  cron_expr: string
  cron_label: string | null
  is_active: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_by: string
}

const API = process.env.NEXT_PUBLIC_API_BASE_URL || '/api'

function RecurringTicketsContent() {
  const { isAdmin } = useAuth()
  const [items, setItems] = useState<RecurringTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', category: 'other', priority: 'medium',
    project_id: '', cron_expr: '0 9 1 * *', cron_label: '', is_active: true,
  })

  async function load() {
    try {
      const res = await fetch(`${API}/admin/recurring-tickets`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setItems(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/admin/recurring-tickets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, project_id: form.project_id || '1' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${res.status}`)
      }
      setShowForm(false)
      setForm({ title: '', description: '', category: 'other', priority: 'medium', project_id: '', cron_expr: '0 9 1 * *', cron_label: '', is_active: true })
      await load()
    } catch (e) {
      alert(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggle(id: number, is_active: boolean) {
    await fetch(`${API}/admin/recurring-tickets/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active }),
    })
    await load()
  }

  async function handleDelete(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    await fetch(`${API}/admin/recurring-tickets/${id}`, { method: 'DELETE', credentials: 'include' })
    await load()
  }

  async function handleRunNow(id: number) {
    await fetch(`${API}/admin/recurring-tickets/${id}/run-now`, { method: 'POST', credentials: 'include' })
    alert('태스크가 큐에 추가되었습니다.')
  }

  if (!isAdmin) return <p className="p-6 text-red-600">관리자 권한이 필요합니다.</p>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">반복 티켓</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">정기적으로 자동 생성되는 티켓을 관리합니다.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + 반복 티켓 추가
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 mb-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">새 반복 티켓</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">제목 *</label>
              <input
                required
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">카테고리</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">우선순위</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500">
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">실행 일정 (Cron)</label>
              <div className="flex gap-2">
                <select
                  onChange={e => setForm(f => ({ ...f, cron_expr: e.target.value, cron_label: CRON_PRESETS.find(p => p.value === e.target.value)?.label || '' }))}
                  className="border dark:border-gray-600 rounded px-2 py-2 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">프리셋 선택</option>
                  {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <input
                  required
                  value={form.cron_expr}
                  onChange={e => setForm(f => ({ ...f, cron_expr: e.target.value }))}
                  placeholder="0 9 1 * *"
                  className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm font-mono dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">분 시 일 월 요일 — 예: 0 9 1 * * (매월 1일 09:00)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">일정 설명 (선택)</label>
              <input
                value={form.cron_label}
                onChange={e => setForm(f => ({ ...f, cron_label: e.target.value }))}
                placeholder="예: 매월 첫날 정기 점검"
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">내용 (선택)</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              {submitting ? '저장 중...' : '저장'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded text-sm hover:bg-gray-200 dark:hover:bg-gray-600">
              취소
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-sm">로딩 중...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <p className="text-4xl mb-2">🔄</p>
          <p className="font-medium">등록된 반복 티켓이 없습니다</p>
          <p className="text-sm mt-1">+ 반복 티켓 추가 버튼으로 첫 번째 반복 티켓을 만들어보세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className={`bg-white dark:bg-gray-900 border rounded-lg p-4 ${!item.is_active ? 'opacity-60' : ''} dark:border-gray-700`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                      {item.is_active ? '활성' : '비활성'}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{item.cron_expr}</span>
                    {item.cron_label && <span className="text-xs text-gray-500 dark:text-gray-400">{item.cron_label}</span>}
                  </div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mt-1">{item.title}</h3>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>카테고리: {CATEGORY_OPTIONS.find(o => o.value === item.category)?.label ?? item.category}</span>
                    <span>우선순위: {PRIORITY_OPTIONS.find(o => o.value === item.priority)?.label ?? item.priority}</span>
                    {item.last_run_at && <span>마지막 실행: {new Date(item.last_run_at).toLocaleString('ko-KR')}</span>}
                    {item.next_run_at && <span>다음 실행: {new Date(item.next_run_at).toLocaleString('ko-KR')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleRunNow(item.id)}
                    title="지금 실행"
                    className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50"
                  >
                    실행
                  </button>
                  <button
                    onClick={() => handleToggle(item.id, !item.is_active)}
                    className={`text-xs px-2 py-1 rounded ${item.is_active ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200'}`}
                  >
                    {item.is_active ? '비활성화' : '활성화'}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200"
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

export default function RecurringTicketsPage() {
  return (
    <RequireAuth>
      <RecurringTicketsContent />
    </RequireAuth>
  )
}
