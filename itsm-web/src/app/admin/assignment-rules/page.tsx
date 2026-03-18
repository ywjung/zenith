'use client'

import { useEffect, useState } from 'react'
import {
  fetchAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
} from '@/lib/api'
import type { AssignmentRule } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName } from '@/lib/utils'

const PRIORITY_LABELS: Record<string, string> = {
  critical: '🔴 긴급',
  high:     '🟠 높음',
  medium:   '🟡 보통',
  low:      '⚪ 낮음',
}

const PRIORITIES = Object.keys(PRIORITY_LABELS)

const EMPTY_FORM = {
  name: '',
  enabled: true,
  priority: 0,
  match_category: '',
  match_priority: '',
  match_keyword: '',
  assignee_gitlab_id: 0,
  assignee_name: '',
}

type RuleForm = typeof EMPTY_FORM

function RuleFormPanel({
  title,
  form,
  setForm,
  onSubmit,
  onCancel,
  serviceTypes,
}: {
  title: string
  form: RuleForm
  setForm: React.Dispatch<React.SetStateAction<RuleForm>>
  onSubmit: (e: React.FormEvent) => Promise<void>
  onCancel: () => void
  serviceTypes: import('@/types').ServiceType[]
}) {
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-xl p-5 mb-2 shadow-sm">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">{title}</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">규칙 이름 *</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="예: 네트워크 이슈 → 홍길동"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">우선순위 순서 (높을수록 먼저)</label>
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3">조건 (비워두면 전체 티켓에 적용)</div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">카테고리</label>
            <select
              value={form.match_category}
              onChange={(e) => setForm((f) => ({ ...f, match_category: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">전체</option>
              {serviceTypes.map((c) => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">우선순위</label>
            <select
              value={form.match_priority}
              onChange={(e) => setForm((f) => ({ ...f, match_priority: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">전체</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">제목 키워드</label>
            <input
              value={form.match_keyword}
              onChange={(e) => setForm((f) => ({ ...f, match_keyword: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: VPN, 프린터"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">담당자 GitLab ID *</label>
          <input
            type="number"
            value={form.assignee_gitlab_id || ''}
            onChange={(e) => setForm((f) => ({ ...f, assignee_gitlab_id: Number(e.target.value) }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="GitLab 사용자 ID"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">담당자 이름 *</label>
          <input
            value={form.assignee_name}
            onChange={(e) => setForm((f) => ({ ...f, assignee_name: e.target.value }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="표시 이름"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700">저장</button>
        <button type="button" onClick={onCancel} className="border border-gray-300 dark:border-gray-600 px-5 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">취소</button>
      </div>
    </form>
  )
}

function AssignmentRulesContent() {
  const { isAdmin } = useAuth()
  const { serviceTypes, getEmoji, getLabel } = useServiceTypes()
  const [rules, setRules] = useState<AssignmentRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<RuleForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<RuleForm>(EMPTY_FORM)

  useEffect(() => {
    if (!isAdmin) return
    fetchAssignmentRules()
      .then(setRules)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500">관리자 권한이 필요합니다.</p>
      </div>
    )
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const created = await createAssignmentRule({
        ...createForm,
        match_category: createForm.match_category || undefined,
        match_priority: createForm.match_priority || undefined,
        match_keyword: createForm.match_keyword || undefined,
      })
      setRules((prev) => [...prev, created].sort((a, b) => b.priority - a.priority))
      setShowCreateForm(false)
      setCreateForm(EMPTY_FORM)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '규칙 생성에 실패했습니다.')
    }
  }

  const startEdit = (rule: AssignmentRule) => {
    setShowCreateForm(false)
    setEditingId(rule.id)
    setEditForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      match_category: rule.match_category ?? '',
      match_priority: rule.match_priority ?? '',
      match_keyword: rule.match_keyword ?? '',
      assignee_gitlab_id: rule.assignee_gitlab_id,
      assignee_name: rule.assignee_name,
    })
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingId === null) return
    try {
      const updated = await updateAssignmentRule(editingId, {
        ...editForm,
        match_category: editForm.match_category || undefined,
        match_priority: editForm.match_priority || undefined,
        match_keyword: editForm.match_keyword || undefined,
      })
      setRules((prev) =>
        prev.map((r) => (r.id === editingId ? updated : r)).sort((a, b) => b.priority - a.priority)
      )
      setEditingId(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '규칙 수정에 실패했습니다.')
    }
  }

  const handleToggle = async (rule: AssignmentRule) => {
    try {
      const updated = await updateAssignmentRule(rule.id, { enabled: !rule.enabled })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '변경에 실패했습니다.')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('이 규칙을 삭제하시겠습니까?')) return
    try {
      await deleteAssignmentRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
      if (editingId === id) setEditingId(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-5 gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          티켓 생성 시 조건에 맞는 담당자를 자동으로 배정합니다. 우선순위(숫자)가 높을수록 먼저 적용됩니다.
        </p>
        <button
          onClick={() => { setShowCreateForm(!showCreateForm); setCreateForm(EMPTY_FORM); setEditingId(null) }}
          className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          + 규칙 추가
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4">⚠️ {error}</div>
      )}

      {showCreateForm && (
        <RuleFormPanel
          title="새 배정 규칙"
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
          serviceTypes={serviceTypes}
        />
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="space-y-2">
          {rules.length === 0 && !showCreateForm && (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500">
              <div className="text-3xl mb-2">⚡</div>
              <p>등록된 배정 규칙이 없습니다.</p>
              <button onClick={() => setShowCreateForm(true)} className="mt-3 text-sm text-blue-600 hover:underline">
                + 첫 번째 규칙 추가
              </button>
            </div>
          )}

          {rules.map((rule) => (
            <div key={rule.id}>
              {editingId === rule.id ? (
                <RuleFormPanel
                  title={`규칙 수정 — ${rule.name}`}
                  form={editForm}
                  setForm={setEditForm}
                  onSubmit={handleEdit}
                  onCancel={() => setEditingId(null)}
                  serviceTypes={serviceTypes}
                />
              ) : (
                <div
                  className={`bg-white dark:bg-gray-800 rounded-xl border px-5 py-4 flex items-center gap-4 transition-opacity ${
                    rule.enabled ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-50'
                  }`}
                >
                  {/* Priority number */}
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {rule.priority}
                  </div>

                  {/* Name */}
                  <div className="w-40 flex-shrink-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{rule.name}</div>
                  </div>

                  {/* IF conditions */}
                  <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono font-semibold">IF</span>
                    {rule.match_category && (
                      <span className="text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-700 px-2 py-0.5 rounded-full">
                        {getEmoji(rule.match_category)} {getLabel(rule.match_category)}
                      </span>
                    )}
                    {rule.match_priority && (
                      <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 px-2 py-0.5 rounded-full">
                        {PRIORITY_LABELS[rule.match_priority] ?? rule.match_priority}
                      </span>
                    )}
                    {rule.match_keyword && (
                      <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700 px-2 py-0.5 rounded-full">
                        키워드: &ldquo;{rule.match_keyword}&rdquo;
                      </span>
                    )}
                    {!rule.match_category && !rule.match_priority && !rule.match_keyword && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 italic">모든 티켓</span>
                    )}
                  </div>

                  {/* Arrow + assignee */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-gray-300 dark:text-gray-600 text-lg">→</span>
                    <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                      {(rule.assignee_name?.[0] ?? '?').toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{formatName(rule.assignee_name)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                        rule.enabled
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/30'
                          : 'bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      {rule.enabled ? '활성' : '비활성'}
                    </button>
                    <button
                      onClick={() => startEdit(rule)}
                      className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      title="수정"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors text-lg leading-none"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AssignmentRulesPage() {
  return <AssignmentRulesContent />
}
