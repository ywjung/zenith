'use client'

import React, { useEffect, useState } from 'react'
import { fetchAdminUsers, updateUserRole, triggerSudo } from '@/lib/api'
import type { UserRole } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { useRoleLabels } from '@/context/RoleLabelsContext'
import { ROLES, API_BASE } from '@/lib/constants'
import { useTranslations } from 'next-intl'

type Session = {
  id: number
  device_name: string
  ip_address: string
  last_used_at: string | null
  expires_at: string
}

const ROLE_ICONS: Record<string, string> = {
  admin: '🔑',
  agent: '🎧',
  pl: '🗂️',
  developer: '💻',
  user: '👤',
}

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700',
  agent: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700',
  pl: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700',
  developer: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
  user: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600',
}

const ROLE_AVATAR: Record<string, string> = {
  admin: 'bg-red-500',
  agent: 'bg-purple-500',
  pl: 'bg-teal-500',
  developer: 'bg-blue-500',
  user: 'bg-gray-400',
}

const STAT_BG: Record<string, string> = {
  admin: 'border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700',
  agent: 'border-purple-200 dark:border-purple-800 hover:border-purple-300 dark:hover:border-purple-700',
  pl: 'border-teal-200 dark:border-teal-800 hover:border-teal-300 dark:hover:border-teal-700',
  developer: 'border-blue-200 dark:border-blue-800 hover:border-blue-300 dark:hover:border-blue-700',
  user: 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
}

function getInitials(name?: string, username?: string): string {
  const n = name || username || '?'
  return n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function AdminUsersContent() {
  const { isAdmin } = useAuth()
  const ROLE_LABELS = useRoleLabels()
  const t = useTranslations('admin')
  const [users, setUsers] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [sessions, setSessions] = useState<Record<number, Session[]>>({})
  const [sessionsLoading, setSessionsLoading] = useState<number | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    fetchAdminUsers()
      .then(setUsers)
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

  const handleRoleChange = async (gitlabUserId: number, newRole: string) => {
    setSaving(gitlabUserId)
    try {
      // 고위험 작업: Sudo 재인증 쿠키를 먼저 획득 후 역할 변경
      await triggerSudo()
      await updateUserRole(gitlabUserId, newRole)
      setUsers((prev) =>
        prev.map((u) => u.gitlab_user_id === gitlabUserId ? { ...u, role: newRole as UserRole['role'] } : u)
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('users.role_change_failed'))
    } finally {
      setSaving(null)
    }
  }

  const loadSessions = async (gitlabUserId: number) => {
    if (sessions[gitlabUserId] !== undefined) {
      setExpandedUserId((prev) => (prev === gitlabUserId ? null : gitlabUserId))
      return
    }
    setSessionsLoading(gitlabUserId)
    try {
      const r = await fetch(`${API_BASE}/admin/sessions/${gitlabUserId}`, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setSessions((prev) => ({ ...prev, [gitlabUserId]: data }))
        setExpandedUserId(gitlabUserId)
      } else {
        const err = await r.json().catch(() => ({}))
        alert((err as { detail?: string }).detail || t('users.session_load_error', { status: r.status }))
      }
    } catch {
      alert(t('users.session_load_failed'))
    } finally {
      setSessionsLoading(null)
    }
  }

  const revokeSession = async (gitlabUserId: number, sessionId: number) => {
    try {
      const r = await fetch(`${API_BASE}/admin/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (r.ok) {
        setSessions((prev) => ({
          ...prev,
          [gitlabUserId]: (prev[gitlabUserId] ?? []).filter((s) => s.id !== sessionId),
        }))
      } else {
        const err = await r.json().catch(() => ({}))
        alert(err.detail || t('users.session_revoke_failed'))
      }
    } catch {
      alert(t('users.session_revoke_error'))
    }
  }

  const filtered = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !u.username.toLowerCase().includes(q) &&
        !(u.name ?? '').toLowerCase().includes(q) &&
        !(u.email ?? '').toLowerCase().includes(q) &&
        !(u.organization ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  const roleCounts = ROLES.reduce<Record<string, number>>((acc, r) => {
    acc[r] = users.filter((u) => u.role === r).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          {t('users.title')}
        </h1>
      </div>
      {/* Role stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(roleFilter === role ? '' : role)}
            className={`rounded-xl border p-4 text-left bg-white dark:bg-gray-800 transition-all hover:shadow-sm ${
              roleFilter === role
                ? ROLE_BADGE[role] + ' shadow-sm'
                : STAT_BG[role]
            }`}
          >
            <div className="text-xl mb-1">{ROLE_ICONS[role]}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{roleCounts[role]}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ROLE_LABELS[role]}</div>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">⚠️ {error}</div>
      )}

      {/* Table card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <span className="text-gray-400">🔍</span>
          <input
            type="text"
            placeholder={t('users.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm focus:outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 dark:bg-gray-800"
          />
          <div className="flex items-center gap-2">
            {roleFilter && (
              <button
                onClick={() => setRoleFilter('')}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {t('common.filter_clear')}
              </button>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('users.count', { n: filtered.length })}</span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">{t('common.loading')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('users.col_user')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('users.col_email')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('users.col_org')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('users.col_joined')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 w-52">{t('users.col_role')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('users.col_session')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${ROLE_AVATAR[u.role] ?? 'bg-gray-400'}`}
                          title={`GitLab ID: ${u.gitlab_user_id}`}
                        >
                          {getInitials(u.name, u.username)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{u.name || u.username}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">{u.organization || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={u.role}
                          disabled={saving === u.gitlab_user_id}
                          onChange={(e) => handleRoleChange(u.gitlab_user_id, e.target.value)}
                          className={`border rounded-lg px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${ROLE_BADGE[u.role] ?? ''}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_ICONS[r]} {ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                        {saving === u.gitlab_user_id && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">{t('users.saving_role')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => loadSessions(u.gitlab_user_id)}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {sessionsLoading === u.gitlab_user_id
                          ? t('users.session_loading')
                          : expandedUserId === u.gitlab_user_id
                          ? t('users.session_collapse')
                          : t('users.session_view')}
                      </button>
                    </td>
                  </tr>
                  {expandedUserId === u.gitlab_user_id && (
                    <tr key={`sessions-${u.id}`}>
                      <td colSpan={6} className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                        {(sessions[u.gitlab_user_id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400">{t('users.session_none')}</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500 dark:text-gray-400">
                                <th className="text-left pb-2 font-medium">{t('users.session_col_device')}</th>
                                <th className="text-left pb-2 font-medium">{t('users.session_col_ip')}</th>
                                <th className="text-left pb-2 font-medium">{t('users.session_col_last_used')}</th>
                                <th className="pb-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {(sessions[u.gitlab_user_id] ?? []).map((s) => (
                                <tr key={s.id}>
                                  <td className="py-1.5 font-medium text-gray-700 dark:text-gray-300">{s.device_name}</td>
                                  <td className="py-1.5 font-mono text-gray-400 dark:text-gray-500">{s.ip_address}</td>
                                  <td className="py-1.5 text-gray-400 dark:text-gray-500">
                                    {s.last_used_at
                                      ? new Date(s.last_used_at).toLocaleString('ko-KR')
                                      : '—'}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    <button
                                      onClick={() => revokeSession(u.gitlab_user_id, s.id)}
                                      className="text-xs px-2 py-1 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                                    >
                                      {t('users.session_revoke')}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                    {search || roleFilter ? t('common.no_results') : t('users.no_users')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function AdminUsersPage() {
  return <AdminUsersContent />
}
