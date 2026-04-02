'use client'
import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'

interface Announcement {
  id: number
  title: string
  content: string
  type: string
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
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  useEffect(() => {
    // 미인증 상태에서는 호출하지 않음 (로그인 페이지 등)
    if (loading || !user) return
    fetch(`${API_BASE}/notifications/announcements`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [user, loading])

  const visible = announcements.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-1">
      {visible.map(a => (
        <div key={a.id} className={`border-l-4 px-4 py-2.5 flex items-start gap-3 text-sm ${TYPE_STYLES[a.type] ?? TYPE_STYLES.info}`}>
          <span className="shrink-0">{TYPE_ICONS[a.type] ?? 'ℹ️'}</span>
          <div className="flex-1 min-w-0">
            <span className="font-semibold">{a.title}</span>
            {a.content && <span className="ml-2 opacity-80">{a.content}</span>}
          </div>
          <button onClick={() => setDismissed(s => new Set(Array.from(s).concat(a.id)))} className="shrink-0 opacity-50 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      ))}
    </div>
  )
}
