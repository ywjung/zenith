'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchTrends, exportReport, exportReportXlsx, fetchRatingStats, fetchCurrentStats, fetchBreakdown, fetchAgentPerformance, fetchDoraMetrics, fetchSLAHeatmap } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { useRoleLabels } from '@/context/RoleLabelsContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName } from '@/lib/utils'
import type { RatingStats, RealtimeStats, BreakdownStats, AgentPerformance, DoraMetrics, DoraMetricItem } from '@/types'

type TrendRow = {
  snapshot_date: string
  total_open: number
  total_in_progress: number
  total_closed: number
  total_new: number
  total_breached: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function thisMonthStart(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
}

function SummarySection({ from, to }: { from: string; to: string }) {
  const [ticket, setTicket] = useState<RealtimeStats | null>(null)
  const [rating, setRating] = useState<RatingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    Promise.allSettled([
      fetchCurrentStats({ from, to }),
      fetchRatingStats({ from, to }),
    ])
      .then(([tResult, rResult]) => {
        if (tResult.status === 'fulfilled') setTicket(tResult.value)
        if (rResult.status === 'fulfilled') setRating(rResult.value)
        if (tResult.status === 'rejected' && rResult.status === 'rejected') setError(true)
      })
      .finally(() => setLoading(false))
  }, [from, to])

  const satisfactionPct = rating && rating.total > 0
    ? Math.round(((rating.distribution[4] ?? 0) + (rating.distribution[5] ?? 0)) / rating.total * 100)
    : 0

  const cards = [
    { label: '신규 티켓', value: ticket?.new,          color: 'text-blue-600',   border: 'border-blue-100 dark:border-blue-900/50' },
    { label: '처리 완료', value: ticket?.closed,        color: 'text-green-600',  border: 'border-green-100 dark:border-green-900/50' },
    { label: 'SLA 위반',  value: ticket?.sla_breached,  color: 'text-red-600',    border: 'border-red-100 dark:border-red-900/50' },
    {
      label: '평균 만족도',
      value: rating?.average !== null && rating?.average !== undefined
        ? rating.average.toFixed(1)
        : '-',
      color: 'text-yellow-500', border: 'border-yellow-100 dark:border-yellow-900/50',
      sub: rating?.average != null
        ? '★'.repeat(Math.round(rating.average)) + '☆'.repeat(5 - Math.round(rating.average))
        : null,
    },
    { label: '평가 건수',   value: rating?.total,       color: 'text-indigo-600', border: 'border-indigo-100 dark:border-indigo-900/50' },
    { label: '만족 비율',   value: `${satisfactionPct}%`, color: 'text-teal-600', border: 'border-teal-100 dark:border-teal-900/50',
      sub: '4점 이상' },
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm text-center animate-pulse">
            <div className="h-9 bg-gray-200 dark:bg-gray-700 rounded mb-2 mx-auto w-14" />
            <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded mx-auto w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg p-4 mb-6 text-sm">
        ⚠️ 통계를 불러오지 못했습니다.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map(({ label, value, color, border, sub }) => (
        <div key={label} className={`bg-white dark:bg-gray-900 border dark:border-gray-700 ${border} rounded-lg p-4 shadow-sm text-center`}>
          <div className={`text-3xl font-bold ${color}`}>{value ?? '-'}</div>
          {sub && <div className="text-xs text-yellow-400 mt-0.5">{sub}</div>}
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</div>
        </div>
      ))}
    </div>
  )
}

