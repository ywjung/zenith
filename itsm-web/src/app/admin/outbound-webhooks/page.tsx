'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
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

const SUPPORTED_EVENTS = [
  { value: 'ticket_created', label: '티켓 생성' },
  { value: 'ticket_updated', label: '티켓 수정' },
  { value: 'status_changed', label: '상태 변경' },
  { value: 'comment_added', label: '댓글 추가' },
  { value: 'assigned', label: '담당자 배정' },
  { value: 'sla_warning', label: 'SLA 경고' },
  { value: 'sla_breach', label: 'SLA 위반' },
]


const EMPTY_FORM = { name: '', url: '', secret: '', events: [] as string[], enabled: true }

function WebhooksContent() {
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
      .catch(() => setError('로드 실패'))
      .finally(() => setLoading(false))
  }
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
    if (!form.name || !form.url) { setError('이름과 URL은 필수입니다.'); return }
    if (form.events.length === 0) { setError('이벤트를 하나 이상 선택하세요.'); return }
    setSaving(true); setError(null)
    const body = { name: form.name, url: form.url, secret: form.secret || null, events: form.events, enabled: form.enabled }
    try {
      if (editId) await adminFetch(`/admin/outbound-webhooks/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
      else await adminFetch('/admin/outbound-webhooks', { method: 'POST', body: JSON.stringify(body) })
      setShowForm(false); load()
      setSuccess(editId ? '수정됐습니다.' : '웹훅이 등록됐습니다.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) { setError(errorMessage(e, '저장 실패')) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!(await confirm({ title: '이 웹훅을 삭제할까요?', variant: 'danger', confirmLabel: '확인' }))) return
    try {
      await adminFetch(`/admin/outbound-webhooks/${id}`, { method: 'DELETE' })
      load()
    } catch (e) {
      setError(errorMessage(e, '삭제에 실패했습니다.'))
    }
  }

  const handleTest = async (id: number) => {
    setTesting(id)
    try {
      const res = await adminFetch(`/admin/outbound-webhooks/${id}/test`, { method: 'POST' })
      setSuccess(res?.success ? `테스트 발송 성공 (HTTP ${res.status})` : `테스트 발송 실패 (HTTP ${res?.status})`)
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) { setError(errorMessage(e, '테스트 실패')) }
    finally { setTesting(null) }
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">관리자 권한이 필요합니다.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            아웃바운드 웹훅
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">ITSM 이벤트를 Slack·Teams·외부 시스템에 자동 전송합니다.</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
          + 새 웹훅
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-400 text-sm rounded-lg">✅ {success}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : hooks.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <div className="text-4xl mb-3">🔗</div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">등록된 웹훅이 없습니다.</p>
          <p className="text-sm text-gray-400 mt-1">Slack·Teams와 연동하여 실시간 알림을 받아보세요.</p>
          <button onClick={openCreate} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            첫 웹훅 등록
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
                    {!h.enabled && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">비활성</span>}
                    {h.last_status && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${h.last_status >= 200 && h.last_status < 300 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        마지막 응답: {h.last_status}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{h.url}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {h.events.map(ev => (
                      <span key={ev} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-full px-2 py-0.5">
                        {SUPPORTED_EVENTS.find(e => e.value === ev)?.label ?? ev}
                      </span>
                    ))}
                  </div>
                  {h.last_triggered_at && (
                    <div className="text-xs text-gray-400 mt-1.5">
                      마지막 발송: {new Date(h.last_triggered_at).toLocaleString('ko-KR')}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleTest(h.id)}
                    disabled={testing === h.id}
                    className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing === h.id ? '발송 중...' : '테스트'}
                  </button>
                  <button onClick={() => openEdit(h)} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg hover:bg-gray-50">편집</button>
                  <button onClick={() => handleDelete(h.id)} className="text-xs px-3 py-1.5 border border-red-200 dark:border-red-700 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">삭제</button>
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
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{editId ? '웹훅 편집' : '새 웹훅 등록'}</h2>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">이름 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: Slack IT팀 채널" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">웹훅 URL *</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://hooks.slack.com/services/..." className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">시크릿 키 (선택 — HMAC 서명)</label>
                <input type="password" autoComplete="off" value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  placeholder="변경 시에만 입력" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">이벤트 구독 *</label>
                <div className="grid grid-cols-2 gap-2">
                  {SUPPORTED_EVENTS.map(ev => (
                    <label key={ev.value} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      form.events.includes(ev.value) ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}>
                      <input type="checkbox" checked={form.events.includes(ev.value)} onChange={() => toggleEvent(ev.value)} className="w-4 h-4 text-blue-600" />
                      <span className="text-sm">{ev.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="enabled-wh" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4" />
                <label htmlFor="enabled-wh" className="text-sm text-gray-700 dark:text-gray-300">활성화</label>
              </div>
            </div>
            <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">취소</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium">
                {saving ? '저장 중...' : '저장'}
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
