'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import RequireAuth from '@/components/RequireAuth'
import { fetchGanttData } from '@/lib/api'
import type { GanttTicket, GanttLink } from '@/types'

// ─── 상수 ──────────────────────────────────────────────────────────────────
const ROW_HEIGHT = 40
const BAR_HEIGHT = 28
const BAR_OFFSET_Y = (ROW_HEIGHT - BAR_HEIGHT) / 2
const LABEL_WIDTH = 280
const DAY_WIDTH = 28
const HEADER_HEIGHT = 48

// ─── 색상 ──────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  open: '#3b82f6',
  in_progress: '#eab308',
  closed: '#22c55e',
  resolved: '#10b981',
  approved: '#8b5cf6',
  waiting: '#f97316',
  testing: '#06b6d4',
  ready_for_release: '#6366f1',
  released: '#14b8a6',
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#6b7280',
}

const LINK_COLOR: Record<string, string> = {
  blocks: '#ef4444',
  related: '#6b7280',
  relates_to: '#6b7280',
  duplicate_of: '#a855f7',
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────
function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00')
}

function dateToX(d: Date, minDate: Date): number {
  const diff = Math.floor((d.getTime() - minDate.getTime()) / 86400000)
  return diff * DAY_WIDTH
}

function formatDateLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ─── 툴팁 ──────────────────────────────────────────────────────────────────
interface TooltipState {
  x: number
  y: number
  ticket: GanttTicket
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────
function GanttContent() {
  const router = useRouter()
  const t = useTranslations('gantt')
  const ts = useTranslations('ticket.status')
  const tp = useTranslations('ticket.priority')
  const [days, setDays] = useState<14 | 30 | 60>(30)
  const [tickets, setTickets] = useState<GanttTicket[]>([])
  const [links, setLinks] = useState<GanttLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchGanttData(d)
      const sorted = [...data.tickets].sort((a, b) => a.start.localeCompare(b.start))
      setTickets(sorted)
      setLinks(data.links)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(days)
  }, [days, load])

  // 날짜 범위 계산
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minDate = new Date(today)
  minDate.setDate(today.getDate() - days)
  const maxDate = new Date(today)
  maxDate.setDate(today.getDate() + 7)

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000)
  const svgWidth = totalDays * DAY_WIDTH
  const svgHeight = tickets.length * ROW_HEIGHT + HEADER_HEIGHT

  // 날짜 눈금 (7일 간격)
  const dateMarkers: Date[] = []
  const cur = new Date(minDate)
  while (cur <= maxDate) {
    dateMarkers.push(new Date(cur))
    cur.setDate(cur.getDate() + 7)
  }

  const todayX = dateToX(today, minDate)
  const iidToIndex = new Map<number, number>()
  tickets.forEach((tk, i) => iidToIndex.set(tk.iid, i))

  function barCoords(ticket: GanttTicket) {
    const start = parseDate(ticket.start)
    const end = parseDate(ticket.end)
    const x1 = Math.max(0, dateToX(start, minDate))
    const x2 = Math.max(x1 + 8, dateToX(end, minDate))
    return { x1, x2, width: x2 - x1 }
  }

  function arrowPath(fromIdx: number, toIdx: number): string {
    const fromTicket = tickets[fromIdx]
    const toTicket = tickets[toIdx]
    const { x2: fx } = barCoords(fromTicket)
    const { x1: tx } = barCoords(toTicket)
    const fy = HEADER_HEIGHT + fromIdx * ROW_HEIGHT + BAR_OFFSET_Y + BAR_HEIGHT / 2
    const ty = HEADER_HEIGHT + toIdx * ROW_HEIGHT + BAR_OFFSET_Y + BAR_HEIGHT / 2
    const midX = (fx + tx) / 2
    return `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`
  }

  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          {t('title')}
        </h1>
      </div>

      {/* 메인 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden mb-4">
        {/* 툴바 */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('col_ticket')}</span>
            {!loading && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({tickets.length}건)
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {([14, 30, 60] as const).map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                {t('day_range', { n: d })}
              </button>
            ))}
          </div>
        </div>

        {/* 차트 영역 */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500">
            <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm">{t('loading')}</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-500 text-sm">
            {error}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-gray-500">
            <svg className="w-10 h-10 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10" />
            </svg>
            <span className="text-sm">{t('no_tickets')}</span>
          </div>
        ) : (
          <div className="flex">
            {/* 좌측 레이블 */}
            <div className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700" style={{ width: LABEL_WIDTH }}>
              {/* 레이블 헤더 */}
              <div
                className="flex items-center px-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                style={{ height: HEADER_HEIGHT }}
              >
                {t('col_ticket')}
              </div>
              {/* 레이블 행 */}
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {tickets.map((ticket) => (
                  <div
                    key={ticket.iid}
                    onClick={() => router.push(`/tickets/${ticket.iid}`)}
                    className="group flex items-center gap-2 px-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="font-mono text-xs text-gray-400 dark:text-gray-500 shrink-0 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      #{ticket.iid}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {ticket.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 우측 SVG 스크롤 영역 */}
            <div ref={scrollRef} className="flex-1 overflow-x-auto relative">
              <svg
                ref={svgRef}
                width={svgWidth}
                height={svgHeight}
                className="block"
                style={{ minWidth: svgWidth }}
              >
                {/* 날짜 헤더 배경 */}
                <rect x={0} y={0} width={svgWidth} height={HEADER_HEIGHT}
                  className="fill-gray-50 dark:fill-gray-800/60" />

                {/* 날짜 눈금선 + 레이블 */}
                {dateMarkers.map((d, i) => {
                  const x = dateToX(d, minDate)
                  return (
                    <g key={i}>
                      <line
                        x1={x} y1={HEADER_HEIGHT} x2={x} y2={svgHeight}
                        stroke="#e5e7eb" strokeWidth={1}
                        className="dark:stroke-gray-700/50"
                      />
                      <text
                        x={x + 4} y={HEADER_HEIGHT - 10}
                        fontSize={10} fill="#9ca3af"
                        fontFamily="ui-monospace, monospace"
                      >
                        {formatDateLabel(d)}
                      </text>
                    </g>
                  )
                })}

                {/* 헤더 하단 구분선 */}
                <line x1={0} y1={HEADER_HEIGHT} x2={svgWidth} y2={HEADER_HEIGHT}
                  stroke="#e5e7eb" strokeWidth={1}
                  className="dark:stroke-gray-700" />

                {/* 행 줄무늬 배경 */}
                {tickets.map((_, i) => (
                  i % 2 === 1 ? (
                    <rect
                      key={i}
                      x={0} y={HEADER_HEIGHT + i * ROW_HEIGHT}
                      width={svgWidth} height={ROW_HEIGHT}
                      className="fill-gray-50/80 dark:fill-gray-800/20"
                    />
                  ) : null
                ))}

                {/* 의존 관계 화살표 */}
                {links.map((link, i) => {
                  const fromIdx = iidToIndex.get(link.from)
                  const toIdx = iidToIndex.get(link.to)
                  if (fromIdx === undefined || toIdx === undefined) return null
                  const color = LINK_COLOR[link.type] ?? '#6b7280'
                  const path = arrowPath(fromIdx, toIdx)
                  return (
                    <g key={i}>
                      <defs>
                        <marker
                          id={`arrow-${i}`}
                          markerWidth="8" markerHeight="8"
                          refX="6" refY="3"
                          orient="auto"
                        >
                          <path d="M0,0 L0,6 L8,3 z" fill={color} />
                        </marker>
                      </defs>
                      <path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray={link.type === 'relates_to' || link.type === 'related' ? '4,3' : undefined}
                        markerEnd={`url(#arrow-${i})`}
                        opacity={0.7}
                      />
                    </g>
                  )
                })}

                {/* 간트 바 */}
                {tickets.map((ticket, i) => {
                  const { x1, width } = barCoords(ticket)
                  const y = HEADER_HEIGHT + i * ROW_HEIGHT + BAR_OFFSET_Y
                  const color = STATUS_COLOR[ticket.status] ?? '#6b7280'
                  const prioColor = PRIORITY_COLOR[ticket.priority] ?? '#6b7280'

                  return (
                    <g
                      key={ticket.iid}
                      onClick={() => router.push(`/tickets/${ticket.iid}`)}
                      onMouseEnter={(e) => {
                        const rect = svgRef.current?.getBoundingClientRect()
                        if (rect) {
                          setTooltip({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8, ticket })
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={x1} y={y}
                        width={Math.max(width, 4)} height={BAR_HEIGHT}
                        rx={4} ry={4}
                        fill={color}
                        opacity={0.85}
                      />
                      <circle
                        cx={x1 + Math.max(width, 4) - 10}
                        cy={y + BAR_HEIGHT / 2}
                        r={4}
                        fill={prioColor}
                        opacity={0.9}
                      />
                      {width > 50 && (
                        <text
                          x={x1 + 6}
                          y={y + BAR_HEIGHT / 2 + 4}
                          fontSize={11}
                          fill="white"
                          fontWeight="500"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {ticket.title.length > 20 ? ticket.title.slice(0, 20) + '…' : ticket.title}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* 오늘 기준선 */}
                {todayX >= 0 && todayX <= svgWidth && (
                  <g>
                    <line
                      x1={todayX} y1={0} x2={todayX} y2={svgHeight}
                      stroke="#ef4444" strokeWidth={1.5}
                      strokeDasharray="4,3"
                      opacity={0.7}
                    />
                    <text
                      x={todayX + 3} y={14}
                      fontSize={10} fill="#ef4444"
                      fontWeight="600"
                      fontFamily="ui-sans-serif, sans-serif"
                    >
                      {t('today')}
                    </text>
                  </g>
                )}
              </svg>

              {/* 툴팁 */}
              {tooltip && (
                <div
                  className="absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 text-sm pointer-events-none max-w-[240px]"
                  style={{ left: tooltip.x, top: tooltip.y }}
                >
                  <div className="font-semibold text-gray-900 dark:text-white mb-1 truncate">
                    #{tooltip.ticket.iid} {tooltip.ticket.title}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: STATUS_COLOR[tooltip.ticket.status] ?? '#6b7280' }}
                    >
                      {tooltip.ticket.status}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: PRIORITY_COLOR[tooltip.ticket.priority] ?? '#6b7280' }}
                    >
                      {tooltip.ticket.priority}
                    </span>
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 text-xs space-y-0.5">
                    <div>{t('tooltip_start')} {tooltip.ticket.start}</div>
                    <div>{t('tooltip_end')} {tooltip.ticket.end}</div>
                    {tooltip.ticket.assignee && (
                      <div>{t('tooltip_assignee')} {tooltip.ticket.assignee}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 범례 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('legend_dep_title')}</span>
        </div>
        <div className="px-4 py-3 space-y-3">
          {/* 상태 + 우선순위 */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-600 dark:text-gray-300">{t('legend_status')}</span>
              {([
                { key: 'open',        label: ts('open') },
                { key: 'in_progress', label: ts('in_progress') },
                { key: 'testing',     label: ts('testing') },
                { key: 'resolved',    label: ts('resolved') },
                { key: 'closed',      label: ts('closed') },
                { key: 'waiting',     label: ts('waiting') },
              ] as { key: string; label: string }[]).map(({ key, label }) => (
                <span key={key} className="flex items-center gap-1">
                  <span className="inline-block w-8 h-3 rounded-sm opacity-85" style={{ backgroundColor: STATUS_COLOR[key] }} />
                  <span>{label}</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-600 dark:text-gray-300">{t('legend_priority')}</span>
              {([
                { key: 'critical', label: tp('critical') },
                { key: 'high',     label: tp('high') },
                { key: 'medium',   label: tp('medium') },
                { key: 'low',      label: tp('low') },
              ] as { key: string; label: string }[]).map(({ key, label }) => (
                <span key={key} className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[key] }} />
                  <span>{label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* 의존 관계 선 설명 */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700/50">
            {/* blocks */}
            <div className="flex items-center gap-2">
              <svg width="40" height="14" aria-hidden="true" className="shrink-0">
                <defs>
                  <marker id="leg-blocks" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L7,3 z" fill="#ef4444" />
                  </marker>
                </defs>
                <line x1="2" y1="7" x2="33" y2="7" stroke="#ef4444" strokeWidth="2" markerEnd="url(#leg-blocks)" />
              </svg>
              <div>
                <span className="font-medium text-red-600 dark:text-red-400">{t('link_blocks')}</span>
                <p className="text-gray-400 dark:text-gray-500 mt-0.5">{t('link_blocks_desc')}</p>
              </div>
            </div>
            {/* relates_to */}
            <div className="flex items-center gap-2">
              <svg width="40" height="14" aria-hidden="true" className="shrink-0">
                <defs>
                  <marker id="leg-relates" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L7,3 z" fill="#6b7280" />
                  </marker>
                </defs>
                <line x1="2" y1="7" x2="33" y2="7" stroke="#6b7280" strokeWidth="2" strokeDasharray="4,3" markerEnd="url(#leg-relates)" />
              </svg>
              <div>
                <span className="font-medium text-gray-600 dark:text-gray-300">{t('link_relates')}</span>
                <p className="text-gray-400 dark:text-gray-500 mt-0.5">{t('link_relates_desc')}</p>
              </div>
            </div>
            {/* duplicate_of */}
            <div className="flex items-center gap-2">
              <svg width="40" height="14" aria-hidden="true" className="shrink-0">
                <defs>
                  <marker id="leg-dup" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L7,3 z" fill="#a855f7" />
                  </marker>
                </defs>
                <line x1="2" y1="7" x2="33" y2="7" stroke="#a855f7" strokeWidth="2" strokeDasharray="2,2" markerEnd="url(#leg-dup)" />
              </svg>
              <div>
                <span className="font-medium text-purple-600 dark:text-purple-400">{t('link_duplicate')}</span>
                <p className="text-gray-400 dark:text-gray-500 mt-0.5">{t('link_duplicate_desc')}</p>
              </div>
            </div>
            {/* today line */}
            <div className="flex items-center gap-2">
              <svg width="40" height="14" aria-hidden="true" className="shrink-0">
                <line x1="20" y1="0" x2="20" y2="14" stroke="#ef4444" strokeWidth="2" strokeDasharray="3,2" opacity="0.8" />
              </svg>
              <div>
                <span className="font-medium text-red-500 dark:text-red-400">{t('today')}</span>
                <p className="text-gray-400 dark:text-gray-500 mt-0.5">현재 날짜 기준선</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GanttPage() {
  return (
    <RequireAuth>
      <GanttContent />
    </RequireAuth>
  )
}
