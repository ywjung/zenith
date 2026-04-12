'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'
import { adminFetch } from '@/lib/adminFetch'
import { useAuth } from '@/context/AuthContext'
import { useRoleLabels } from '@/context/RoleLabelsContext'
import RequireAuth from '@/components/RequireAuth'
import { useConfirm } from '@/components/ConfirmProvider'
import { errorMessage } from '@/lib/utils'

interface EscalationPolicy {
  id: number
  name: string
  priority: string | null
  trigger: string
  delay_minutes: number
  action: string
  target_user_id: string | null
  target_user_name: string | null
  notify_email: string | null
  enabled: boolean
  created_by: string
  created_at: string
}

interface SystemUser {
  gitlab_user_id: number
  username: string
  name: string
  email: string
  role: string
}

const TRIGGER_KEY: Record<string, string> = { warning: 'trigger_warning', breach: 'trigger_breach' }
const ACTION_KEY: Record<string, string> = { notify: 'action_notify', reassign: 'action_reassign', upgrade_priority: 'action_upgrade' }
const PRIORITY_KEY: Record<string, string> = { critical: 'prio_critical', high: 'prio_high', medium: 'prio_medium', low: 'prio_low' }
const ROLE_LABELS_DEFAULT: Record<string, string> = { admin: '시스템관리자', agent: 'IT 관리자', pl: 'PL', developer: '개발자', user: '일반 사용자' }
const ROLE_COLORS: Record<string, string> = { admin: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', agent: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300', developer: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300', user: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' }

const EMPTY_FORM = {
  name: '', priority: '', trigger: 'breach', delay_minutes: 0,
  action: 'notify', target_user_id: '', target_user_name: '',
  notify_email: '', enabled: true,
}


