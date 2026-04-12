'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
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

function getDeviceIcon(deviceName: string | null): string {
  const name = (deviceName ?? '').toLowerCase()
  if (name.includes('mobile') || name.includes('android') || name.includes('iphone')) return '📱'
  if (name.includes('tablet') || name.includes('ipad')) return '📟'
  return '💻'
}

function SessionsContent() {
  const t = useTranslations('sessions')
  const { logout } = useAuth()
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<number | 'all' | null>(null)
  const [success, setSuccess] = useState('')

  function formatRelative(iso: string | null): string {
    if (!iso) return t('unknown_time')
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return t('just_now')
    if (diff < 3600) return t('minutes_ago', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('hours_ago', { n: Math.floor(diff / 3600) })
    return t('days_ago', { n: Math.floor(diff / 86400) })
  }

  useEffect(() => {
    fetch(`${API_BASE}/auth/sessions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setSessions)
      .catch(() => setError(t('load_failed')))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function revokeSession(id: number) {
    setRevoking(id)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/sessions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok && r.status !== 204) throw new Error()
      setSessions(prev => prev.filter(s => s.id !== id))
      setSuccess(t('revoke_success'))
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError(t('revoke_failed'))
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
      if (!r.ok && r.status !== 204) throw new Error()
      setSessions(prev => prev.filter(s => s.is_current))
      setSuccess(t('revoke_all_success'))
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError(t('revoke_all_failed'))
    } finally {
      setRevoking(null)
    }
  }

  const otherSessionCount = sessions.filter(s => !s.is_current).length

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        >
          ←
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
      </div>

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

      {otherSessionCount > 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {t('other_sessions', { n: otherSessionCount })}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              {t('other_sessions_hint')}
            </p>
          </div>
          <button
            onClick={revokeAllOthers}
            disabled={revoking === 'all'}
            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {revoking === 'all' ? t('processing') : t('logout_all')}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
            {t('active_count', { n: sessions.length })}
          </h3>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('loading')}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('empty')}
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                <div className="text-2xl shrink-0">{getDeviceIcon(s.device_name)}</div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                      {s.device_name ?? t('unknown_device')}
                    </span>
                    {s.is_current && (
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                        {t('current_session')}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {s.ip_address && <span>🌐 {s.ip_address}</span>}
                    <span>⏱ {formatRelative(s.last_used_at)}</span>
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {t('expires', { date: new Date(s.expires_at).toLocaleDateString() })}
                  </div>
                </div>

                {s.is_current ? (
                  <button
                    onClick={logout}
                    className="shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    {t('logout')}
                  </button>
                ) : (
                  <button
                    onClick={() => revokeSession(s.id)}
                    disabled={revoking === s.id}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {revoking === s.id ? t('revoking') : t('revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p className="font-medium text-gray-600 dark:text-gray-300 mb-1">{t('security_title')}</p>
        <p>{t('security_1')}</p>
        <p>{t('security_2', { date: new Date(Date.now() + 30 * 86400 * 1000).toLocaleDateString() })}</p>
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
