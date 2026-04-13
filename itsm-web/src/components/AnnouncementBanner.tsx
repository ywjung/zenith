'use client'
import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'

interface Announcement {
  id: number
  title: string
  content: string
  type: string
  expires_at?: string | null
  starts_at?: string | null
}

const DISMISS_KEY = 'announcement-dismissed-v1'

function loadDismissed(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as number[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function persistDismissed(s: Set<number>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(s)))
  } catch {
    // ignore
  }
}

const TYPE_STYLES: Record<string, string> = {
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-300',
  warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-400 dark:border-yellow-600 text-yellow-800 dark:text-yellow-300',
  critical: 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-600 text-red-900 dark:text-red-300',
}
const TYPE_ICONS: Record<string, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' }

export default function AnnouncementBanner() {
  const { user, loading } = useAuth()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(() => loadDismissed())

  useEffect(() => {
    // 미인증 상태에서는 호출하지 않음 (로그인 페이지 등)
    if (loading || !user) return
    fetch(`${API_BASE}/notifications/announcements`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [user, loading])

  // 만료된 공지 자동 제외 + dismissed 제외
  const now = Date.now()
  const visible = announcements.filter(a => {
    if (dismissed.has(a.id)) return false
    if (a.expires_at && new Date(a.expires_at).getTime() < now) return false
    if (a.starts_at && new Date(a.starts_at).getTime() > now) return false
    return true
  })
  if (visible.length === 0) return null

  const handleDismiss = (id: number) => {
    setDismissed(s => {
      const next = new Set(Array.from(s).concat(id))
      persistDismissed(next)
      return next
    })
  }

  return (
    <div className="space-y-1">
      {visible.map(a => (
        <div key={a.id} className={`border-l-4 px-4 py-2.5 flex items-start gap-3 text-sm ${TYPE_STYLES[a.type] ?? TYPE_STYLES.info}`}>
          <span className="shrink-0">{TYPE_ICONS[a.type] ?? 'ℹ️'}</span>
          <div className="flex-1 min-w-0">
            <span className="font-semibold">{a.title}</span>
            {a.content && <span className="ml-2 opacity-80">{a.content}</span>}
          </div>
          <button onClick={() => handleDismiss(a.id)} className="shrink-0 opacity-50 hover:opacity-100 text-lg leading-none" aria-label="닫기">×</button>
        </div>
      ))}
    </div>
  )
}
