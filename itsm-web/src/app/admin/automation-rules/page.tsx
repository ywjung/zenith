'use client'

import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useConfirm } from '@/components/ConfirmProvider'
import { API_BASE } from '@/lib/constants'
import { adminFetch } from '@/lib/adminFetch'
import { useTranslations } from 'next-intl'

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


const EMPTY_RULE = {
  name: '',
  description: '',
  trigger_event: 'ticket.created',
  conditions: [] as Condition[],
  actions: [] as Action[],
  is_active: true,
  order: 0,
}


interface AutomationLogEntry {
  id: number
  rule_id?: number
  rule_name?: string
  ticket_iid: number
  project_id?: string
  trigger_event: string
  matched: boolean
  actions_taken: Action[] | null
  error: string | null
  triggered_at: string
}


function AutomationLogsModal({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const [logs, setLogs] = useState<AutomationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const t = useTranslations('admin')
  const triggerLabelMap: Record<string, string> = {
    'ticket.created': t('automation_rules.trigger_ticket_created'),
    'ticket.status_changed': t('automation_rules.trigger_status_changed'),
    'ticket.assigned': t('automation_rules.trigger_assigned'),
    'ticket.priority_changed': t('automation_rules.trigger_priority_changed'),
    'ticket.commented': t('automation_rules.trigger_commented'),
    'ticket.sla_warning': t('automation_rules.trigger_sla_warning'),
    'ticket.sla_breached': t('automation_rules.trigger_sla_breached'),
    'ticket.closed': t('automation_rules.trigger_closed'),
    'ticket.reopened': t('automation_rules.trigger_reopened'),
  }

  useEffect(() => {
    adminFetch(`/automation-rules/${rule.id}/logs?limit=50`)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [rule.id])

  function fmt(iso: string) {
    return new Date(iso).toLocaleString('ko-KR', { hour12: false })
  }

  return (
    <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-scaleIn">
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('automation_rules.logs_title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rule.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" aria-label="닫기">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">{t('common.loading')}</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              <div className="text-3xl mb-2">📭</div>
              {t('automation_rules.logs_modal_empty')}
            </div>
          ) : (
            <div className="divide-y dark:divide-gray-700">
              {logs.map((log) => (
                <div key={log.id} className="px-6 py-3 flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 text-sm font-bold ${log.matched ? 'text-green-600' : 'text-gray-400'}`}>
                    {log.matched ? '✓' : '—'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/tickets/${log.ticket_iid}`}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        #{log.ticket_iid}
                      </a>
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                        {triggerLabelMap[log.trigger_event] || log.trigger_event}
                      </span>
                      {log.matched && log.actions_taken && log.actions_taken.length > 0 && (
                        <span className="text-xs text-green-700 dark:text-green-400">
                          {t('automation_rules.action_count', { count: log.actions_taken.length })}
                        </span>
                      )}
                    </div>
                    {log.matched && log.actions_taken && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {log.actions_taken.map((a, i) => (
                          <span key={i} className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                            {a.type}: {a.value}
                          </span>
                        ))}
                      </div>
                    )}
                    {log.error && (
                      <p className="text-xs text-red-500 mt-1">{log.error}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">
                    {fmt(log.triggered_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AllLogsPanel() {
  const [logs, setLogs] = useState<AutomationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [matchedOnly, setMatchedOnly] = useState(false)
  const t = useTranslations('admin')
  const triggerLabelMap: Record<string, string> = {
    'ticket.created': t('automation_rules.trigger_ticket_created'),
    'ticket.status_changed': t('automation_rules.trigger_status_changed'),
    'ticket.assigned': t('automation_rules.trigger_assigned'),
    'ticket.priority_changed': t('automation_rules.trigger_priority_changed'),
    'ticket.commented': t('automation_rules.trigger_commented'),
    'ticket.sla_warning': t('automation_rules.trigger_sla_warning'),
    'ticket.sla_breached': t('automation_rules.trigger_sla_breached'),
    'ticket.closed': t('automation_rules.trigger_closed'),
    'ticket.reopened': t('automation_rules.trigger_reopened'),
  }

  function load(mo: boolean) {
    setLoading(true)
    adminFetch(`/automation-rules/logs/recent?limit=200&matched_only=${mo}`)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(matchedOnly) }, [matchedOnly])

  function fmt(iso: string) {
    return new Date(iso).toLocaleString('ko-KR', { hour12: false })
  }

  const successCount = logs.filter(l => l.matched).length
  const failCount = logs.filter(l => !l.matched).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {t('automation_rules.title')}
        </h1>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm">
          <span className="text-green-600 dark:text-green-400 font-medium">{t('automation_rules.logs_matched', { count: successCount })}</span>
          <span className="text-gray-400 dark:text-gray-500">{t('automation_rules.logs_unmatched', { count: failCount })}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={matchedOnly}
            onChange={e => setMatchedOnly(e.target.checked)}
            className="rounded text-blue-600"
          />
          {t('automation_rules.logs_matched_only')}
        </label>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">{t('common.loading')}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          <div className="text-3xl mb-2">📭</div>
          {t('automation_rules.logs_empty')}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl divide-y dark:divide-gray-700">
          {logs.map(log => (
            <div key={log.id} className="px-4 py-3 flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 text-sm font-bold w-4 text-center ${log.matched ? 'text-green-600' : 'text-gray-400'}`}>
                {log.matched ? '✓' : '—'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {log.rule_name && (
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{log.rule_name}</span>
                  )}
                  <a href={`/tickets/${log.ticket_iid}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                    #{log.ticket_iid}
                  </a>
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                    {triggerLabelMap[log.trigger_event] || log.trigger_event}
                  </span>
                  {log.matched && log.actions_taken && log.actions_taken.length > 0 && (
                    <span className="text-xs text-green-700 dark:text-green-400">{t('automation_rules.action_count', { count: log.actions_taken.length })}</span>
                  )}
                </div>
                {log.matched && log.actions_taken && log.actions_taken.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {log.actions_taken.map((a, i) => (
                      <span key={i} className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                        {a.type}: {a.value}
                      </span>
                    ))}
                  </div>
                )}
                {log.error && <p className="text-xs text-red-500 mt-1">{log.error}</p>}
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">{fmt(log.triggered_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AutomationRulesPage() {
  const confirm = useConfirm()
  const t = useTranslations('admin')

  const TRIGGER_EVENTS = [
    { value: 'ticket.created', label: t('automation_rules.trigger_ticket_created') },
    { value: 'ticket.status_changed', label: t('automation_rules.trigger_status_changed') },
    { value: 'ticket.assigned', label: t('automation_rules.trigger_assigned') },
    { value: 'ticket.priority_changed', label: t('automation_rules.trigger_priority_changed') },
    { value: 'ticket.commented', label: t('automation_rules.trigger_commented') },
    { value: 'ticket.sla_warning', label: t('automation_rules.trigger_sla_warning') },
    { value: 'ticket.sla_breached', label: t('automation_rules.trigger_sla_breached') },
    { value: 'ticket.closed', label: t('automation_rules.trigger_closed') },
    { value: 'ticket.reopened', label: t('automation_rules.trigger_reopened') },
  ]

  const CONDITION_FIELDS = [
    { value: 'priority', label: t('automation_rules.cond_field_priority') },
    { value: 'category', label: t('automation_rules.cond_field_category') },
    { value: 'status', label: t('automation_rules.cond_field_status') },
    { value: 'assignee', label: t('automation_rules.cond_field_assignee') },
    { value: 'title', label: t('automation_rules.cond_field_title') },
  ]

  const CONDITION_OPS = [
    { value: 'eq', label: t('automation_rules.cond_op_eq') },
    { value: 'neq', label: t('automation_rules.cond_op_neq') },
    { value: 'contains', label: t('automation_rules.cond_op_contains') },
    { value: 'in', label: t('automation_rules.cond_op_in') },
  ]

  const ACTION_TYPES = [
    { value: 'set_status', label: t('automation_rules.action_set_status'), placeholder: 'in_progress' },
    { value: 'assign', label: t('automation_rules.action_assign'), placeholder: 'username' },
    { value: 'add_label', label: t('automation_rules.action_add_label'), placeholder: 'urgent' },
    { value: 'notify', label: t('automation_rules.action_notify'), placeholder: 'assignee | submitter | admin' },
    { value: 'set_priority', label: t('automation_rules.action_set_priority'), placeholder: 'high' },
  ]

  const [tab, setTab] = useState<'rules' | 'logs'>('rules')
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AutomationRule | null>(null)
  const [form, setForm] = useState({ ...EMPTY_RULE })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [logsRule, setLogsRule] = useState<AutomationRule | null>(null)

  async function loadRules() {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch('/automation-rules')
      setRules(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('automation_rules.load_failed'))
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
        await adminFetch(`/automation-rules/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        await adminFetch('/automation-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      setShowForm(false)
      await loadRules()
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : t('automation_rules.save_failed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!(await confirm({ title: t('automation_rules.delete_confirm'), variant: 'danger', confirmLabel: '확인' }))) return
    try {
      await adminFetch(`/automation-rules/${id}`, { method: 'DELETE' })
      setRules(r => r.filter(x => x.id !== id))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('automation_rules.delete_failed'))
    }
  }

  async function handleToggle(rule: AutomationRule) {
    try {
      const updated = await adminFetch(`/automation-rules/${rule.id}`, {
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
      toast.error(e instanceof Error ? e.message : t('automation_rules.toggle_failed'))
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
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t('automation_rules.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('automation_rules.description')}</p>
        </div>
        {tab === 'rules' && (
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            {t('automation_rules.add_btn')}
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('rules')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'rules' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          {t('automation_rules.tab_rules')}
        </button>
        <button
          onClick={() => setTab('logs')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'logs' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          {t('automation_rules.tab_logs')}
        </button>
      </div>

      {tab === 'logs' && <AllLogsPanel />}

      {tab === 'rules' && error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {tab === 'rules' && loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : tab === 'rules' && rules.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('automation_rules.no_rules')}</p>
          <button onClick={openCreate} className="mt-3 text-blue-600 dark:text-blue-400 text-sm hover:underline">
            {t('automation_rules.add_first')}
          </button>
        </div>
      ) : tab === 'rules' ? (
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
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{t('automation_rules.inactive_badge')}</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{rule.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {rule.conditions.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        <span className="font-medium">{t('automation_rules.conditions_label')}</span>{' '}
                        {rule.conditions.map((c, i) => (
                          <span key={i} className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded mr-1">
                            {c.field} {c.operator} &ldquo;{c.value}&rdquo;
                          </span>
                        ))}
                      </div>
                    )}
                    {rule.actions.length > 0 && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        <span className="font-medium">{t('automation_rules.actions_label')}</span>{' '}
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
                    title={rule.is_active ? t('automation_rules.deactivate') : t('automation_rules.activate')}
                  >
                    {rule.is_active ? t('automation_rules.deactivate') : t('automation_rules.activate')}
                  </button>
                  <button onClick={() => setLogsRule(rule)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1">{t('automation_rules.logs_btn')}</button>
                  <button onClick={() => openEdit(rule)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-2 py-1">{t('common.edit')}</button>
                  <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">{t('common.delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-scaleIn">
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {editing ? t('automation_rules.edit_title') : t('automation_rules.new_title')}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" aria-label="닫기">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {/* 기본 정보 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('automation_rules.field_name')}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('automation_rules.field_name_placeholder')}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('automation_rules.field_description')}</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('automation_rules.field_description_placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('automation_rules.field_trigger')}</label>
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
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('automation_rules.field_order')}</label>
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
                    <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">{t('automation_rules.field_active')}</label>
                  </div>
                </div>
              </div>

              {/* 조건 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('automation_rules.conditions_title')}</label>
                  <button onClick={addCondition} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('automation_rules.conditions_add')}</button>
                </div>
                {form.conditions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">{t('automation_rules.conditions_empty')}</p>
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
                          placeholder={t('automation_rules.condition_value_placeholder')}
                          className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                        />
                        <button onClick={() => removeCondition(i)} className="text-red-400 hover:text-red-600 px-1" aria-label="삭제">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 액션 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('automation_rules.actions_title')}</label>
                  <button onClick={addAction} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('automation_rules.actions_add')}</button>
                </div>
                {form.actions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">{t('automation_rules.actions_empty')}</p>
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
                            placeholder={actionDef?.placeholder || t('automation_rules.condition_value_placeholder')}
                            className="flex-1 border dark:border-gray-600 rounded px-2 py-1.5 text-xs dark:bg-gray-800 dark:text-gray-100 focus:outline-none"
                          />
                          <button onClick={() => removeAction(i)} className="text-red-400 hover:text-red-600 px-1" aria-label="삭제">×</button>
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
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t('common.saving') : editing ? t('automation_rules.save_done_btn') : t('automation_rules.save_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {logsRule && (
        <AutomationLogsModal rule={logsRule} onClose={() => setLogsRule(null)} />
      )}
    </div>
  )
}