// 사용자 선택기 컴포넌트
function UserSelector({
  users,
  selectedId,
  onSelect,
  roleLabels,
}: {
  users: SystemUser[]
  selectedId: string
  onSelect: (user: SystemUser | null) => void
  roleLabels: Record<string, string>
}) {
  const t = useTranslations('admin.escalation')
  const selected = users.find(u => String(u.gitlab_user_id) === selectedId) ?? null

  return (
    <div className="space-y-3">
      {/* 드롭다운 선택 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('target_user')} <span className="text-red-500">*</span>
        </label>
        <select
          value={selectedId}
          onChange={e => {
            const id = e.target.value
            const user = users.find(u => String(u.gitlab_user_id) === id) ?? null
            onSelect(user)
          }}
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">{t('user_select_placeholder')}</option>
          {users.map(u => (
            <option key={u.gitlab_user_id} value={String(u.gitlab_user_id)}>
              {u.name || u.username} ({roleLabels[u.role] ?? u.role})
            </option>
          ))}
        </select>
      </div>

      {/* 선택된 사용자 정보 — 읽기 전용 카드 */}
      {selected ? (
        <div className="rounded-xl border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 p-4">
          <div className="flex items-center gap-3">
            {/* 아바타 이니셜 */}
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
              {(selected.name || selected.username).slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                  {selected.name || selected.username}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ROLE_COLORS[selected.role] ?? 'bg-gray-100 text-gray-600'}`}>
                  {roleLabels[selected.role] ?? selected.role}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 dark:text-gray-500">ID</span>
                  <code className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 font-mono dark:text-gray-300">{selected.gitlab_user_id}</code>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 dark:text-gray-500">@</span>
                  <span>{selected.username}</span>
                </span>
                {selected.email && (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-400 dark:text-gray-500">✉️</span>
                    <span>{selected.email}</span>
                  </span>
                )}
              </div>
            </div>
            {/* 선택 해제 버튼 */}
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title={t('deselect_title')}
             aria-label={t('remove_aria')}>
              ×
            </button>
          </div>
          {/* 읽기 전용 안내 */}
          <p className="text-xs text-blue-500 dark:text-blue-400 mt-2.5 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            {t('gitlab_auto_hint')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 px-4 py-3 text-sm text-gray-400 dark:text-gray-500 text-center">
          {t('user_select_hint')}
        </div>
      )}
    </div>
  )
}

function EscalationContent() {
  const t = useTranslations('admin.escalation')
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const ROLE_LABELS = { ...ROLE_LABELS_DEFAULT, ...useRoleLabels() }
  const [policies, setPolicies] = useState<EscalationPolicy[]>([])
  const [users, setUsers] = useState<SystemUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPolicies = () => {
    setLoading(true)
    adminFetch('/admin/escalation-policies')
      .then(data => setPolicies(data ?? []))
      .catch(() => setError(t('load_failed')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadPolicies()
    // 사용자 목록 로드 (agent 이상만 표시)
    adminFetch('/admin/users')
      .then((data: { items?: SystemUser[] } | SystemUser[]) => {
        const list: SystemUser[] = Array.isArray(data) ? data : (data?.items ?? [])
        const eligible = list.filter(u => ['admin', 'agent', 'developer'].includes(u.role))
        setUsers(eligible)
      })
      .catch(() => { setError(t('users_load_failed')) })
  }, [])

  const openCreate = () => {
    setForm({ ...EMPTY_FORM }); setEditId(null); setShowForm(true); setError(null)
  }

  const openEdit = (p: EscalationPolicy) => {
    setForm({
      name: p.name, priority: p.priority ?? '', trigger: p.trigger,
      delay_minutes: p.delay_minutes, action: p.action,
      target_user_id: p.target_user_id ?? '', target_user_name: p.target_user_name ?? '',
      notify_email: p.notify_email ?? '', enabled: p.enabled,
    })
    setEditId(p.id); setShowForm(true); setError(null)
  }

  // 사용자 선택 시 form 필드 자동 입력
  const handleUserSelect = (user: SystemUser | null) => {
    if (user) {
      setForm(f => ({
        ...f,
        target_user_id: String(user.gitlab_user_id),
        target_user_name: user.name || user.username,
        notify_email: user.email || '',
      }))
    } else {
      setForm(f => ({ ...f, target_user_id: '', target_user_name: '', notify_email: '' }))
    }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    const body = {
      ...form,
      priority: form.priority || null,
      target_user_id: form.target_user_id || null,
      target_user_name: form.target_user_name || null,
      notify_email: form.notify_email || null,
    }
    try {
      if (editId) await adminFetch(`/admin/escalation-policies/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
      else await adminFetch('/admin/escalation-policies', { method: 'POST', body: JSON.stringify(body) })
      setShowForm(false); loadPolicies()
    } catch (e) {
      setError(errorMessage(e, t('save_failed')))
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!(await confirm({ title: t('delete_confirm'), variant: 'danger' }))) return
    try {
      await adminFetch(`/admin/escalation-policies/${id}`, { method: 'DELETE' })
      loadPolicies()
    } catch {
      setError(t('delete_failed'))
    }
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">{t('no_permission')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
          {t('new_policy')}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('loading')}</div>
      ) : (
        <div className="space-y-3">
          {policies.length === 0 && (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500">
              {t('empty')}
            </div>
          )}
          {policies.map(p => (
            <div key={p.id} className={`bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-5 ${!p.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                    {!p.enabled && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">{t('inactive_badge')}</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
                    <span>{t('trigger_label')} <strong>{TRIGGER_KEY[p.trigger] ? t(TRIGGER_KEY[p.trigger] as 'trigger_warning') : p.trigger}</strong></span>
                    {p.priority && <span>{t('priority_label')} <strong>{PRIORITY_KEY[p.priority] ? t(PRIORITY_KEY[p.priority] as 'prio_critical') : p.priority}</strong></span>}
                    {p.delay_minutes > 0 && <span>{t('delay_label')} <strong>{t('delay_minutes', { n: p.delay_minutes })}</strong></span>}
                    <span>{t('action_label')} <strong>{ACTION_KEY[p.action] ? t(ACTION_KEY[p.action] as 'action_notify') : p.action}</strong></span>
                    {p.target_user_name && (
                      <span className="flex items-center gap-1">
                        {t('target_label')}
                        <strong className="flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">
                            {p.target_user_name.slice(0, 1)}
                          </span>
                          {p.target_user_name}
                        </strong>
                      </span>
                    )}
                    {p.notify_email && <span>{t('email_label')} <strong>{p.notify_email}</strong></span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(p)} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg hover:bg-gray-50">{t('edit')}</button>
                  <button onClick={() => handleDelete(p.id)} className="text-xs px-3 py-1.5 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">{t('delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 정책 생성/편집 모달 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 animate-fadeIn backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scaleIn">
            <div className="p-6 border-b dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
              <h2 className="text-lg font-semibold dark:text-gray-100">{editId ? t('edit_title') : t('new_title')}</h2>
            </div>

            <div className="p-6 space-y-5">
              {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}

              {/* 정책 이름 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('policy_name')} <span className="text-red-500">*</span></label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('policy_name_placeholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 트리거 + 우선순위 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('trigger_header')} <span className="text-red-500">*</span></label>
                  <select
                    value={form.trigger}
                    onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="breach">{t('trigger_breach_full')}</option>
                    <option value="warning">{t('trigger_warning_full')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('priority_header')}</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('priority_all')}</option>
                    <option value="critical">{t('prio_critical_full')}</option>
                    <option value="high">{t('prio_high_full')}</option>
                    <option value="medium">{t('prio_medium_full')}</option>
                    <option value="low">{t('prio_low_full')}</option>
                  </select>
                </div>
              </div>

              {/* 액션 + 지연 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('action_header')} <span className="text-red-500">*</span></label>
                  <select
                    value={form.action}
                    onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="notify">{t('action_notify_full')}</option>
                    <option value="reassign">{t('action_reassign_full')}</option>
                    <option value="upgrade_priority">{t('action_upgrade_full')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('delay_header')} <span className="text-gray-400 dark:text-gray-500 font-normal">{t('delay_hint')}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.delay_minutes}
                    onChange={e => setForm(f => ({ ...f, delay_minutes: +e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* 대상 사용자 선택기 — notify 또는 reassign일 때만 표시 */}
              {(form.action === 'notify' || form.action === 'reassign') && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-800">
                  <UserSelector
                    users={users}
                    selectedId={form.target_user_id}
                    onSelect={handleUserSelect}
                    roleLabels={ROLE_LABELS}
                  />
                </div>
              )}

              {/* 활성화 토글 */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="enabled-form"
                  checked={form.enabled}
                  onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="enabled-form" className="text-sm text-gray-700 dark:text-gray-300">{t('enabled_label')}</label>
              </div>
            </div>

            <div className="px-6 py-4 border-t dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-900 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg hover:bg-gray-50">
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || ((form.action === 'notify' || form.action === 'reassign') && !form.target_user_id)}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EscalationPoliciesPage() {
  const t = useTranslations('admin.escalation')
  return (
    <RequireAuth>
      <EscalationContent />
    </RequireAuth>
  )
}