function RatingDetail({ from, to }: { from: string; to: string }) {
  const [stats, setStats] = useState<RatingStats | null>(null)

  useEffect(() => {
    fetchRatingStats({ from, to })
      .then(setStats)
      .catch(() => setStats(null))
  }, [from, to])

  if (!stats || stats.total === 0) return null

  const scoreLabels: Record<number, string> = { 5: '매우 만족', 4: '만족', 3: '보통', 2: '불만족', 1: '매우 불만족' }
  const scoreColors: Record<number, string> = {
    5: 'bg-green-500', 4: 'bg-blue-400', 3: 'bg-yellow-400', 2: 'bg-orange-400', 1: 'bg-red-500',
  }

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">만족도 상세</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 점수 분포 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">점수 분포</h3>
          <div className="space-y-3">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = stats.distribution[score] ?? 0
              const pct = stats.total > 0 ? Math.round(count / stats.total * 100) : 0
              return (
                <div key={score} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {'★'.repeat(score)} {scoreLabels[score]}
                  </div>
                  <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${scoreColors[score]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-14 text-right text-xs text-gray-500 dark:text-gray-400 shrink-0">{count}건 ({pct}%)</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 최근 평가 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">최근 평가</h3>
          </div>
          <div className="divide-y dark:divide-gray-700 max-h-64 overflow-y-auto">
            {stats.recent.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <span className="text-yellow-400 text-sm shrink-0">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Link href={`/tickets/${r.gitlab_issue_iid}`} className="text-blue-600 hover:underline font-medium">
                      #{r.gitlab_issue_iid}
                    </Link>
                    <span className="text-gray-600 dark:text-gray-300">{r.employee_name}</span>
                    <span className="text-gray-400 dark:text-gray-500">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  {r.comment && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">&ldquo;{r.comment}&rdquo;</p>}
                </div>
                <span className="text-sm font-bold text-gray-600 dark:text-gray-300 shrink-0">{r.score}점</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

const STATUS_KO: Record<string, string> = {
  open: '접수됨', approved: '승인완료', in_progress: '처리중',
  waiting: '대기중', resolved: '처리완료', testing: '테스트중',
  ready_for_release: '운영배포전', released: '운영반영완료', closed: '종료',
}
const STATUS_COLOR: Record<string, { text: string; border: string }> = {
  open:             { text: 'text-blue-600',   border: 'border-blue-100 dark:border-blue-900/50' },
  approved:         { text: 'text-teal-600',   border: 'border-teal-100 dark:border-teal-900/50' },
  in_progress:      { text: 'text-yellow-600', border: 'border-yellow-100 dark:border-yellow-900/50' },
  waiting:          { text: 'text-purple-600', border: 'border-purple-100 dark:border-purple-900/50' },
  resolved:         { text: 'text-green-600',  border: 'border-green-100 dark:border-green-900/50' },
  testing:          { text: 'text-violet-600', border: 'border-violet-100 dark:border-violet-900/50' },
  ready_for_release:{ text: 'text-orange-600', border: 'border-orange-100 dark:border-orange-900/50' },
  released:         { text: 'text-indigo-600', border: 'border-indigo-100 dark:border-indigo-900/50' },
  closed:           { text: 'text-gray-500',   border: 'border-gray-200 dark:border-gray-700' },
}
const PRIORITY_KO: Record<string, string> = { critical: '긴급', high: '높음', medium: '보통', low: '낮음' }
const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-yellow-400', low: 'bg-blue-400',
}
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
function BreakdownSection({ from, to }: { from: string; to: string }) {
  const { getLabel: getCatLabel } = useServiceTypes()
  const [data, setData] = useState<BreakdownStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchBreakdown({ from, to })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading) return (
    <div className="mt-8">
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-4 animate-pulse" />
      <div className="h-24 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
    </div>
  )
  if (!data) return null

  const total = data.total
  const statuses = ['open', 'approved', 'in_progress', 'waiting', 'resolved', 'testing', 'ready_for_release', 'released', 'closed'] as const

  // 카테고리 정렬 (건수 내림차순)
  const catEntries = Object.entries(data.by_category).sort((a, b) => b[1] - a[1])
  const prioEntries = PRIORITY_ORDER
    .filter(p => data.by_priority[p] != null)
    .map(p => [p, data.by_priority[p]] as [string, number])
  const maxCat = Math.max(...catEntries.map(([, v]) => v), 1)
  const maxPrio = Math.max(...prioEntries.map(([, v]) => v), 1)

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">기간 내 티켓 현황</h2>

      {/* 상태별 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3 mb-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{total}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">전체</div>
        </div>
        {statuses.map((s) => (
          <div key={s} className={`bg-white dark:bg-gray-900 border ${STATUS_COLOR[s]?.border ?? 'border-gray-200 dark:border-gray-700'} rounded-lg p-4 shadow-sm text-center`}>
            <div className={`text-3xl font-bold ${STATUS_COLOR[s]?.text ?? 'text-gray-600'}`}>
              {data.by_status[s] ?? 0}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{STATUS_KO[s]}</div>
          </div>
        ))}
      </div>

      {/* 카테고리별 / 우선순위별 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 카테고리별 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">카테고리별</h3>
          {catEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {catEntries.map(([cat, count]) => {
                const pct = Math.round(count / maxCat * 100)
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-gray-600 dark:text-gray-400 shrink-0 truncate">
                      {getCatLabel(cat)}
                    </div>
                    <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-gray-600 dark:text-gray-400 shrink-0">
                      {count}건 ({total > 0 ? Math.round(count / total * 100) : 0}%)
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 우선순위별 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">우선순위별</h3>
          {prioEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {prioEntries.map(([prio, count]) => {
                const pct = Math.round(count / maxPrio * 100)
                return (
                  <div key={prio} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-gray-600 dark:text-gray-400 shrink-0">
                      {PRIORITY_KO[prio] ?? prio}
                    </div>
                    <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${PRIORITY_COLOR[prio] ?? 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-gray-600 dark:text-gray-400 shrink-0">
                      {count}건 ({total > 0 ? Math.round(count / total * 100) : 0}%)
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

const TREND_PRESETS = [
  { label: '2주', days: 14 },
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TrendTable({ from: _from, to: _to }: { from: string; to: string }) {
  const [preset, setPreset] = useState(14)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]   = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const effectiveFrom = useCustom && customFrom ? customFrom : daysAgo(preset)
  const effectiveTo   = useCustom && customTo   ? customTo   : toDateStr(new Date())

  const [rows, setRows] = useState<TrendRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchTrends({ from: effectiveFrom, to: effectiveTo })
      .then((data) => {
        const map = new Map<string, TrendRow>()
        for (const row of data as TrendRow[]) {
          const existing = map.get(row.snapshot_date)
          if (existing) {
            existing.total_new         += row.total_new
            existing.total_open        += row.total_open
            existing.total_in_progress += row.total_in_progress
            existing.total_closed      += row.total_closed
            existing.total_breached    += row.total_breached
          } else {
            map.set(row.snapshot_date, { ...row })
          }
        }
        setRows(Array.from(map.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)))
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [effectiveFrom, effectiveTo])

  const maxNew = Math.max(...rows.map(r => r.total_new), 1)

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />

      {/* 헤더 + 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">📊 일별 스냅샷 추이</h2>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 프리셋 버튼 */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {TREND_PRESETS.map(p => (
              <button
                key={p.days}
                onClick={() => { setPreset(p.days); setUseCustom(false) }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  !useCustom && preset === p.days
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 직접 입력 토글 */}
          <button
            onClick={() => setUseCustom(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              useCustom
                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            직접 입력
          </button>
        </div>
      </div>

      {/* 직접 입력 패널 */}
      {useCustom && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
          <label className="text-xs text-blue-700 dark:text-blue-400 font-medium">기간</label>
          <input
            type="date" value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date" value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-blue-600 dark:text-blue-400">
            {effectiveFrom} ~ {effectiveTo}
          </span>
        </div>
      )}

      {/* 현재 기간 표시 (프리셋일 때) */}
      {!useCustom && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          {effectiveFrom} ~ {effectiveTo} ({rows.length}일)
        </p>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4 text-sm">⚠️ {error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 animate-pulse">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p>해당 기간에 스냅샷 데이터가 없습니다.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">스냅샷은 매일 자정에 자동 생성됩니다.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 w-32">날짜</th>
                <th className="px-4 py-3 text-right font-semibold text-blue-600">당일 신규</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">접수됨</th>
                <th className="px-4 py-3 text-right font-semibold text-orange-600 hidden md:table-cell">
                  처리 중<span className="font-normal text-xs text-gray-400 ml-1">(대기·완료 포함)</span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-green-600 hidden sm:table-cell">누적 종료</th>
                <th className="px-4 py-3 text-right font-semibold text-red-600">SLA 위반</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {rows.map((row) => {
                const barWidth = maxNew > 0 ? Math.round((row.total_new / maxNew) * 100) : 0
                return (
                  <tr key={row.snapshot_date} className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {row.snapshot_date}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* 미니 바 차트 */}
                        <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden hidden lg:block">
                          <div
                            className="h-full bg-blue-400 dark:bg-blue-500 rounded-full"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <span className="text-blue-600 dark:text-blue-400 font-semibold tabular-nums w-8 text-right">
                          {row.total_new}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums hidden sm:table-cell">{row.total_open}</td>
                    <td className="px-4 py-2.5 text-right text-orange-600 dark:text-orange-400 tabular-nums hidden md:table-cell">{row.total_in_progress}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400 tabular-nums hidden sm:table-cell">{row.total_closed}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.total_breached > 0
                        ? <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                            {row.total_breached}
                          </span>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* 합계 행 */}
            <tfoot className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <tr>
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">합계 / 평균</td>
                <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400 font-bold tabular-nums">
                  {rows.reduce((s, r) => s + r.total_new, 0)}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400 tabular-nums hidden sm:table-cell">
                  {Math.round(rows.reduce((s, r) => s + r.total_open, 0) / rows.length)}
                  <span className="text-xs text-gray-300 dark:text-gray-600 ml-0.5">avg</span>
                </td>
                <td className="px-4 py-2.5 text-right text-orange-500 tabular-nums hidden md:table-cell">
                  {Math.round(rows.reduce((s, r) => s + r.total_in_progress, 0) / rows.length)}
                  <span className="text-xs text-gray-300 dark:text-gray-600 ml-0.5">avg</span>
                </td>
                <td className="px-4 py-2.5 hidden sm:table-cell" />
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                  {rows.reduce((s, r) => s + r.total_breached, 0) > 0
                    ? <span className="text-red-600 dark:text-red-400">{rows.reduce((s, r) => s + r.total_breached, 0)}</span>
                    : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  )
}

function AgentPerformanceSection({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<AgentPerformance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchAgentPerformance({ from, to })
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading) return <div className="text-center py-12 text-gray-400 dark:text-gray-500">불러오는 중...</div>
  if (data.length === 0) return <div className="text-center py-12 text-gray-400 dark:text-gray-500">해당 기간에 데이터가 없습니다.</div>

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">담당자</th>
            <th className="px-4 py-3 text-right font-semibold text-blue-600">배정</th>
            <th className="px-4 py-3 text-right font-semibold text-green-600">처리완료</th>
            <th className="px-4 py-3 text-right font-semibold text-yellow-500">평균 만족도</th>
            <th className="px-4 py-3 text-right font-semibold text-purple-600">SLA 준수율</th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-gray-700">
          {data.map((agent) => (
            <tr key={agent.agent_username} className="hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-800 dark:text-gray-100">{formatName(agent.agent_name)}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">@{agent.agent_username}</div>
              </td>
              <td className="px-4 py-3 text-right text-blue-600 font-medium">{agent.assigned}</td>
              <td className="px-4 py-3 text-right text-green-600 font-medium">{agent.resolved}</td>
              <td className="px-4 py-3 text-right">
                {agent.avg_rating != null ? (
                  <span className="text-yellow-500 font-medium">{agent.avg_rating.toFixed(1)}★</span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {agent.sla_met_rate != null ? (
                  <span className={`font-medium ${agent.sla_met_rate >= 90 ? 'text-green-600' : agent.sla_met_rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {agent.sla_met_rate.toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const GRADE_COLOR: Record<string, string> = {
  Elite:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  High:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  Low:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'N/A':  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function DoraCard({ title, metric, icon }: { title: string; metric: DoraMetricItem; icon: string }) {
  const gradeClass = GRADE_COLOR[metric.grade] ?? GRADE_COLOR['N/A']
  return (
    <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{icon} {title}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${gradeClass}`}>{metric.grade}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900 dark:text-white">
        {metric.value !== null ? metric.value.toLocaleString() : '—'}
        <span className="text-base font-normal text-gray-500 dark:text-gray-400 ml-1">{metric.unit}</span>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{metric.description}</p>
      {metric.resolved_count !== undefined && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          완료 {metric.resolved_count}건 / 재오픈 {metric.reopened_count}건
        </p>
      )}
    </div>
  )
}

type HeatCell = { date: string; breached: number; total: number }

const HEAT_LEVELS = [
  { bg: 'bg-gray-100 dark:bg-gray-800',       border: 'border-gray-200 dark:border-gray-700', label: '0건' },
  { bg: 'bg-red-100 dark:bg-red-950',         border: 'border-red-200 dark:border-red-900',   label: '1건' },
  { bg: 'bg-red-300 dark:bg-red-800',         border: 'border-red-300 dark:border-red-700',   label: '2~3건' },
  { bg: 'bg-red-500 dark:bg-red-600',         border: 'border-red-400 dark:border-red-500',   label: '4~7건' },
  { bg: 'bg-red-700 dark:bg-red-500',         border: 'border-red-600 dark:border-red-400',   label: '8건+' },
]

function heatLevel(breached: number): number {
  if (breached === 0) return 0
  if (breached === 1) return 1
  if (breached <= 3) return 2
  if (breached <= 7) return 3
  return 4
}

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']
const MONTH_KO   = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

function SLAHeatmap({ weeks }: { weeks: number }) {
  const [data, setData] = useState<HeatCell[]>([])
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchSLAHeatmap({ weeks })
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [weeks])

  if (loading) {
    return (
      <div className="mt-8 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-36" />
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-24" />
        </div>
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-5 shadow-sm">
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg" />
        </div>
      </div>
    )
  }

  if (data.length === 0) return null

  // 날짜 → 주 그루핑
  const weekMap = new Map<string, (HeatCell | null)[]>()
  for (const cell of data) {
    const d = new Date(cell.date + 'T00:00:00')
    const dow = (d.getDay() + 6) % 7   // 월=0 … 일=6
    const mon = new Date(d)
    mon.setDate(d.getDate() - dow)
    const key = mon.toISOString().slice(0, 10)
    if (!weekMap.has(key)) weekMap.set(key, Array(7).fill(null))
    weekMap.get(key)![dow] = cell
  }

  const weekKeys   = Array.from(weekMap.keys()).sort()
  const totalBreached = data.reduce((s, d) => s + d.breached, 0)
  const totalTickets  = data.reduce((s, d) => s + d.total,    0)
  const maxBreached   = Math.max(...data.map(d => d.breached), 0)
  const worstDay      = data.find(d => d.breached === maxBreached)
  const activeDays    = data.filter(d => d.total > 0).length
  const violationRate = totalTickets > 0 ? Math.round((totalBreached / totalTickets) * 100) : 0

  // 월 레이블 — 각 주의 첫 번째 날이 이전 주와 다른 달이면 레이블 표시
  const monthLabels: (string | null)[] = weekKeys.map((wk, i) => {
    const month = new Date(wk + 'T00:00:00').getMonth()
    if (i === 0) return MONTH_KO[month]
    const prevMonth = new Date(weekKeys[i - 1] + 'T00:00:00').getMonth()
    return month !== prevMonth ? MONTH_KO[month] : null
  })

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />

      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">🗓️ SLA 위반 히트맵</h2>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
            최근 {weeks}주
          </span>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: '총 위반 건수',  value: `${totalBreached}건`,       sub: `전체 ${totalTickets}건 중`,      color: totalBreached > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200' },
          { label: '위반율',        value: `${violationRate}%`,         sub: '티켓 대비',                      color: violationRate > 20 ? 'text-red-600 dark:text-red-400' : violationRate > 10 ? 'text-orange-500' : 'text-gray-800 dark:text-gray-200' },
          { label: '최고 위반일',   value: maxBreached > 0 ? `${maxBreached}건` : '—', sub: worstDay?.date ?? '',  color: maxBreached > 5 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200' },
          { label: '위반 발생일수', value: `${activeDays > 0 ? data.filter(d => d.breached > 0).length : 0}일`, sub: `${activeDays}일 운영 중`, color: 'text-gray-800 dark:text-gray-200' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* 히트맵 본체 */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm overflow-x-auto relative"
        onMouseLeave={() => setTooltip(null)}>

        <div className="flex gap-[3px] min-w-max">
          {/* 요일 레이블 */}
          <div className="flex flex-col gap-[3px] mr-2 justify-start" style={{ paddingTop: '22px' }}>
            {DAY_LABELS.map((d, i) => (
              <div key={d}
                className={`w-[14px] h-[14px] text-[10px] leading-none flex items-center justify-end pr-0.5 select-none ${
                  i % 2 === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-transparent'
                }`}>
                {d}
              </div>
            ))}
          </div>

          {/* 주 컬럼 */}
          {weekKeys.map((wk, wi) => {
            const cells = weekMap.get(wk)!
            return (
              <div key={wk} className="flex flex-col gap-[3px]">
                {/* 월 레이블 */}
                <div className="h-[18px] text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap leading-tight select-none">
                  {monthLabels[wi] ?? ''}
                </div>
                {cells.map((cell, dow) => {
                  if (!cell) {
                    return <div key={dow} className="w-[14px] h-[14px] rounded-sm" />
                  }
                  const lv = heatLevel(cell.breached)
                  const { bg } = HEAT_LEVELS[lv]
                  return (
                    <div
                      key={dow}
                      className={`w-[14px] h-[14px] rounded-sm ${bg} cursor-pointer transition-all hover:ring-1 hover:ring-gray-400 dark:hover:ring-gray-400 hover:scale-125`}
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const parent = (e.currentTarget as HTMLElement).closest('.relative')!.getBoundingClientRect()
                        setTooltip({ cell, x: rect.left - parent.left + 8, y: rect.top - parent.top + 20 })
                      }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* 툴팁 */}
        {tooltip && (
          <div
            className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
            style={{ left: tooltip.x, top: tooltip.y }}>
            <p className="font-semibold mb-0.5">{tooltip.cell.date}</p>
            <p className="text-gray-300">
              SLA 위반 <span className={`font-bold ${tooltip.cell.breached > 0 ? 'text-red-300' : 'text-green-300'}`}>
                {tooltip.cell.breached}건
              </span>
              {tooltip.cell.total > 0 && (
                <> / 전체 {tooltip.cell.total}건
                  {' '}({Math.round((tooltip.cell.breached / tooltip.cell.total) * 100)}%)
                </>
              )}
            </p>
          </div>
        )}

        {/* 범례 */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">위반 없음</span>
          <div className="flex items-center gap-1">
            {HEAT_LEVELS.map((lv, i) => (
              <div key={i} title={lv.label}
                className={`w-[14px] h-[14px] rounded-sm ${lv.bg} border ${lv.border}`} />
            ))}
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">많음</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {HEAT_LEVELS.slice(1).map((lv, i) => (
              <span key={i} className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${lv.bg}`} />
                {lv.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function DoraSection({ days }: { days: number }) {
  const [data, setData] = useState<DoraMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchDoraMetrics({ days })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="py-10 text-center text-gray-400 text-sm">로딩 중...</div>
  if (error || !data) return <div className="py-10 text-center text-red-400 text-sm">DORA 지표를 불러오지 못했습니다.</div>

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">DORA 4대 지표</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">최근 {data.period_days}일 기준</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <DoraCard title="배포 빈도" metric={data.deployment_frequency} icon="🚀" />
        <DoraCard title="리드타임" metric={data.lead_time} icon="⏱️" />
        <DoraCard title="변경 실패율" metric={data.change_failure_rate} icon="🔁" />
        <DoraCard title="평균 복구 시간 (MTTR)" metric={data.mttr} icon="🛠️" />
      </div>
      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 flex gap-4 flex-wrap">
        {Object.entries(GRADE_COLOR).map(([grade, cls]) => (
          <span key={grade} className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{grade}</span>
        ))}
        <span className="text-gray-400">— DORA Research 2023 기준</span>
      </div>
    </div>
  )
}

function ReportsContent() {
  const { isAgent, isAdmin } = useAuth()
  const roleLabels = useRoleLabels()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [tab, setTab] = useState<'overview' | 'agents' | 'dora'>('overview')

  if (!isAgent) {
    return (
      <div className="text-center py-16 text-red-500">
        <p className="text-xl">에이전트 이상 권한이 필요합니다.</p>
      </div>
    )
  }

  const csvUrl = exportReport({ from, to })
  const xlsxUrl = exportReportXlsx({ from, to })
  const agentLabel = roleLabels.agent ?? 'IT 담당자'

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📊 리포트</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">기간별 티켓 현황 · 만족도 · 담당자 성과</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/admin/workload"
              className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              📈 업무 현황
            </Link>
          )}
          <div className="flex items-center gap-2">
            <a href={csvUrl} className="bg-green-600 text-white px-4 py-2 rounded-md text-sm hover:bg-green-700 transition-colors">
              ⬇️ CSV
            </a>
            <a href={xlsxUrl} className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700 transition-colors">
              📊 Excel
            </a>
          </div>
        </div>
      </div>

      {/* 날짜 필터 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">시작일</label>
          <input
            type="date" value={from} max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">종료일</label>
          <input
            type="date" value={to} min={from} max={today()}
            onChange={(e) => setTo(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setFrom(thisMonthStart()); setTo(today()) }}
            className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            이번 달
          </button>
          {[{ label: '7일', days: 7 }, { label: '30일', days: 30 }, { label: '90일', days: 90 }].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => { setFrom(daysAgo(days)); setTo(today()) }}
              className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              최근 {label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b dark:border-gray-700">
        {([
          ['overview', '전체 현황'],
          ['agents', `담당자 성과`],
          ['dora', 'DORA 지표'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <SummarySection from={from} to={to} />
          <BreakdownSection from={from} to={to} />
          <SLAHeatmap weeks={12} />
          <RatingDetail from={from} to={to} />
          <TrendTable from={from} to={to} />
        </>
      )}

      {tab === 'agents' && (
        <>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{agentLabel} 성과</h2>
          <AgentPerformanceSection from={from} to={to} />
        </>
      )}

      {tab === 'dora' && (
        <DoraSection days={Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) || 30} />
      )}
    </div>
  )
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <ReportsContent />
    </RequireAuth>
  )
}
