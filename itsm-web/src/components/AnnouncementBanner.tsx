'use client'
import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface Announcement {
  id: number
  title: string
  content: string
  type: string
}

const TYPE_STYLES: Record<string, string> = {
  info: 'bg-blue-50 border-blue-400 text-blue-800',
  warning: 'bg-yellow-50 border-yellow-400 text-yellow-800',
  critical: 'bg-red-50 border-red-500 text-red-900',
}
const TYPE_ICONS: Record<string, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' }

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetch(`${API_BASE}/notifications/announcements`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

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
