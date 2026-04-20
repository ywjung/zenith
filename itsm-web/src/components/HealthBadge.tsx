'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'

type Health = { db?: string; redis?: string; gitlab?: string }

/**
 * 관리자 전용 시스템 헬스 뱃지. 좌하단에 DB/Redis/GitLab 상태 dot 표시.
 * 30초마다 /health 폴링. 서비스 중단 원인을 즉시 파악.
 */
export default function HealthBadge() {
  const { isAdmin } = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/health', { credentials: 'include', cache: 'no-store' })
        if (!cancelled && res.ok) setHealth(await res.json())
      } catch {
        if (!cancelled) setHealth({ db: 'error', redis: 'error', gitlab: 'error' })
      }
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isAdmin])

  if (!isAdmin || !health) return null

  const dot = (s?: string) => s === 'ok'
    ? 'bg-green-500'
    : s === undefined
    ? 'bg-gray-400'
    : 'bg-red-500'
  const allOk = health.db === 'ok' && health.redis === 'ok' && health.gitlab === 'ok'

  return (
    <div
      className="fixed bottom-3 left-3 z-40 print-hidden"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <button
        type="button"
        aria-label="시스템 헬스"
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium shadow-lg border backdrop-blur
          ${allOk
            ? 'bg-white/80 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
            : 'bg-red-50/90 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 animate-pulse'}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dot(health.db)}`} />
        <span className={`w-1.5 h-1.5 rounded-full ${dot(health.redis)}`} />
        <span className={`w-1.5 h-1.5 rounded-full ${dot(health.gitlab)}`} />
        {expanded && (
          <span className="ml-1 whitespace-nowrap">
            DB {health.db} · Redis {health.redis} · GitLab {health.gitlab}
          </span>
        )}
      </button>
    </div>
  )
}
