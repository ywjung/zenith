'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'
import { ROLE_LABELS } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MyStats {
  created: number
  resolved: number
}

interface NotifPrefs {
  ticket_created?: { email?: boolean; inapp?: boolean }
  status_changed?: { email?: boolean; inapp?: boolean }
  comment_added?: { email?: boolean; inapp?: boolean }
}

const EVENT_LABELS: Record<string, string> = {
  ticket_created: '티켓 생성',
  status_changed: '상태 변경',
  comment_added: '댓글 추가',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoleBadgeClass(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
    case 'agent':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
    case 'developer':
      return 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400'
    case 'pl':
      return 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
  }
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function ProfileContent() {
  const { user } = useAuth()
  const router = useRouter()

  const [stats, setStats] = useState<MyStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [prefs, setPrefs] = useState<NotifPrefs>({})
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)

  const [error, setError] = useState('')

  // 내 활동 통계 로드
  useEffect(() => {
    if (!user) return
    const username = user.username
    // 티켓 목록에서 내가 만든 것과 내가 담당한 것을 집계
    Promise.all([
      fetch(`${API_BASE}/tickets/?author_username=${encodeURIComponent(username)}&per_page=1`, {
        credentials: 'include',
      }),
      fetch(`${API_BASE}/tickets/?assignee_username=${encodeURIComponent(username)}&state=closed&per_page=1`, {
        credentials: 'include',
      }),
    ])
      .then(async ([createdRes, resolvedRes]) => {
        const createdTotal = createdRes.ok
          ? parseInt(createdRes.headers.get('X-Total') || '0', 10)
          : 0
        const resolvedTotal = resolvedRes.ok
          ? parseInt(resolvedRes.headers.get('X-Total') || '0', 10)
          : 0
        setStats({ created: createdTotal, resolved: resolvedTotal })
      })
      .catch(() => setStats({ created: 0, resolved: 0 }))
      .finally(() => setStatsLoading(false))
  }, [user])

  // 알림 설정 로드
  useEffect(() => {
    fetch(`${API_BASE}/notifications/prefs`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : {}))
      .then((data: NotifPrefs) => setPrefs(data))
      .catch(() => setPrefs({}))
      .finally(() => setPrefsLoading(false))
  }, [])

  // 알림 설정 토글
  const togglePref = useCallback(
    (event: string, channel: 'email' | 'inapp') => {
      setPrefs(prev => {
        const current = prev[event as keyof NotifPrefs] ?? {}
        return {
          ...prev,
          [event]: {
            ...current,
            [channel]: !current[channel as keyof typeof current],
          },
        }
      })
    },
    [],
  )

  // 알림 설정 저장
  const savePrefs = useCallback(async () => {
    setPrefsSaving(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/notifications/prefs`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (!r.ok) throw new Error('저장 실패')
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2500)
    } catch {
      setError('알림 설정 저장에 실패했습니다.')
    } finally {
      setPrefsSaving(false)
    }
  }, [prefs])

  if (!user) return null

  const roleLabel = (ROLE_LABELS as Record<string, string>)[user.role] ?? user.role

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        >
          ←
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">내 프로필</h1>
      </div>

      {/* 에러 */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 프로필 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-center gap-4">
          {/* 아바타 */}
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.name}
              className="w-16 h-16 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold shrink-0">
              {(user.name || user.username).charAt(0).toUpperCase()}
            </div>
          )}

          {/* 이름 · 이메일 · 역할 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {user.name || user.username}
              </h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeClass(user.role)}`}
              >
                {roleLabel}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              @{user.username}
            </p>
            {user.email && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {user.email}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 내 활동 통계 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">내 활동 통계</h3>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700">
          <div className="px-6 py-5 text-center">
            {statsLoading ? (
              <div className="h-8 w-12 mx-auto bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {stats?.created ?? 0}
              </p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">등록한 티켓</p>
          </div>
          <div className="px-6 py-5 text-center">
            {statsLoading ? (
              <div className="h-8 w-12 mx-auto bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {stats?.resolved ?? 0}
              </p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">처리한 티켓</p>
          </div>
        </div>
      </div>

      {/* 알림 설정 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">알림 설정</h3>
          {prefsSaved && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              ✅ 저장됨
            </span>
          )}
        </div>

        {prefsLoading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            불러오는 중…
          </div>
        ) : (
          <>
            {/* 헤더 행 */}
            <div className="grid grid-cols-3 gap-2 px-5 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium border-b border-gray-50 dark:border-gray-800">
              <span>이벤트</span>
              <span className="text-center">이메일</span>
              <span className="text-center">앱 알림</span>
            </div>

            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {Object.entries(EVENT_LABELS).map(([eventKey, label]) => {
                const ev = prefs[eventKey as keyof NotifPrefs] ?? {}
                return (
                  <div
                    key={eventKey}
                    className="grid grid-cols-3 gap-2 items-center px-5 py-3"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    {(['email', 'inapp'] as const).map(channel => (
                      <div key={channel} className="flex justify-center">
                        <button
                          role="switch"
                          aria-checked={!!ev[channel]}
                          onClick={() => togglePref(eventKey, channel)}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            ev[channel]
                              ? 'bg-blue-600'
                              : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                              ev[channel] ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <button
                onClick={savePrefs}
                disabled={prefsSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {prefsSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 세션 관리 링크 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <button
          onClick={() => router.push('/profile/sessions')}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
        >
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              활성 세션 관리
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              현재 로그인된 기기를 확인하고 관리합니다
            </p>
          </div>
          <span className="text-gray-400 dark:text-gray-500">→</span>
        </button>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  )
}
