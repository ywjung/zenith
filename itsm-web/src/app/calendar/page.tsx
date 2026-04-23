'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { fetchCalendarTickets, fetchHolidays, fetchCalendarChanges, type CalendarTicket, type HolidayItem, type CalendarChange } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  open:        { bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-700 dark:text-blue-300',    dot: 'bg-blue-500' },
  in_progress: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-400' },
  waiting:     { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-400' },
  resolved:    { bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-700 dark:text-green-300',   dot: 'bg-green-500' },
  closed:      { bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-700 dark:text-green-300',   dot: 'bg-green-500' },
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay()
}

function getTicketDate(ticket: CalendarTicket): string {
  return ticket.created_at ? ticket.created_at.slice(0, 10) : ''
}

function getSLADate(ticket: CalendarTicket): string | null {
  return ticket.sla_deadline ? ticket.sla_deadline.slice(0, 10) : null
}

function TicketBadge({ ticket }: { ticket: CalendarTicket }) {
  const colors = STATUS_COLORS[ticket.status] ?? STATUS_COLORS['open']
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs leading-tight max-w-full truncate ${colors.bg} ${colors.text}`}
      title={`#${ticket.iid} ${ticket.title}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
      <span className="truncate">#{ticket.iid}</span>
    </span>
  )
}

const RISK_COLOR: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-gray-400',
}
const CHANGE_STATUS_BG: Record<string, string> = {
  approved: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  implementing: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  implemented: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  reviewing: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  failed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  cancelled: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  draft: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
}
const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-blue-400',
  low: 'bg-gray-300 dark:bg-gray-600',
}

