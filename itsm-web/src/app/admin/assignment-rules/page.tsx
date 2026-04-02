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
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('admin')
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-xl p-5 mb-2 shadow-sm">
      <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.field_name')}</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('assignment_rules.field_name_placeholder')}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.field_priority')}</label>
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3">{t('assignment_rules.conditions_title')}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.condition_category')}</label>
            <select
              value={form.match_category}
              onChange={(e) => setForm((f) => ({ ...f, match_category: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t('assignment_rules.condition_all')}</option>
              {serviceTypes.map((c) => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.condition_priority')}</label>
            <select
              value={form.match_priority}
              onChange={(e) => setForm((f) => ({ ...f, match_priority: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t('assignment_rules.condition_all')}</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.condition_keyword')}</label>
            <input
              value={form.match_keyword}
              onChange={(e) => setForm((f) => ({ ...f, match_keyword: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('assignment_rules.condition_keyword_placeholder')}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.assignee_gitlab_id')}</label>
          <input
            type="number"
            value={form.assignee_gitlab_id || ''}
            onChange={(e) => setForm((f) => ({ ...f, assignee_gitlab_id: Number(e.target.value) }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('assignment_rules.assignee_gitlab_id_placeholder')}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('assignment_rules.assignee_name')}</label>
          <input
            value={form.assignee_name}
            onChange={(e) => setForm((f) => ({ ...f, assignee_name: e.target.value }))}
            required
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('assignment_rules.assignee_name_placeholder')}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700">{t('common.save')}</button>
        <button type="button" onClick={onCancel} className="border border-gray-300 dark:border-gray-600 px-5 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">{t('common.cancel')}</button>
      </div>
    </form>
  )
}

function AssignmentRulesContent() {
  const { isAdmin } = useAuth()
  const { serviceTypes, getEmoji, getLabel } = useServiceTypes()
  const t = useTranslations('admin')
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
        <p className="text-gray-500">{t('common.no_permission')}</p>
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
      alert(e instanceof Error ? e.message : t('assignment_rules.create_failed'))
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
      alert(e instanceof Error ? e.message : t('assignment_rules.edit_failed'))
    }
  }

  const handleToggle = async (rule: AssignmentRule) => {
    try {
      const updated = await updateAssignmentRule(rule.id, { enabled: !rule.enabled })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('assignment_rules.toggle_failed'))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('assignment_rules.delete_confirm'))) return
    try {
      await deleteAssignmentRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
      if (editingId === id) setEditingId(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('assignment_rules.delete_failed'))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {t('assignment_rules.title')}
        </h1>
      </div>
      <div className="flex items-start justify-between mb-5 gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('assignment_rules.description')}
        </p>
        <button
          onClick={() => { setShowCreateForm(!showCreateForm); setCreateForm(EMPTY_FORM); setEditingId(null) }}
          className="flex-shrink-0 flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          {t('assignment_rules.add_btn')}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4">⚠️ {error}</div>
      )}

      {showCreateForm && (
        <RuleFormPanel
          title={t('assignment_rules.new_title')}
          form={createForm}
          setForm={setCreateForm}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
          serviceTypes={serviceTypes}
        />
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t('common.loading')}</div>
      ) : (
        <div className="space-y-2">
          {rules.length === 0 && !showCreateForm && (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500">
              <div className="text-3xl mb-2">⚡</div>
              <p>{t('assignment_rules.no_rules')}</p>
              <button onClick={() => setShowCreateForm(true)} className="mt-3 text-sm text-blue-600 hover:underline">
                {t('assignment_rules.add_first')}
              </button>
            </div>
          )}

          {rules.map((rule) => (
            <div key={rule.id}>
              {editingId === rule.id ? (
                <RuleFormPanel
                  title={t('assignment_rules.edit_title', { name: rule.name })}
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
                        {t('assignment_rules.condition_keyword_badge', { keyword: rule.match_keyword })}
                      </span>
                    )}
                    {!rule.match_category && !rule.match_priority && !rule.match_keyword && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('assignment_rules.condition_all_tickets')}</span>
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
                      {rule.enabled ? t('common.active') : t('common.inactive')}
                    </button>
                    <button
                      onClick={() => startEdit(rule)}
                      className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                      title={t('common.edit')}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors text-lg leading-none"
                      title={t('common.delete')}
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
