'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fetchCalendarTickets, fetchHolidays, type CalendarTicket, type HolidayItem } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

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

function SlidePanel({
  date, tickets, holiday, onClose,
}: {
  date: string | null
  tickets: CalendarTicket[]
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
          {tickets.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">{t('no_tickets')}</p>
          ) : (
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

function CalendarContent() {
  const t = useTranslations('calendar')
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tickets, setTickets] = useState<CalendarTicket[]>([])
  const [holidays, setHolidays] = useState<HolidayItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

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

  const daysInMonth = getDaysInMonth(year, month)
  const firstDow = getFirstDayOfWeek(year, month)

  const holidayMap: Record<string, HolidayItem> = {}
  for (const h of holidays) holidayMap[h.date] = h

  const byCreatedDate: Record<string, CalendarTicket[]> = {}
  const bySLADate: Record<string, CalendarTicket[]> = {}

  for (const ticket of tickets) {
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

  const selectedTickets: CalendarTicket[] = selectedDate
    ? [...(byCreatedDate[selectedDate] ?? []), ...(bySLADate[selectedDate] ?? [])]
        .filter((tk, i, arr) => arr.findIndex(x => x.iid === tk.iid) === i)
    : []

  const selectedHoliday = selectedDate ? (holidayMap[selectedDate] ?? null) : null

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
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const dow = (firstDow + day - 1) % 7
            const holiday = holidayMap[dateStr]
            const isHoliday = !!holiday
            const isRedDay = dow === 0 || isHoliday

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`
                  min-h-[96px] border-b border-r border-gray-100 dark:border-gray-800 p-1.5 cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-400 dark:ring-blue-600'
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
                  <div className={`
                    text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full shrink-0
                    ${isToday ? 'bg-blue-600 text-white' : ''}
                    ${!isToday && isRedDay ? 'text-red-500 dark:text-red-400' : ''}
                    ${!isToday && !isRedDay && dow === 6 ? 'text-blue-500 dark:text-blue-400' : ''}
                    ${!isToday && !isRedDay && dow !== 6 ? 'text-gray-700 dark:text-gray-300' : ''}
                  `}>
                    {day}
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
        holiday={selectedHoliday}
        onClose={() => setSelectedDate(null)}
      />
    </div>
  )
}

export default function CalendarPage() {
  return (
    <RequireAuth>
      <CalendarContent />
    </RequireAuth>
  )
}
