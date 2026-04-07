'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/context/AuthContext'
import { fetchSessions, revokeSession, revokeOtherSessions } from '@/lib/api'
import type { SessionInfo } from '@/types'

// ---------------------------------------------------------------------------
// Helpers — User-Agent parsing
// ---------------------------------------------------------------------------

function parseBrowser(ua: string | null, unknownLabel: string): string {
  if (!ua) return unknownLabel
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return unknownLabel
}

function parseOS(ua: string | null): string {
  if (!ua) return ''
  if (/iPhone|iPad/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return ''
}

function parseDeviceLabel(deviceName: string | null, unknownLabel: string): string {
  const browser = parseBrowser(deviceName, unknownLabel)
  const os = parseOS(deviceName)
  return os ? `${browser} · ${os}` : browser
}

type BrowserIconType = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other'

function detectBrowserType(ua: string | null): BrowserIconType {
  if (!ua) return 'other'
  if (/Edg\//i.test(ua)) return 'edge'
  if (/Firefox\//i.test(ua)) return 'firefox'
  if (/Chrome\//i.test(ua)) return 'chrome'
  if (/Safari\//i.test(ua)) return 'safari'
  return 'other'
}

function BrowserIcon({ type }: { type: BrowserIconType }) {
  switch (type) {
    case 'chrome':
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Chrome">
          <circle cx="12" cy="12" r="4" fill="#4285F4" />
          <path d="M12 8h8.66a10 10 0 1 0-4.33 13l-4.33-7.5" fill="#EA4335" />
          <path d="M12 8 7.67 15.5a10 10 0 0 0 8.66 0L12 8z" fill="#FBBC05" />
          <path d="M7.67 15.5A10 10 0 0 1 3.34 8H12l-4.33 7.5z" fill="#34A853" />
        </svg>
      )
    case 'firefox':
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Firefox">
          <circle cx="12" cy="12" r="10" fill="#FF6611" />
          <path d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6z" fill="#FF9500" />
          <circle cx="12" cy="12" r="3" fill="#FFD700" />
        </svg>
      )
    case 'safari':
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Safari">
          <circle cx="12" cy="12" r="10" fill="#1C9DEA" />
          <polygon points="12,4 14,10 20,12 14,14 12,20 10,14 4,12 10,10" fill="white" />
        </svg>
      )
    case 'edge':
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Edge">
          <circle cx="12" cy="12" r="10" fill="#0078D4" />
          <path d="M6 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="white" strokeWidth="2" fill="none" />
          <path d="M4 16h16" stroke="white" strokeWidth="1.5" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6" aria-label="Browser">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" />
          <path d="M2 8h20" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" />
        </svg>
      )
  }
}

// ---------------------------------------------------------------------------
// SessionManager component
// ---------------------------------------------------------------------------

export default function SessionManager() {
  const { logout } = useAuth()
  const t = useTranslations('sessions')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [revoking, setRevoking] = useState<number | 'all' | null>(null)

  const loadSessions = useCallback(() => {
    setLoading(true)
    fetchSessions()
      .then(setSessions)
      .catch(() => setError(t('load_error')))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  function formatRelative(iso: string | null): string {
    if (!iso) return t('unknown_time')
    const ts = iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z'
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (diff < 60) return t('just_now')
    if (diff < 3600) return t('minutes_ago', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('hours_ago', { n: Math.floor(diff / 3600) })
    return t('days_ago', { n: Math.floor(diff / 86400) })
  }

  async function handleRevoke(id: number) {
    setRevoking(id)
    setError('')
    try {
      await revokeSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      setSuccess(t('revoke_success'))
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError(t('revoke_error'))
    } finally {
      setRevoking(null)
    }
  }

  async function handleRevokeAllOthers() {
    setRevoking('all')
    setError('')
    try {
      await revokeOtherSessions()
      setSessions(prev => prev.filter(s => s.is_current))
      setSuccess(t('revoke_all_success'))
      setTimeout(() => setSuccess(''), 3000)
    } catch {
      setError(t('revoke_all_error'))
    } finally {
      setRevoking(null)
    }
  }

  const otherCount = sessions.filter(s => !s.is_current).length
  const unknownLabel = t('unknown_browser')

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('title')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('desc')}
          </p>
        </div>
        {success && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✅ {success}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Session list */}
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
          {sessions.map(s => {
            const browserType = detectBrowserType(s.device_name)
            const deviceLabel = parseDeviceLabel(s.device_name, unknownLabel)
            return (
              <div key={s.id} className="flex items-center gap-4 px-5 py-4">
                {/* Browser icon */}
                <div className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gray-50 dark:bg-gray-800">
                  <BrowserIcon type={browserType} />
                </div>

                {/* Session info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                      {deviceLabel}
                    </span>
                    {s.is_current && (
                      <span className="shrink-0 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">
                        {t('current_badge')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                    {s.ip_address && (
                      <span className="flex items-center gap-1">
                        <span>🌐</span>
                        <span>{s.ip_address}</span>
                      </span>
                    )}
                    <span>⏱ {formatRelative(s.last_used_at)}</span>
                  </div>
                </div>

                {/* Actions */}
                {s.is_current ? (
                  <button
                    onClick={logout}
                    className="shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    {t('logout_btn')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleRevoke(s.id)}
                    disabled={revoking === s.id}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    {revoking === s.id ? t('revoking_btn') : t('revoke_btn')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer — revoke all other sessions */}
      {!loading && otherCount > 0 && (
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('other_devices', { count: otherCount })}
          </p>
          <button
            onClick={handleRevokeAllOthers}
            disabled={revoking === 'all'}
            className="shrink-0 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
          >
            {revoking === 'all' ? t('revoking_all_btn') : t('revoke_all_btn')}
          </button>
        </div>
      )}
    </div>
  )
}
