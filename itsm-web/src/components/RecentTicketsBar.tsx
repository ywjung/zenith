'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getRecentTickets, type RecentTicket } from '@/lib/recentTickets'

/**
 * 최근 본 티켓 5개를 가로 칩 형태로 표시.
 * localStorage 기반 — 클라이언트 only.
 */
export default function RecentTicketsBar() {
  const [recent, setRecent] = useState<RecentTicket[]>([])

  useEffect(() => {
    setRecent(getRecentTickets())
    const onStorage = () => setRecent(getRecentTickets())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (recent.length === 0) return null

  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide shrink-0">
        🕐 최근
      </span>
      {recent.map((t) => {
        const href = t.project_id ? `/tickets/${t.iid}?project_id=${t.project_id}` : `/tickets/${t.iid}`
        return (
          <Link
            key={t.iid}
            href={href}
            title={`#${t.iid} ${t.title}`}
            className="inline-flex items-center gap-1.5 max-w-[200px] text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors active:scale-95"
          >
            <span className="font-mono text-gray-400 dark:text-gray-500 shrink-0">#{t.iid}</span>
            <span className="truncate">{t.title}</span>
          </Link>
        )
      })}
    </div>
  )
}
