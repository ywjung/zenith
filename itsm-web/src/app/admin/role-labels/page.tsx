'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { API_BASE, ROLE_LABELS, ROLES } from '@/lib/constants'
import { useRoleLabelsContext } from '@/context/RoleLabelsContext'
import { errorMessage } from '@/lib/utils'

const ROLE_ICONS: Record<string, string> = {
  admin:     '🔑',
  agent:     '🛠️',
  pl:        '🗂️',
  developer: '💻',
  user:      '👤',
}

export default function RoleLabelsPage() {
  const t = useTranslations('admin.role_labels')
  const { refresh } = useRoleLabelsContext()
  const [form, setForm] = useState<Record<string, string>>({})
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/admin/role-labels`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => { setForm(data); setOriginal(data) })
      .catch(() => setMsg({ type: 'err', text: t('load_failed') }))
      .finally(() => setLoading(false))
  // t 함수는 안정적 참조이지만 eslint 규칙상 추가.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reset(role: string) {
    setForm(prev => ({ ...prev, [role]: ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? prev[role] }))
  }

  function resetAll() {
    setForm(Object.fromEntries(ROLES.map(r => [r, ROLE_LABELS[r]])))
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`${API_BASE}/admin/role-labels`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
      const saved = await res.json()
      setForm(saved)
      setOriginal(saved)
      refresh()
      setMsg({ type: 'ok', text: t('save_success') })
      setTimeout(() => setMsg(null), 3000)
    } catch (e: unknown) {
      setMsg({ type: 'err', text: errorMessage(e, t('save_failed')) })
    } finally {
      setSaving(false)
    }
  }

  const isDirty = ROLES.some(r => form[r] !== original[r])

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">{t('loading')}</div>
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('subtitle')}
        </p>
      </div>

      {/* 메시지 */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${
          msg.type === 'ok'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700'
        }`}>
          {msg.type === 'ok' ? '✅ ' : '❌ '}{msg.text}
        </div>
      )}

      {/* 역할 목록 */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{t('section_title')}</h2>
          <button
            onClick={resetAll}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            {t('reset_all')}
          </button>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {ROLES.map(role => {
            const changed = form[role] !== original[role]
            return (
              <div key={role} className="px-6 py-4 flex items-start gap-4">
                <div className="w-9 h-9 rounded-xl bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-lg shrink-0 mt-0.5">
                  {ROLE_ICONS[role]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {role}
                    </span>
                    {changed && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t('changed')}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t(`desc_${role}` as 'desc_admin')}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form[role] ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, [role]: e.target.value }))}
                      maxLength={50}
                      className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {form[role] !== (ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? '') && (
                      <button
                        onClick={() => reset(role)}
                        title={t('reset_title')}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg whitespace-nowrap transition-colors"
                      >
                        {t('reset')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 미리보기 */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('preview')}</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map(role => (
              <span
                key={role}
                className="text-xs px-2.5 py-1 rounded-full border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              >
                {ROLE_ICONS[role]} {form[role] || role}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 저장 버튼 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('note')}
        </p>
        <button
          onClick={save}
          disabled={saving || !isDirty}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}
