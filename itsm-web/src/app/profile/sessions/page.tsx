'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

interface Session {
  id: number
  device_name: string | null
  ip_address: string | null
  last_used_at: string | null
  expires_at: string
  is_current: boolean
}

function formatRelative(iso: string | null): string {
  if (!iso) return '알 수 없음'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

function getDeviceIcon(deviceName: string | null): string {
  const name = (deviceName ?? '').toLowerCase()
  if (name.includes('mobile') || name.includes('android') || name.includes('iphone')) return '📱'
  if (name.includes('tablet') || name.includes('ipad')) return '📟'
  return '💻'
}

function SessionsContent() {
  const { logout } = useAuth()
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<number | 'all' | null>(null)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/auth/sessions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setSessions)
      .catch(() => setError('세션 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  async function revokeSession(id: number) {
    setRevoking(id)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/sessions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok && r.status !== 204) throw new Error('세션 폐기 실패')
      setSessions(prev => prev.filter(s => s.id !== id))
      setSuccess('세션이 폐기되었습니다.')
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('세션 폐기에 실패했습니다.')
    } finally {
      setRevoking(null)
    }
  }

  async function revokeAllOthers() {
    setRevoking('all')
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/sessions`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok && r.status !== 204) throw new Error('일괄 로그아웃 실패')
      setSessions(prev => prev.filter(s => s.is_current))
      setSuccess('다른 모든 기기에서 로그아웃됐습니다.')
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError('일괄 로그아웃에 실패했습니다.')
    } finally {
      setRevoking(null)
    }
  }

  const otherSessionCount = sessions.filter(s => !s.is_current).length

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
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">활성 세션 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            현재 로그인된 기기와 위치를 확인하고 의심스러운 세션을 폐기할 수 있습니다.
          </p>
        </div>
      </div>

      {/* 알림 */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg text-sm">
          ✅ {success}
        </div>
      )}

      {/* 일괄 로그아웃 */}
      {otherSessionCount > 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              다른 기기 {otherSessionCount}개에서 로그인 중
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              본인이 로그인한 기기가 아니라면 즉시 폐기하세요.
            </p>
          </div>
          <button
            onClick={revokeAllOthers}
            disabled={revoking === 'all'}
            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {revoking === 'all' ? '처리 중…' : '모두 로그아웃'}
          </button>
        </div>
      )}

      {/* 세션 목록 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
            활성 세션 ({sessions.length})
          </h3>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            불러오는 중…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            활성 세션이 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                {/* 기기 아이콘 */}
                <div className="text-2xl shrink-0">{getDeviceIcon(s.device_name)}</div>

                {/* 세션 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                      {s.device_name ?? '알 수 없는 기기'}
                    </span>
                    {s.is_current && (
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                        현재 세션
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {s.ip_address && <span>🌐 {s.ip_address}</span>}
                    <span>⏱ {formatRelative(s.last_used_at)}</span>
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    만료: {new Date(s.expires_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>

                {/* 폐기 버튼 */}
                {s.is_current ? (
                  <button
                    onClick={logout}
                    className="shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    로그아웃
                  </button>
                ) : (
                  <button
                    onClick={() => revokeSession(s.id)}
                    disabled={revoking === s.id}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    {revoking === s.id ? '폐기 중…' : '폐기'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 보안 안내 */}
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">🔒 보안 안내</p>
        <p>• 알 수 없는 기기나 위치의 세션은 즉시 폐기하고 비밀번호를 변경하세요.</p>
        <p>• 세션은 {new Date(Date.now() + 30 * 86400 * 1000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 이후 자동 만료됩니다.</p>
      </div>
    </div>
  )
}

export default function SessionsPage() {
  return (
    <RequireAuth>
      <SessionsContent />
    </RequireAuth>
  )
}
