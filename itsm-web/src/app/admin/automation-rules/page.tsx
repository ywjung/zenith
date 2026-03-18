'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface AutomationRule {
  id: number
  name: string
  description: string | null
  trigger_event: string
  conditions: Condition[]
  actions: Action[]
  is_active: boolean
  order: number
  created_by: string
  created_at: string
  updated_at: string
}

interface Condition {
  field: string
  operator: string
  value: string
}

interface Action {
  type: string
  value: string
}

const TRIGGER_EVENTS = [
  { value: 'ticket.created', label: '티켓 생성' },
  { value: 'ticket.status_changed', label: '상태 변경' },
  { value: 'ticket.assigned', label: '담당자 배정' },
  { value: 'ticket.priority_changed', label: '우선순위 변경' },
  { value: 'ticket.commented', label: '댓글 등록' },
]

const CONDITION_FIELDS = [
  { value: 'priority', label: '우선순위' },
  { value: 'category', label: '카테고리' },
  { value: 'status', label: '상태' },
  { value: 'assignee', label: '담당자 username' },
  { value: 'title', label: '제목' },
]

const CONDITION_OPS = [
  { value: 'eq', label: '같음 (=)' },
  { value: 'neq', label: '다름 (≠)' },
  { value: 'contains', label: '포함' },
  { value: 'in', label: '목록 중 하나 (쉼표 구분)' },
]

const ACTION_TYPES = [
  { value: 'set_status', label: '상태 변경', placeholder: 'in_progress' },
  { value: 'assign', label: '담당자 배정', placeholder: 'username' },
  { value: 'add_label', label: '라벨 추가', placeholder: 'urgent' },
  { value: 'notify', label: '알림 전송', placeholder: 'assignee | submitter | admin' },
  { value: 'set_priority', label: '우선순위 변경', placeholder: 'high' },
]

