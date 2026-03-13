'use client'

import { useEffect, useState } from 'react'
import { fetchAdminUsers, updateUserRole } from '@/lib/api'
import type { UserRole } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { ROLES, ROLE_LABELS } from '@/lib/constants'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost/api'

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
  admin: 'bg-red-50 text-red-700 border-red-200',
  agent: 'bg-purple-50 text-purple-700 border-purple-200',
  pl: 'bg-teal-50 text-teal-700 border-teal-200',
  developer: 'bg-blue-50 text-blue-700 border-blue-200',
  user: 'bg-gray-100 text-gray-600 border-gray-200',
}

const ROLE_AVATAR: Record<string, string> = {
  admin: 'bg-red-500',
  agent: 'bg-purple-500',
  pl: 'bg-teal-500',
  developer: 'bg-blue-500',
  user: 'bg-gray-400',
}

const STAT_BG: Record<string, string> = {
  admin: 'border-red-200 hover:border-red-300',
  agent: 'border-purple-200 hover:border-purple-300',
  pl: 'border-teal-200 hover:border-teal-300',
  developer: 'border-blue-200 hover:border-blue-300',
  user: 'border-gray-200 hover:border-gray-300',
}

function getInitials(name?: string, username?: string): string {
  const n = name || username || '?'
  return n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function AdminUsersContent() {
  const { isAdmin } = useAuth()
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
        <p className="text-gray-500">관리자 권한이 필요합니다.</p>
      </div>
    )
  }

  const handleRoleChange = async (gitlabUserId: number, newRole: string) => {
    setSaving(gitlabUserId)
    try {
      await updateUserRole(gitlabUserId, newRole)
      setUsers((prev) =>
        prev.map((u) => u.gitlab_user_id === gitlabUserId ? { ...u, role: newRole as UserRole['role'] } : u)
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '역할 변경에 실패했습니다.')
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
      }
    } finally {
      setSessionsLoading(null)
    }
  }

  const revokeSession = async (gitlabUserId: number, sessionId: number) => {
    const r = await fetch(`${API_BASE}/admin/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (r.ok) {
      setSessions((prev) => ({
        ...prev,
        [gitlabUserId]: (prev[gitlabUserId] ?? []).filter((s) => s.id !== sessionId),
      }))
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
      {/* Role stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(roleFilter === role ? '' : role)}
            className={`rounded-xl border p-4 text-left bg-white transition-all hover:shadow-sm ${
              roleFilter === role
                ? ROLE_BADGE[role] + ' shadow-sm'
                : STAT_BG[role]
            }`}
          >
            <div className="text-xl mb-1">{ROLE_ICONS[role]}</div>
            <div className="text-2xl font-bold text-gray-900">{roleCounts[role]}</div>
            <div className="text-xs text-gray-500 mt-0.5">{ROLE_LABELS[role]}</div>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">⚠️ {error}</div>
      )}

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <span className="text-gray-400">🔍</span>
          <input
            type="text"
            placeholder="이름, 아이디, 이메일, 소속 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm focus:outline-none text-gray-700 placeholder-gray-400"
          />
          <div className="flex items-center gap-2">
            {roleFilter && (
              <button
                onClick={() => setRoleFilter('')}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                필터 해제
              </button>
            )}
            <span className="text-xs text-gray-400">{filtered.length}명</span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">불러오는 중...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">사용자</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">이메일</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">소속</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">가입일</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 w-52">ITSM 역할</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">세션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u) => (
                <>
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${ROLE_AVATAR[u.role] ?? 'bg-gray-400'}`}
                          title={`GitLab ID: ${u.gitlab_user_id}`}
                        >
                          {getInitials(u.name, u.username)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{u.name || u.username}</div>
                          <div className="text-xs text-gray-400 font-mono truncate">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{u.organization || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
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
                          <span className="text-xs text-gray-400 animate-pulse">저장 중...</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => loadSessions(u.gitlab_user_id)}
                        className="text-xs px-2 py-1 border border-gray-300 text-gray-500 rounded hover:bg-gray-50"
                      >
                        {sessionsLoading === u.gitlab_user_id
                          ? '로딩중...'
                          : expandedUserId === u.gitlab_user_id
                          ? '접기'
                          : '세션 보기'}
                      </button>
                    </td>
                  </tr>
                  {expandedUserId === u.gitlab_user_id && (
                    <tr key={`sessions-${u.id}`}>
                      <td colSpan={6} className="px-4 py-3 bg-gray-50">
                        {(sessions[u.gitlab_user_id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400">활성 세션 없음</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left pb-2 font-medium">기기</th>
                                <th className="text-left pb-2 font-medium">IP</th>
                                <th className="text-left pb-2 font-medium">마지막 사용</th>
                                <th className="pb-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {(sessions[u.gitlab_user_id] ?? []).map((s) => (
                                <tr key={s.id}>
                                  <td className="py-1.5 font-medium text-gray-700">{s.device_name}</td>
                                  <td className="py-1.5 font-mono text-gray-400">{s.ip_address}</td>
                                  <td className="py-1.5 text-gray-400">
                                    {s.last_used_at
                                      ? new Date(s.last_used_at).toLocaleString('ko-KR')
                                      : '—'}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    <button
                                      onClick={() => revokeSession(u.gitlab_user_id, s.id)}
                                      className="text-xs px-2 py-1 border border-red-200 text-red-500 rounded hover:bg-red-50"
                                    >
                                      강제 종료
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
                </>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    {search || roleFilter ? '검색 결과가 없습니다.' : '등록된 사용자가 없습니다.'}
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
