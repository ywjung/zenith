'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fetchSLADashboard, type SLADashboard, type SLADashboardTicket } from '@/lib/api'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const AUTO_REFRESH_INTERVAL = 60_000

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function RemainingBadge({ seconds, breached }: { seconds: number; breached: boolean }) {
  const t = useTranslations('sla_page')

  if (breached || seconds <= 0) {
    const abs = Math.abs(seconds)
    const days = Math.floor(abs / 86400)
    const hours = Math.floor((abs % 86400) / 3600)
    const label = days >= 1 ? t('overdue_days', { d: days }) : t('overdue_hours', { h: hours || 1 })
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-700/50 px-2 py-0.5 rounded-full">
        ↑ {label}
      </span>
    )
  }

  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const label = hours >= 1 ? t('remaining_hours', { h: hours }) : t('remaining_mins', { m: mins || 1 })
  const urgent = seconds < 3600

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
      urgent
        ? 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/40 border-orange-200 dark:border-orange-700/50'
        : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 border-gray-200 dark:border-gray-600'
    }`}>
      ⏱ {label}
    </span>
  )
}

function ProgressBar({ pct, breached }: { pct: number; breached: boolean }) {
  const clamped = Math.min(pct, 100)
  const color = breached || pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className={`text-xs font-mono w-9 text-right ${
        breached || pct >= 100 ? 'text-red-600 dark:text-red-400' : pct >= 80 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'
      }`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function TrendChart({ trend }: { trend: { date: string; count: number }[] }) {
  const t = useTranslations('sla_page')
  if (!trend.length) return null
  const maxCount = Math.max(...trend.map(t => t.count), 1)
  const chartH = 64
  const barW = 24
  const gap = 5
  const totalW = trend.length * (barW + gap) - gap
  return (
    <svg viewBox={`0 0 ${totalW} ${chartH + 18}`} className="w-full" style={{ maxHeight: 100 }} aria-label={t('trend_aria')}>
      {trend.map((item, i) => {
        const barH = maxCount > 0 ? Math.max((item.count / maxCount) * chartH, item.count > 0 ? 3 : 0) : 0
        const x = i * (barW + gap)
        const y = chartH - barH
        return (
          <g key={item.date}>
            <rect x={x} y={y} width={barW} height={barH} rx={2} className="fill-red-400 dark:fill-red-500" />
            {item.count > 0 && (
              <text x={x + barW / 2} y={y - 2} textAnchor="middle" fontSize={9} className="fill-gray-600 dark:fill-gray-400">{item.count}</text>
            )}
            <text x={x + barW / 2} y={chartH + 13} textAnchor="middle" fontSize={8} className="fill-gray-400 dark:fill-gray-500">{item.date.slice(5)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function SLADashboardContent() {
  const t = useTranslations('sla_page')
  const tTicket = useTranslations('ticket')
  const tc = useTranslations('common')
  const { isAgent } = useAuth()
  const router = useRouter()

  const [data, setData] = useState<SLADashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    fetchSLADashboard()
      .then(d => { setData(d); setLastUpdated(new Date()); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!isAgent) { router.push('/'); return }
    load()
  }, [isAgent, router, load])

  useEffect(() => {
    if (!autoRefresh) { if (timerRef.current) clearInterval(timerRef.current); return }
    timerRef.current = setInterval(load, AUTO_REFRESH_INTERVAL)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoRefresh, load])

  if (!isAgent) return null

  // --- Loading skeleton ---
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-56 mb-4" />
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />)}
          </div>
          <div className="h-72 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 rounded-lg p-3 text-sm">
        ⚠️ {t('error_load')} {error}
      </div>
    )
  }

  if (!data) return null

  const filteredTickets = priorityFilter === 'all' ? data.tickets : data.tickets.filter(tk => tk.priority === priorityFilter)
  const breachedTickets = filteredTickets.filter(tk => tk.breached)
  const warningTickets = filteredTickets.filter(tk => !tk.breached)

  const lastUpdatedStr = lastUpdated
    ? `${String(lastUpdated.getHours()).padStart(2,'0')}:${String(lastUpdated.getMinutes()).padStart(2,'0')}:${String(lastUpdated.getSeconds()).padStart(2,'0')}`
    : ''

  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('title')}
          </h1>
        <div className="flex items-center gap-2">
          {lastUpdatedStr && (
            <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
              {t('last_updated', { time: lastUpdatedStr })}
            </span>
          )}
          <button
            onClick={load}
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            ↻ {t('refresh_now')}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-blue-500"
            />
            {t('auto_refresh')}
          </label>
        </div>
      </div>

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 text-sm font-bold shrink-0">
            {data.breach_count}
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('breach_label')}</div>
            <div className="text-sm font-semibold text-red-600 dark:text-red-400">SLA {t('breached')}</div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center text-yellow-700 dark:text-yellow-400 text-sm font-bold shrink-0">
            {data.warning_count}
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('warning_label')}</div>
            <div className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">{t('at_risk_tickets')}</div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-700 dark:text-green-400 text-sm font-bold shrink-0">
            {data.on_track_count}
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('on_track_label')}</div>
            <div className="text-sm font-semibold text-green-700 dark:text-green-400">{t('on_track_label')}</div>
          </div>
        </div>
      </div>

      {/* 본문: 테이블 + 트렌드 차트 */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 티켓 테이블 (3/4) */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
          {/* 툴바 */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{filteredTickets.length}</span> {tc('total')}
              </span>
            </div>
            {/* 우선순위 필터 */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPriorityFilter('all')}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  priorityFilter === 'all'
                    ? 'bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 border-gray-700 dark:border-gray-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {t('filter_all')}
              </button>
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => setPriorityFilter(priorityFilter === p ? 'all' : p)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                    priorityFilter === p
                      ? p === 'critical' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700/50'
                        : p === 'high' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700/50'
                          : p === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700/50'
                            : 'bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {tTicket(`priority.${p}`, { default: p })}
                </button>
              ))}
            </div>
          </div>

          {/* 테이블 */}
          {filteredTickets.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm">{t('no_tickets')}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="w-16 px-3 py-2.5 text-left">{t('col_number')}</th>
                  <th className="px-3 py-2.5 text-left">{t('col_title_header')}</th>
                  <th className="w-28 px-3 py-2.5 text-left">{t('col_status')}</th>
                  <th className="w-20 px-3 py-2.5 text-left hidden sm:table-cell">{t('col_priority')}</th>
                  <th className="w-28 px-3 py-2.5 text-left hidden md:table-cell">{t('col_deadline')}</th>
                  <th className="w-44 px-3 py-2.5 text-left hidden lg:table-cell">{t('col_elapsed')}</th>
                  <th className="w-24 px-3 py-2.5 text-left hidden md:table-cell">{t('col_assignee')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {breachedTickets.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={7} className="px-3 py-1.5 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-900/20">
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                          🔴 {t('section_breach')} ({breachedTickets.length})
                        </span>
                      </td>
                    </tr>
                    {breachedTickets.map(ticket => (
                      <TicketRow key={`b-${ticket.iid}`} ticket={ticket} tc={tc} />
                    ))}
                  </>
                )}
                {warningTickets.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={7} className="px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-100 dark:border-yellow-900/20">
                        <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wide">
                          🟡 {t('section_warning')} ({warningTickets.length})
                        </span>
                      </td>
                    </tr>
                    {warningTickets.map(ticket => (
                      <TicketRow key={`w-${ticket.iid}`} ticket={ticket} tc={tc} />
                    ))}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* 트렌드 차트 (1/4) */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t('trend_title')}
            </h2>
          </div>
          <div className="p-4">
            <TrendChart trend={data.trend} />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">{t('trend_subtitle')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function TicketRow({ ticket, tc }: { ticket: SLADashboardTicket; tc: ReturnType<typeof useTranslations> }) {
  return (
    <tr className="group transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <td className="w-16 px-3 py-3">
        <Link href={`/tickets/${ticket.iid}`} className="font-mono text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
          #{ticket.iid}
        </Link>
      </td>
      <td className="px-3 py-3 max-w-0">
        <Link href={`/tickets/${ticket.iid}`} className="block">
          <p className="font-medium text-gray-800 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 text-sm">
            {ticket.title}
          </p>
        </Link>
      </td>
      <td className="w-28 px-3 py-3">
        <StatusBadge status={ticket.status} />
      </td>
      <td className="w-20 px-3 py-3 hidden sm:table-cell">
        <PriorityBadge priority={ticket.priority} />
      </td>
      <td className="w-28 px-3 py-3 hidden md:table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {formatDeadline(ticket.sla_deadline)}
      </td>
      <td className="w-44 px-3 py-3 hidden lg:table-cell">
        <ProgressBar pct={ticket.elapsed_pct} breached={ticket.breached} />
        <div className="mt-1">
          <RemainingBadge seconds={ticket.remaining_seconds} breached={ticket.breached} />
        </div>
      </td>
      <td className="w-24 px-3 py-3 hidden md:table-cell">
        {ticket.assignee
          ? <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">{ticket.assignee}</span>
          : <span className="text-xs text-gray-300 dark:text-gray-600">{tc('unassigned')}</span>
        }
      </td>
    </tr>
  )
}

export default function SLAPage() {
  return (
    <RequireAuth>
      <SLADashboardContent />
    </RequireAuth>
  )
}