function SlidePanel({
  date, tickets, changes, holiday, onClose,
}: {
  date: string | null
  tickets: CalendarTicket[]
  changes: CalendarChange[]
  holiday: HolidayItem | null
  onClose: () => void
}) {
  const t = useTranslations('calendar')
  const ts = useTranslations('ticket.status')

  useEffect(() => {
    if (!date) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [date, onClose])

  if (!date) return null

  const [, m, d] = date.split('-')
  const label = t('slide_title', { month: parseInt(m), day: parseInt(d) })

  return (
    <>
      <div className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed right-0 top-0 h-full w-80 max-w-full bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700">
        {/* 패널 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{label}</h3>
            {holiday && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 flex items-center gap-1">
                <span>🎌</span>
                <span>{holiday.name || t('holiday_fallback')}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            aria-label={t('close')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* 패널 내용 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {holiday && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <span className="text-lg">🎌</span>
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-300">{holiday.name || t('holiday_fallback')}</p>
                <p className="text-xs text-red-500 dark:text-red-400">{t('holiday_desc')}</p>
              </div>
            </div>
          )}
          {changes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">🛠️ 변경 일정 ({changes.length})</p>
              {changes.map(c => (
                <Link
                  key={c.id}
                  href={`/changes/${c.id}`}
                  className="block p-2.5 rounded-lg border border-indigo-100 dark:border-indigo-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${RISK_COLOR[c.risk_level] ?? 'bg-gray-400'}`} title={`위험도: ${c.risk_level}`} />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate flex-1">{c.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${CHANGE_STATUS_BG[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                  </div>
                  {(c.scheduled_start_at || c.scheduled_end_at) && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 font-mono">
                      {c.scheduled_start_at?.slice(0, 16).replace('T', ' ') ?? '—'} ~ {c.scheduled_end_at?.slice(0, 16).replace('T', ' ') ?? '…'}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
          {tickets.length === 0 && changes.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('no_tickets')}</p>
          ) : tickets.length === 0 ? null : (
            tickets.map(ticket => {
              const colors = STATUS_COLORS[ticket.status] ?? STATUS_COLORS['open']
              return (
                <Link
                  key={ticket.iid}
                  href={`/tickets/${ticket.iid}`}
                  className="block p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        <span className="font-mono text-gray-400 dark:text-gray-500 text-xs mr-1">#{ticket.iid}</span>
                        {ticket.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`inline-flex items-center gap-1 text-xs ${colors.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                          {ts(ticket.status as Parameters<typeof ts>[0]) ?? ticket.status}
                        </span>
                        {ticket.sla_deadline && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            SLA {ticket.sla_deadline.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'waiting' | 'resolved'
type PriorityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

function matchesStatus(tk: CalendarTicket, f: StatusFilter): boolean {
  if (f === 'all') return true
  // 'resolved' 필터는 'resolved'와 'closed' 모두 포괄 (업무상 완료 상태)
  if (f === 'resolved') return tk.status === 'resolved' || tk.status === 'closed'
  return tk.status === f
}

function CalendarContent() {
  const t = useTranslations('calendar')
  const router = useRouter()
  const { user, isAgent } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tickets, setTickets] = useState<CalendarTicket[]>([])
  const [changes, setChanges] = useState<CalendarChange[]>([])
  const [holidays, setHolidays] = useState<HolidayItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [showChanges, setShowChanges] = useState(true)

  const loadTickets = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchCalendarTickets(year, month)
      .then(setTickets)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [year, month])

  useEffect(() => {
    fetchHolidays(year).then(setHolidays).catch(() => setHolidays([]))
  }, [year])

  useEffect(() => { loadTickets() }, [loadTickets])

  useEffect(() => {
    if (!isAgent) { setChanges([]); return }
    fetchCalendarChanges(year, month).then(setChanges).catch(() => setChanges([]))
  }, [year, month, isAgent])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
    setSelectedDate(null)
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
    setSelectedDate(null)
  }

  function goToday() {
    const d = new Date()
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)

  const holidayMap: Record<string, HolidayItem> = {}
  for (const h of holidays) holidayMap[h.date] = h

  // 필터 적용
  const filteredTickets = tickets.filter(tk => {
    if (!matchesStatus(tk, statusFilter)) return false
    if (priorityFilter !== 'all' && tk.priority !== priorityFilter) return false
    return true
  })

  const byCreatedDate: Record<string, CalendarTicket[]> = {}
  const bySLADate: Record<string, CalendarTicket[]> = {}

  for (const ticket of filteredTickets) {
    const createdDate = getTicketDate(ticket)
    if (createdDate) {
      if (!byCreatedDate[createdDate]) byCreatedDate[createdDate] = []
      byCreatedDate[createdDate].push(ticket)
    }
    const slaDate = getSLADate(ticket)
    if (slaDate && slaDate !== createdDate) {
      if (!bySLADate[slaDate]) bySLADate[slaDate] = []
      bySLADate[slaDate].push(ticket)
    }
  }

  // 변경요청을 날짜별로 분배 (scheduled_start 기준, 종료일까지 모든 날짜에 걸쳐)
  const changesByDate: Record<string, CalendarChange[]> = {}
  if (showChanges) {
    for (const c of changes) {
      if (!c.scheduled_start_at) continue
      const start = new Date(c.scheduled_start_at)
      const end = c.scheduled_end_at ? new Date(c.scheduled_end_at) : start
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
      const endD = new Date(end.getFullYear(), end.getMonth(), end.getDate())
      while (d <= endD) {
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!changesByDate[k]) changesByDate[k] = []
        changesByDate[k].push(c)
        d.setDate(d.getDate() + 1)
      }
    }
  }

  const selectedTickets: CalendarTicket[] = selectedDate
    ? [...(byCreatedDate[selectedDate] ?? []), ...(bySLADate[selectedDate] ?? [])]
        .filter((tk, i, arr) => arr.findIndex(x => x.iid === tk.iid) === i)
    : []

  const selectedChanges: CalendarChange[] = selectedDate ? (changesByDate[selectedDate] ?? []) : []
  const selectedHoliday = selectedDate ? (holidayMap[selectedDate] ?? null) : null

  // 월 요약 통계 (필터 반영 전 기준 — 전체 월 현황)
  const monthSummary = {
    created: tickets.length,
    resolved: tickets.filter(tk => tk.status === 'resolved' || tk.status === 'closed').length,
    open: tickets.filter(tk => tk.status !== 'resolved' && tk.status !== 'closed').length,
    breached: tickets.filter(tk => {
      if (!tk.sla_deadline) return false
      const dl = new Date(tk.sla_deadline).getTime()
      const resolvedDone = tk.status === 'resolved' || tk.status === 'closed'
      return dl < Date.now() && !resolvedDone
    }).length,
    critical: tickets.filter(tk => tk.priority === 'critical').length,
    changes: changes.length,
  }

  // SLA 임박 날짜 집합 (오늘 ± 2일 이내 미해결 티켓의 SLA)
  const slaImminent = new Set<string>()
  const slaOverdue = new Set<string>()
  const nowMs = Date.now()
  for (const tk of filteredTickets) {
    if (!tk.sla_deadline) continue
    if (tk.status === 'resolved' || tk.status === 'closed') continue
    const slaDate = getSLADate(tk)
    if (!slaDate) continue
    const diffDays = (new Date(tk.sla_deadline).getTime() - nowMs) / (24 * 3600 * 1000)
    if (diffDays < 0) slaOverdue.add(slaDate)
    else if (diffDays <= 2) slaImminent.add(slaDate)
  }

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  function cellDateStr(day: number) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const WEEKDAYS = Array.from({ length: 7 }, (_, i) => t(`weekday_${i}` as Parameters<typeof t>[0]))

  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {t('title')}
        </h1>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">
          ⚠️ {t('error_load')} {error}
        </div>
      )}

      {/* 메인 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* 툴바: 월 네비게이션 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              aria-label={t('prev_month')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 min-w-[110px] text-center">
              {t('year_month', { year, month })}
            </span>
            <button
              onClick={nextMonth}
              className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              aria-label={t('next_month')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={goToday}
              disabled={isCurrentMonth}
              className="ml-1 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="이번 달로 이동"
            >
              오늘
            </button>
          </div>
          {/* 범례 (우측) */}
          <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {([
              { key: 'open',        label: t('legend_open') },
              { key: 'in_progress', label: t('legend_in_progress') },
              { key: 'closed',      label: t('legend_closed') },
            ] as { key: string; label: string }[]).map(({ key, label }) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[key].dot}`} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded border border-dashed border-red-400" />
              {t('legend_sla')}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700" />
              {t('legend_holiday')}
            </span>
          </div>
        </div>

        {/* 월 요약 바 */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400">이달 요약:</span>
          <SummaryStat label="생성" value={monthSummary.created} />
          <SummaryStat label="해결" value={monthSummary.resolved} accent="emerald" />
          <SummaryStat label="미해결" value={monthSummary.open} accent={monthSummary.open > 0 ? 'amber' : undefined} />
          <SummaryStat label="SLA 위반" value={monthSummary.breached} accent={monthSummary.breached > 0 ? 'red' : undefined} />
          <SummaryStat label="Critical" value={monthSummary.critical} accent={monthSummary.critical > 0 ? 'red' : undefined} />
          {isAgent && <SummaryStat label="변경일정" value={monthSummary.changes} accent="indigo" />}
          {user && monthSummary.open > 0 && monthSummary.created > 0 && (
            <span className="text-gray-400 ml-auto">
              해결률 {Math.round((monthSummary.resolved / monthSummary.created) * 100)}%
            </span>
          )}
        </div>

        {/* 필터 툴바 */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400 mr-1">상태</span>
            {(['all', 'open', 'in_progress', 'waiting', 'resolved'] as StatusFilter[]).map(s => {
              const labels: Record<StatusFilter, string> = { all: '전체', open: '오픈', in_progress: '진행중', waiting: '대기', resolved: '해결/완료' }
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2 py-0.5 rounded-md border transition-colors ${
                    statusFilter === s
                      ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {labels[s]}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400 mr-1">우선순위</span>
            {(['all', 'critical', 'high', 'medium', 'low'] as PriorityFilter[]).map(p => {
              const labels: Record<PriorityFilter, string> = { all: '전체', critical: '긴급', high: '높음', medium: '보통', low: '낮음' }
              return (
                <button
                  key={p}
                  onClick={() => setPriorityFilter(p)}
                  className={`px-2 py-0.5 rounded-md border transition-colors inline-flex items-center gap-1 ${
                    priorityFilter === p
                      ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 font-medium'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {p !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[p]}`} />}
                  {labels[p]}
                </button>
              )
            })}
          </div>
          {isAgent && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showChanges}
                onChange={e => setShowChanges(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-gray-600 dark:text-gray-400">🛠️ 변경 일정 표시</span>
            </label>
          )}
          {(statusFilter !== 'all' || priorityFilter !== 'all') && (
            <button
              onClick={() => { setStatusFilter('all'); setPriorityFilter('all') }}
              className="ml-auto text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline"
            >
              필터 초기화 ({filteredTickets.length}/{tickets.length})
            </button>
          )}
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
          {WEEKDAYS.map((day, i) => (
            <div
              key={i}
              className={`py-2 text-center text-xs font-semibold uppercase tracking-wide ${
                i === 0 ? 'text-red-500 dark:text-red-400'
                  : i === 6 ? 'text-blue-500 dark:text-blue-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* 날짜 셀 */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (day === null) {
              return (
                <div
                  key={`empty-${idx}`}
                  className="min-h-[96px] border-b border-r border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/10"
                />
              )
            }

            const dateStr = cellDateStr(day)
            const created = byCreatedDate[dateStr] ?? []
            const sla = bySLADate[dateStr] ?? []
            const dayChanges = changesByDate[dateStr] ?? []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const dow = (firstDow + day - 1) % 7
            const holiday = holidayMap[dateStr]
            const isHoliday = !!holiday
            const isRedDay = dow === 0 || isHoliday
            const isOverdue = slaOverdue.has(dateStr)
            const isImminent = slaImminent.has(dateStr)

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                onDoubleClick={() => router.push(`/tickets/new?sla_due_date=${dateStr}`)}
                title={isOverdue ? 'SLA 위반 미해결 티켓이 있습니다' : isImminent ? 'SLA 마감 임박 (2일 이내)' : '더블클릭으로 새 티켓 생성'}
                className={`
                  min-h-[96px] border-b border-r border-gray-100 dark:border-gray-800 p-1.5 cursor-pointer transition-colors relative
                  ${isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-400 dark:ring-blue-600'
                    : isOverdue
                      ? 'bg-red-50 dark:bg-red-900/20 ring-1 ring-inset ring-red-400 dark:ring-red-700 hover:bg-red-100 dark:hover:bg-red-900/30'
                      : isImminent
                        ? 'bg-amber-50 dark:bg-amber-900/10 ring-1 ring-inset ring-amber-300 dark:ring-amber-700/70 hover:bg-amber-100 dark:hover:bg-amber-900/20'
                        : isHoliday
                          ? 'bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }
                `}
                role="button"
                tabIndex={0}
                aria-label={isHoliday
                  ? t('cell_label_holiday', { month, day, name: holiday.name || t('holiday_fallback'), count: created.length })
                  : t('cell_label', { month, day, count: created.length })
                }
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedDate(isSelected ? null : dateStr) }}
              >
                {/* 날짜 숫자 + 공휴일 이름 */}
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <div className={`
                      text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full shrink-0
                      ${isToday ? 'bg-blue-600 text-white' : ''}
                      ${!isToday && isRedDay ? 'text-red-500 dark:text-red-400' : ''}
                      ${!isToday && !isRedDay && dow === 6 ? 'text-blue-500 dark:text-blue-400' : ''}
                      ${!isToday && !isRedDay && dow !== 6 ? 'text-gray-700 dark:text-gray-300' : ''}
                    `}>
                      {day}
                    </div>
                    {isOverdue && <span className="text-[9px] leading-tight text-red-600 dark:text-red-400 font-bold" title="SLA 위반">⚠️</span>}
                    {!isOverdue && isImminent && <span className="text-[9px] leading-tight text-amber-600 dark:text-amber-400" title="SLA 임박">⏳</span>}
                  </div>
                  {isHoliday && (
                    <span
                      className="text-[9px] leading-tight text-red-600 dark:text-red-400 font-medium text-right max-w-[60%] line-clamp-1"
                      title={holiday.name || t('holiday_fallback')}
                    >
                      {holiday.name || t('holiday_fallback')}
                    </span>
                  )}
                </div>

                {/* 티켓 뱃지 */}
                <div className="space-y-0.5">
                  {!loading && (
                    <>
                      {created.slice(0, 3).map(ticket => (
                        <TicketBadge key={`c-${ticket.iid}`} ticket={ticket} />
                      ))}
                      {created.length > 3 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 pl-1">
                          {t('more_items', { count: created.length - 3 })}
                        </span>
                      )}
                      {sla.length > 0 && (
                        <div className="mt-0.5 pt-0.5 border-t border-dashed border-red-200 dark:border-red-800">
                          {sla.slice(0, 2).map(ticket => (
                            <div key={`s-${ticket.iid}`} className="text-xs text-red-500 dark:text-red-400 truncate pl-1">
                              ⏰ #{ticket.iid}
                            </div>
                          ))}
                          {sla.length > 2 && (
                            <span className="text-xs text-red-400 dark:text-red-500 pl-1">+{sla.length - 2}</span>
                          )}
                        </div>
                      )}
                      {dayChanges.length > 0 && (
                        <div className="mt-0.5 pt-0.5 border-t border-dashed border-indigo-200 dark:border-indigo-800">
                          {dayChanges.slice(0, 2).map(c => (
                            <div key={`ch-${c.id}`} className="flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 truncate pl-1" title={c.title}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RISK_COLOR[c.risk_level] ?? 'bg-gray-400'}`} />
                              <span className="truncate">🛠 {c.title}</span>
                            </div>
                          ))}
                          {dayChanges.length > 2 && (
                            <span className="text-xs text-indigo-400 dark:text-indigo-500 pl-1">+{dayChanges.length - 2}</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 모바일 범례 (하단) */}
        <div className="sm:hidden flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400">
          {([
            { key: 'open',        label: t('legend_open') },
            { key: 'in_progress', label: t('legend_in_progress') },
            { key: 'closed',      label: t('legend_closed') },
          ] as { key: string; label: string }[]).map(({ key, label }) => (
            <span key={key} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[key].dot}`} />
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded border border-dashed border-red-400" />
            {t('legend_sla')}
          </span>
        </div>
      </div>

      {/* 선택된 날짜 슬라이드 패널 */}
      <SlidePanel
        date={selectedDate}
        tickets={selectedTickets}
        changes={selectedChanges}
        holiday={selectedHoliday}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  )
}

function SummaryStat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'amber' | 'red' | 'indigo' }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-mono font-semibold ${accent ? colors[accent] : 'text-gray-800 dark:text-gray-100'}`}>{value}</span>
    </span>
  )
}

export default function CalendarPage() {
  return (
    <RequireAuth>
      <CalendarContent />
    </RequireAuth>
  )
}