const EMPTY_RULE = {
  name: '',
  description: '',
  trigger_event: 'ticket.created',
  conditions: [] as Condition[],
  actions: [] as Action[],
  is_active: true,
  order: 0,
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

export default function AutomationRulesPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [form, setForm] = useState({ ...EMPTY_RULE })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function loadRules() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/automation-rules')
      setRules(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRules() }, [])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_RULE })
    setSaveError(null)
    setShowForm(true)
  }

  function openEdit(rule: AutomationRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      description: rule.description || '',
      trigger_event: rule.trigger_event,
      conditions: rule.conditions,
      actions: rule.actions,
      is_active: rule.is_active,
      order: rule.order,
    })
    setSaveError(null)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        trigger_event: form.trigger_event,
        conditions: form.conditions,
        actions: form.actions,
        is_active: form.is_active,
        order: form.order,
      }
      if (editing) {
        await apiFetch(`/automation-rules/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await apiFetch('/automation-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setShowForm(false)
      await loadRules()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('이 규칙을 삭제할까요?')) return
    try {
      await apiFetch(`/automation-rules/${id}`, { method: 'DELETE' })
      setRules(r => r.filter(x => x.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '삭제 실패')
    }
  }

  async function handleToggle(rule: AutomationRule) {
    try {
      const updated = await apiFetch(`/automation-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      })
      if (updated) {
        setRules(r => r.map(x => x.id === rule.id ? updated : x))
      } else {
        await loadRules()
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '변경 실패')
    }
  }

  function addCondition() {
    setForm(f => ({ ...f, conditions: [...f.conditions, { field: 'priority', operator: 'eq', value: '' }] }))
  }

  function removeCondition(i: number) {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))
  }

  function updateCondition(i: number, key: keyof Condition, value: string) {
    setForm(f => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [key]: value } : c) }))
  }

  function addAction() {
    setForm(f => ({ ...f, actions: [...f.actions, { type: 'set_status', value: '' }] }))
  }

  function removeAction(i: number) {
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }))
  }

  function updateAction(i: number, key: keyof Action, value: string) {
    setForm(f => ({ ...f, actions: f.actions.map((a, idx) => idx === i ? { ...a, [key]: value } : a) }))
  }

  const TRIGGER_LABEL = Object.fromEntries(TRIGGER_EVENTS.map(e => [e.value, e.label]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">자동화 규칙</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">이벤트 발생 시 자동으로 실행할 액션을 정의합니다.</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + 새 규칙
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">등록된 자동화 규칙이 없습니다.</p>
          <button onClick={openCreate} className="mt-3 text-blue-600 dark:text-blue-400 text-sm hover:underline">
            첫 번째 규칙 만들기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <div
              key={rule.id}
              className={`bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-4 shadow-sm ${!rule.is_active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{rule.name}</span>
                    <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                      {TRIGGER_LABEL[rule.trigger_event] || rule.trigger_event}
                    </span>
                    {!rule.is_active && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">비활성</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{rule.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {rule.conditions.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        <span className="font-medium">조건:</span>{' '}
                        {rule.conditions.map((c, i) => (
                          <span key={i} className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded mr-1">
                            {c.field} {c.operator} &ldquo;{c.value}&rdquo;
                          </span>
                        ))}
                      </div>
                    )}
                    {rule.actions.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        <span className="font-medium">액션:</span>{' '}
                        {rule.actions.map((a, i) => (
                          <span key={i} className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded mr-1">
                            {a.type}: {a.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`text-xs px-2 py-1 rounded ${rule.is_active ? 'text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20' : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
                    title={rule.is_active ? '비활성화' : '활성화'}
                  >
                    {rule.is_active ? '비활성화' : '활성화'}
                  </button>
                  <button onClick={() => openEdit(rule)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-2 py-1">수정</button>
                  <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">삭제</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {editing ? '규칙 수정' : '새 자동화 규칙'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">규칙 이름 *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 긴급 티켓 자동 알림"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">설명</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="규칙 설명 (선택)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">트리거 이벤트 *</label>
                  <select
                    value={form.trigger_event}
                    onChange={e => setForm(f => ({ ...f, trigger_event: e.target.value }))}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TRIGGER_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">순서</label>
                    <input
                      type="number"
                      value={form.order}
                      onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))}
                      className="w-20 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={form.is_active}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="rounded text-blue-600"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">활성화</label>
                  </div>
                </div>
              </div>

              {/* 조건 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">조건 (AND)</label>
                  <button onClick={addCondition} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ 조건 추가</button>
                </div>
                {form.conditions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">조건 없음 — 모든 이벤트에 적용</p>
                ) : (
                  <div className="space-y-2">
                    {form.conditions.map((cond, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={cond.field}
                          onChange={e => updateCondition(i, 'field', e.target.value)}
                          className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                        >
                          {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <select
                          value={cond.operator}
                          onChange={e => updateCondition(i, 'operator', e.target.value)}
                          className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                        >
                          {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input
                          type="text"
                          value={cond.value}
                          onChange={e => updateCondition(i, 'value', e.target.value)}
                          placeholder="값"
                          className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                        />
                        <button onClick={() => removeCondition(i)} className="text-red-400 hover:text-red-600 px-1">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 액션 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">액션</label>
                  <button onClick={addAction} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ 액션 추가</button>
                </div>
                {form.actions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">액션을 최소 1개 추가해주세요</p>
                ) : (
                  <div className="space-y-2">
                    {form.actions.map((action, i) => {
                      const actionDef = ACTION_TYPES.find(a => a.value === action.type)
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            value={action.type}
                            onChange={e => updateAction(i, 'type', e.target.value)}
                            className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                          >
                            {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                          <input
                            type="text"
                            value={action.value}
                            onChange={e => updateAction(i, 'value', e.target.value)}
                            placeholder={actionDef?.placeholder || '값'}
                            className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                          />
                          <button onClick={() => removeAction(i)} className="text-red-400 hover:text-red-600 px-1">×</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {saveError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
                  {saveError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t dark:border-gray-700">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '저장 중...' : editing ? '수정 완료' : '규칙 생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
