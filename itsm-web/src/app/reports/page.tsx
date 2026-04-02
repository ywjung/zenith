'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fetchTrends, exportReport, exportReportXlsx, fetchRatingStats, fetchCurrentStats, fetchBreakdown, fetchAgentPerformance, fetchDoraMetrics, fetchSLAHeatmap, fetchCsatTrend, fetchTimeTrackingReport, fetchSLAComplianceReport } from '@/lib/api'
import type { TimeTrackingReport, SLAComplianceReport } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import ReportExportButton from '@/components/ReportExportButton'
import { useAuth } from '@/context/AuthContext'
import { useRoleLabels } from '@/context/RoleLabelsContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName } from '@/lib/utils'
import type { RatingStats, RealtimeStats, BreakdownStats, AgentPerformance, DoraMetrics, DoraMetricItem, CsatTrendItem } from '@/types'

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

function SummarySection({ from, to, ratingStats }: { from: string; to: string; ratingStats: RatingStats | null }) {
  const t = useTranslations('reports')
  const [ticket, setTicket] = useState<RealtimeStats | null>(null)
  const [rating, setRating] = useState<RatingStats | null>(ratingStats)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => { setRating(ratingStats) }, [ratingStats])

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchCurrentStats({ from, to })
      .then(setTicket)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [from, to])

  const satisfactionPct = rating && rating.total > 0
    ? Math.round(((rating.distribution[4] ?? 0) + (rating.distribution[5] ?? 0)) / rating.total * 100)
    : 0

  const cards = [
    { label: t('summary_new_tickets'), value: ticket?.new,          color: 'text-blue-600',   border: 'border-blue-100 dark:border-blue-900/50' },
    { label: t('summary_resolved'),    value: ticket?.closed,        color: 'text-green-600',  border: 'border-green-100 dark:border-green-900/50' },
    { label: t('summary_sla_breached'), value: ticket?.sla_breached, color: 'text-red-600',    border: 'border-red-100 dark:border-red-900/50' },
    {
      label: t('summary_avg_rating'),
      value: rating?.average !== null && rating?.average !== undefined
        ? rating.average.toFixed(1)
        : '-',
      color: 'text-yellow-500', border: 'border-yellow-100 dark:border-yellow-900/50',
      sub: rating?.average != null
        ? '★'.repeat(Math.round(rating.average)) + '☆'.repeat(5 - Math.round(rating.average))
        : null,
    },
    { label: t('summary_rating_count'), value: rating?.total,       color: 'text-indigo-600', border: 'border-indigo-100 dark:border-indigo-900/50' },
    { label: t('summary_satisfaction'), value: `${satisfactionPct}%`, color: 'text-teal-600', border: 'border-teal-100 dark:border-teal-900/50',
      sub: t('summary_satisfaction_sub') },
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
        ⚠️ {t('summary_load_error')}
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

function RatingDetail({ from, to, stats: externalStats }: { from: string; to: string; stats: RatingStats | null }) {
  const t = useTranslations('reports')
  const [stats, setStats] = useState<RatingStats | null>(externalStats)

  useEffect(() => { setStats(externalStats) }, [externalStats])
  // from/to 변경 시에는 부모가 재fetch하므로 별도 fetch 불필요
  void from; void to;

  if (!stats || stats.total === 0) return null

  const scoreLabels: Record<number, string> = {
    5: t('rating_score_5'),
    4: t('rating_score_4'),
    3: t('rating_score_3'),
    2: t('rating_score_2'),
    1: t('rating_score_1'),
  }
  const scoreColors: Record<number, string> = {
    5: 'bg-green-500', 4: 'bg-blue-400', 3: 'bg-yellow-400', 2: 'bg-orange-400', 1: 'bg-red-500',
  }

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('rating_detail_title')}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 점수 분포 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('rating_score_dist')}</h3>
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
                  <div className="w-14 text-right text-xs text-gray-500 dark:text-gray-400 shrink-0">{count}{t('rating_count_unit')} ({pct}%)</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 최근 평가 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('rating_recent')}</h3>
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
                <span className="text-sm font-bold text-gray-600 dark:text-gray-300 shrink-0">{r.score}{t('rating_score_unit')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 낮은 평점 플래그 */}
      {stats.low_ratings && stats.low_ratings.length > 0 && (
        <div className="mt-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
            <span className="text-red-500">⚠️</span>
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">낮은 평점 티켓 (1~2점) — {stats.low_ratings.length}건</h3>
          </div>
          <div className="divide-y divide-red-100 dark:divide-red-900/30 max-h-56 overflow-y-auto">
            {stats.low_ratings.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <span className="text-red-400 text-sm shrink-0">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Link href={`/tickets/${r.gitlab_issue_iid}`} className="text-red-600 dark:text-red-400 hover:underline font-medium">
                      #{r.gitlab_issue_iid}
                    </Link>
                    <span className="text-gray-600 dark:text-gray-300">{r.employee_name}</span>
                    <span className="text-gray-400 dark:text-gray-500">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  {r.comment && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 truncate">&ldquo;{r.comment}&rdquo;</p>}
                </div>
                <span className="text-sm font-bold text-red-600 dark:text-red-400 shrink-0">{r.score}점</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function getStatusLabel(t: ReturnType<typeof useTranslations<'reports'>>, status: string): string {
  const map: Record<string, string> = {
    open: t('status_open'), approved: t('status_approved'), in_progress: t('status_in_progress'),
    waiting: t('status_waiting'), resolved: t('status_resolved'), testing: t('status_testing'),
    ready_for_release: t('status_ready_for_release'), released: t('status_released'), closed: t('status_closed'),
  }
  return map[status] ?? status
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
function getPriorityLabel(t: ReturnType<typeof useTranslations<'reports'>>, priority: string): string {
  const map: Record<string, string> = {
    critical: t('priority_critical'), high: t('priority_high'),
    medium: t('priority_medium'), low: t('priority_low'),
  }
  return map[priority] ?? priority
}
const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-yellow-400', low: 'bg-blue-400',
}
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
function BreakdownSection({ from, to }: { from: string; to: string }) {
  const t = useTranslations('reports')
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

  // 카테고리 정렬 (건수 내림차순, 동수일 때 이름순)
  const catEntries = Object.entries(data.by_category).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const prioEntries = PRIORITY_ORDER
    .filter(p => data.by_priority[p] != null)
    .map(p => [p, data.by_priority[p]] as [string, number])
  const maxCat = Math.max(...catEntries.map(([, v]) => v), 1)
  const maxPrio = Math.max(...prioEntries.map(([, v]) => v), 1)

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('breakdown_title')}</h2>

      {/* 상태별 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-3 mb-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{total}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('breakdown_total')}</div>
        </div>
        {statuses.map((s) => (
          <div key={s} className={`bg-white dark:bg-gray-900 border ${STATUS_COLOR[s]?.border ?? 'border-gray-200 dark:border-gray-700'} rounded-lg p-4 shadow-sm text-center`}>
            <div className={`text-3xl font-bold ${STATUS_COLOR[s]?.text ?? 'text-gray-600'}`}>
              {data.by_status[s] ?? 0}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{getStatusLabel(t, s)}</div>
          </div>
        ))}
      </div>

      {/* 카테고리별 / 우선순위별 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 카테고리별 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('breakdown_by_category')}</h3>
          {catEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">{t('breakdown_no_data')}</p>
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
                      {count}{t('breakdown_count_unit')} ({total > 0 ? Math.round(count / total * 100) : 0}%)
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 우선순위별 */}
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('breakdown_by_priority')}</h3>
          {prioEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">{t('breakdown_no_data')}</p>
          ) : (
            <div className="space-y-3">
              {prioEntries.map(([prio, count]) => {
                const pct = Math.round(count / maxPrio * 100)
                return (
                  <div key={prio} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-gray-600 dark:text-gray-400 shrink-0">
                      {getPriorityLabel(t, prio)}
                    </div>
                    <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${PRIORITY_COLOR[prio] ?? 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-gray-600 dark:text-gray-400 shrink-0">
                      {count}{t('breakdown_count_unit')} ({total > 0 ? Math.round(count / total * 100) : 0}%)
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

const TREND_PRESET_DAYS = [14, 30, 90, 180]
const TREND_PRESET_KEYS = ['trend_preset_2w', 'trend_preset_1m', 'trend_preset_3m', 'trend_preset_6m'] as const

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TrendTable({ from: _from, to: _to }: { from: string; to: string }) {
  const t = useTranslations('reports')
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
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">{t('trend_title')}</h2>

        <div className="flex items-center gap-2 flex-wrap">
          {/* preset buttons */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {TREND_PRESET_DAYS.map((days, i) => (
              <button
                key={days}
                onClick={() => { setPreset(days); setUseCustom(false) }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  !useCustom && preset === days
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t(TREND_PRESET_KEYS[i])}
              </button>
            ))}
          </div>

          {/* custom range toggle */}
          <button
            onClick={() => setUseCustom(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              useCustom
                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {t('trend_custom_input')}
          </button>
        </div>
      </div>

      {/* 직접 입력 패널 */}
      {useCustom && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
          <label className="text-xs text-blue-700 dark:text-blue-400 font-medium">{t('trend_period_label')}</label>
          <input
            type="date" aria-label={t('trend_period_label') + ' 시작'} value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date" aria-label={t('trend_period_label') + ' 종료'} value={customTo}
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
          {effectiveFrom} ~ {effectiveTo} ({rows.length}{t('heatmap_days_unit')})
        </p>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4 text-sm">⚠️ {error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 animate-pulse">{t('trend_loading')}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p>{t('trend_no_data')}</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">{t('trend_snapshot_hint')}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 w-32">{t('trend_col_date')}</th>
                <th className="px-4 py-3 text-right font-semibold text-blue-600">{t('trend_col_new')}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300 hidden sm:table-cell">{t('trend_col_open')}</th>
                <th className="px-4 py-3 text-right font-semibold text-orange-600 hidden md:table-cell">
                  {t('trend_col_in_progress')}<span className="font-normal text-xs text-gray-400 ml-1">{t('trend_col_in_progress_note')}</span>
                </th>
                <th className="px-4 py-3 text-right font-semibold text-green-600 hidden sm:table-cell">{t('trend_col_closed')}</th>
                <th className="px-4 py-3 text-right font-semibold text-red-600">{t('trend_col_breached')}</th>
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
                <td className="px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{t('trend_footer_total')}</td>
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

// ---------------------------------------------------------------------------
// CSAT Trend Chart
// ---------------------------------------------------------------------------
function CSATTrendSection({ from, to }: { from: string; to: string }) {
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly')
  const [data, setData] = useState<CsatTrendItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCsatTrend({ from, to, granularity })
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [from, to, granularity])

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">CSAT 트렌드</h2>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {(['weekly', 'monthly'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                granularity === g
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {g === 'weekly' ? '주별' : '월별'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-gray-50 dark:bg-gray-800 rounded-xl animate-pulse" />
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">평가 데이터가 없습니다.</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
          {/* 요약 카드 */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {(() => {
              const latest = data[data.length - 1]
              const allScores = data.flatMap(d => d.csat_pct != null ? [d.csat_pct] : [])
              const avgCsat = allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null
              const trend = data.length >= 2 && data[data.length - 1].csat_pct != null && data[data.length - 2].csat_pct != null
                ? (data[data.length - 1].csat_pct! - data[data.length - 2].csat_pct!)
                : null
              return (
                <>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-teal-600">{latest?.csat_pct != null ? `${latest.csat_pct}%` : '-'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">최근 기간 CSAT</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{avgCsat != null ? `${avgCsat}%` : '-'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">기간 평균 CSAT</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-2xl font-bold ${trend == null ? 'text-gray-400' : trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {trend != null ? `${trend > 0 ? '+' : ''}${trend.toFixed(1)}%` : '-'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">전 기간 대비</div>
                  </div>
                </>
              )
            })()}
          </div>

          {/* 바 차트 */}
          <div className="space-y-2">
            {data.map((item) => {
              const barW = item.count > 0 ? Math.round(item.count / maxCount * 100) : 0
              const csatColor = item.csat_pct == null ? 'bg-gray-300'
                : item.csat_pct >= 80 ? 'bg-teal-500'
                : item.csat_pct >= 60 ? 'bg-blue-400'
                : item.csat_pct >= 40 ? 'bg-yellow-400'
                : 'bg-red-400'
              return (
                <div key={item.period} className="flex items-center gap-3">
                  <div className="w-20 text-xs text-gray-500 dark:text-gray-400 shrink-0 text-right font-mono">
                    {item.period}
                  </div>
                  <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden relative">
                    <div className={`h-full rounded ${csatColor} opacity-80`} style={{ width: `${barW}%` }} />
                    <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                      {item.csat_pct != null ? `${item.csat_pct}%` : '-'}
                    </span>
                  </div>
                  <div className="w-20 text-right text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {item.count}건 / {item.average?.toFixed(1) ?? '-'}점
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">CSAT = 4점 이상 비율. 색상: 녹색 ≥80% / 파란 ≥60% / 노란 ≥40% / 빨강 &lt;40%</p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Agent Rating Ranking
// ---------------------------------------------------------------------------
function AgentRatingRanking({ from, to }: { from: string; to: string }) {
  const [agents, setAgents] = useState<AgentPerformance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchAgentPerformance({ from, to })
      .then((data) => {
        const withRating = data.filter(a => a.avg_rating != null)
        withRating.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
        setAgents(withRating)
      })
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading) return (
    <div className="mt-8">
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4 animate-pulse" />
      <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
    </div>
  )
  if (agents.length === 0) return null

  const medals = ['🥇', '🥈', '🥉']
  const maxRating = 5

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">에이전트 평점 랭킹</h2>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 w-12">순위</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">에이전트</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-yellow-600">평균 평점</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 hidden sm:table-cell">처리 완료</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 hidden md:table-cell">SLA 준수율</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 hidden lg:table-cell">만족도 바</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {agents.map((agent, idx) => {
              const pct = Math.round((agent.avg_rating ?? 0) / maxRating * 100)
              const barColor = pct >= 80 ? 'bg-teal-500' : pct >= 60 ? 'bg-blue-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'
              return (
                <tr key={agent.agent_username} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3 text-center text-lg">
                    {idx < 3 ? medals[idx] : <span className="text-sm text-gray-400">{idx + 1}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800 dark:text-gray-200">{agent.agent_name}</div>
                    <div className="text-xs text-gray-400">@{agent.agent_username}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-yellow-500">{'★'.repeat(Math.round(agent.avg_rating ?? 0))}</span>
                    <span className="text-yellow-300">{'☆'.repeat(5 - Math.round(agent.avg_rating ?? 0))}</span>
                    <span className="ml-1 text-xs text-gray-600 dark:text-gray-300 font-medium">{agent.avg_rating?.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 hidden sm:table-cell">{agent.resolved}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    {agent.sla_met_rate != null
                      ? <span className={agent.sla_met_rate >= 90 ? 'text-green-600' : agent.sla_met_rate >= 70 ? 'text-yellow-600' : 'text-red-500'}>{agent.sla_met_rate}%</span>
                      : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-24 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AgentPerformanceSection({ from, to }: { from: string; to: string }) {
  const t = useTranslations('reports')
  const [data, setData] = useState<AgentPerformance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchAgentPerformance({ from, to })
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading) return <div className="text-center py-12 text-gray-400 dark:text-gray-500">{t('agent_loading')}</div>
  if (data.length === 0) return <div className="text-center py-12 text-gray-400 dark:text-gray-500">{t('agent_no_data')}</div>

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">{t('agent_col_agent')}</th>
            <th className="px-4 py-3 text-right font-semibold text-blue-600">{t('agent_col_assigned')}</th>
            <th className="px-4 py-3 text-right font-semibold text-green-600">{t('agent_col_resolved')}</th>
            <th className="px-4 py-3 text-right font-semibold text-yellow-500">{t('agent_col_avg_rating')}</th>
            <th className="px-4 py-3 text-right font-semibold text-purple-600">{t('agent_col_sla_rate')}</th>
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
  const t = useTranslations('reports')
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
          {t('dora_resolved_format', { resolved: metric.resolved_count ?? 0, reopened: metric.reopened_count ?? 0 })}
        </p>
      )}
    </div>
  )
}

type HeatCell = { date: string; breached: number; total: number }

const HEAT_LEVELS = [
  { bg: 'bg-gray-100 dark:bg-gray-800',       border: 'border-gray-200 dark:border-gray-700' },
  { bg: 'bg-red-100 dark:bg-red-950',         border: 'border-red-200 dark:border-red-900' },
  { bg: 'bg-red-300 dark:bg-red-800',         border: 'border-red-300 dark:border-red-700' },
  { bg: 'bg-red-500 dark:bg-red-600',         border: 'border-red-400 dark:border-red-500' },
  { bg: 'bg-red-700 dark:bg-red-500',         border: 'border-red-600 dark:border-red-400' },
]

function heatLevel(breached: number): number {
  if (breached === 0) return 0
  if (breached === 1) return 1
  if (breached <= 3) return 2
  if (breached <= 7) return 3
  return 4
}

function SLAHeatmap({ weeks }: { weeks: number }) {
  const t = useTranslations('reports')
  const DAY_LABELS = [t('day_mon'), t('day_tue'), t('day_wed'), t('day_thu'), t('day_fri'), t('day_sat'), t('day_sun')]
  const MONTH_NAMES = ['', t('month_1'), t('month_2'), t('month_3'), t('month_4'), t('month_5'), t('month_6'), t('month_7'), t('month_8'), t('month_9'), t('month_10'), t('month_11'), t('month_12')]
  const heatLevelLabels = [t('heat_level_0'), t('heat_level_1'), t('heat_level_2'), t('heat_level_3'), t('heat_level_4')]
  const [data, setData] = useState<HeatCell[]>([])
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ cell: HeatCell; x: number; y: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchSLAHeatmap({ weeks })
      .then(d => setData(d ?? []))
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
    if (i === 0) return MONTH_NAMES[month + 1]
    const prevMonth = new Date(weekKeys[i - 1] + 'T00:00:00').getMonth()
    return month !== prevMonth ? MONTH_NAMES[month + 1] : null
  })

  return (
    <>
      <hr className="my-8 border-gray-200 dark:border-gray-700" />

      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">{t('heatmap_title')}</h2>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
            {t('heatmap_weeks', { weeks })}
          </span>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: t('heatmap_total_breached'), value: `${totalBreached}${t('heatmap_count_unit')}`,       sub: t('heatmap_total_sub', { total: totalTickets }),      color: totalBreached > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200' },
          { label: t('heatmap_rate'),           value: `${violationRate}%`,                               sub: t('heatmap_rate_sub'),                                color: violationRate > 20 ? 'text-red-600 dark:text-red-400' : violationRate > 10 ? 'text-orange-500' : 'text-gray-800 dark:text-gray-200' },
          { label: t('heatmap_worst_day'),      value: maxBreached > 0 ? `${maxBreached}${t('heatmap_count_unit')}` : '—', sub: worstDay?.date ?? '',                color: maxBreached > 5 ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200' },
          { label: t('heatmap_breach_days'),    value: `${activeDays > 0 ? data.filter(d => d.breached > 0).length : 0}${t('heatmap_days_unit')}`, sub: t('heatmap_active_days_sub', { days: activeDays }), color: 'text-gray-800 dark:text-gray-200' },
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
              {t('heatmap_tooltip_breached')} <span className={`font-bold ${tooltip.cell.breached > 0 ? 'text-red-300' : 'text-green-300'}`}>
                {tooltip.cell.breached}{t('heatmap_count_unit')}
              </span>
              {tooltip.cell.total > 0 && (
                <> / {t('heatmap_tooltip_total')} {tooltip.cell.total}{t('heatmap_count_unit')}
                  {' '}({Math.round((tooltip.cell.breached / tooltip.cell.total) * 100)}%)
                </>
              )}
            </p>
          </div>
        )}

        {/* 범례 */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('heatmap_legend_none')}</span>
          <div className="flex items-center gap-1">
            {HEAT_LEVELS.map((lv, i) => (
              <div key={i} title={heatLevelLabels[i]}
                className={`w-[14px] h-[14px] rounded-sm ${lv.bg} border ${lv.border}`} />
            ))}
          </div>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('heatmap_legend_many')}</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {HEAT_LEVELS.slice(1).map((lv, i) => (
              <span key={i} className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${lv.bg}`} />
                {heatLevelLabels[i + 1]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function DoraSection({ days }: { days: number }) {
  const t = useTranslations('reports')
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

  if (loading) return <div className="py-10 text-center text-gray-400 text-sm">{t('dora_loading')}</div>
  if (error || !data) return <div className="py-10 text-center text-red-400 text-sm">{t('dora_load_error')}</div>

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('dora_section_title')}</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{t('dora_period', { days: data.period_days })}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <DoraCard title={t('dora_card_deployment')} metric={data.deployment_frequency} icon="🚀" />
        <DoraCard title={t('dora_card_leadtime')} metric={data.lead_time} icon="⏱️" />
        <DoraCard title={t('dora_card_cfr')} metric={data.change_failure_rate} icon="🔁" />
        <DoraCard title={t('dora_card_mttr')} metric={data.mttr} icon="🛠️" />
      </div>
      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 flex gap-4 flex-wrap">
        {Object.entries(GRADE_COLOR).map(([grade, cls]) => (
          <span key={grade} className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{grade}</span>
        ))}
        <span className="text-gray-400">{t('dora_research_note')}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task 4: 시간 추적 리포트
// ---------------------------------------------------------------------------

function TimeTrackingSection({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<TimeTrackingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchTimeTrackingReport({ start: from, end: to })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [from, to])

  if (loading) return <div className="py-10 text-center text-gray-400 text-sm animate-pulse">로딩 중...</div>
  if (error || !data) return <div className="py-10 text-center text-red-400 text-sm">데이터를 불러올 수 없습니다.</div>
  if (data.entry_count === 0) return (
    <div className="py-16 text-center text-gray-400">
      <div className="text-4xl mb-3">⏱️</div>
      <p>선택한 기간에 기록된 시간이 없습니다.</p>
    </div>
  )

  const maxHours = Math.max(...data.by_agent.map(a => a.total_hours), 1)

  return (
    <div className="space-y-6">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: '총 기록 시간', value: `${data.total_hours}h`, sub: `${data.total_minutes}분` },
          { label: '기록 건수', value: `${data.entry_count}건`, sub: '' },
          { label: '참여 인원', value: `${data.agent_count}명`, sub: '' },
          { label: '인당 평균', value: `${data.agent_count > 0 ? Math.round(data.total_hours / data.agent_count * 10) / 10 : 0}h`, sub: '' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{c.label}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{c.value}</p>
            {c.sub && <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* 팀원별 시간 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">팀원별 기록 시간</h3>
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">팀원</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600">총 시간</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">기록 건수</th>
                <th className="px-4 py-3 hidden md:table-cell text-xs font-semibold text-gray-500 dark:text-gray-400">비율</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-800">
              {data.by_agent.map((agent) => {
                const pct = Math.round((agent.total_hours / maxHours) * 100)
                return (
                  <tr key={agent.agent_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{agent.agent_name}</div>
                      <div className="text-xs text-gray-400">@{agent.agent_id}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">{agent.total_hours}h</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{agent.ticket_count}건</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="w-24 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 최근 기록 */}
      {data.recent_entries.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">최근 기록 (최대 50건)</h3>
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">티켓</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 hidden sm:table-cell">팀원</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600">시간</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 hidden md:table-cell">설명</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 hidden lg:table-cell">일시</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-800">
                {data.recent_entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2.5">
                      <a href={`/tickets/${e.issue_iid}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                        #{e.issue_iid}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-gray-700 dark:text-gray-300">{e.agent_name}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-blue-600">{Math.round(e.minutes / 60 * 10) / 10}h</td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-gray-500 dark:text-gray-400 truncate max-w-xs">{e.description || '—'}</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-right text-xs text-gray-400">
                      {e.logged_at ? new Date(e.logged_at).toLocaleDateString('ko-KR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task 9: SLA 준수율 트렌드 리포트
// ---------------------------------------------------------------------------

function SLAComplianceSection() {
  const [data, setData] = useState<SLAComplianceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [weeks, setWeeks] = useState(12)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchSLAComplianceReport({ weeks })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [weeks])

  const handlePrint = () => window.print()

  if (loading) return <div className="py-10 text-center text-gray-400 text-sm animate-pulse">로딩 중...</div>
  if (error || !data) return <div className="py-10 text-center text-red-400 text-sm">데이터를 불러올 수 없습니다.</div>

  const overallColor = data.overall_compliance_rate == null ? 'text-gray-500' :
    data.overall_compliance_rate >= 90 ? 'text-green-600 dark:text-green-400' :
    data.overall_compliance_rate >= 70 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'

  const maxTrend = Math.max(...data.trend.map(t => t.total), 1)

  return (
    <div className="space-y-6">
      {/* 기간 선택 + 인쇄 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">기간:</span>
          {([4, 12, 26, 52] as const).map(w => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`text-sm px-3 py-1 rounded-md border transition-colors ${
                weeks === w
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >{w}주</button>
          ))}
        </div>
        <button
          onClick={handlePrint}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
        >
          🖨️ 인쇄/PDF
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: '전체 SLA', value: `${data.total}건`, color: 'text-gray-900 dark:text-white' },
          { label: 'SLA 준수', value: `${data.met}건`, color: 'text-green-600 dark:text-green-400' },
          { label: 'SLA 위반', value: `${data.breached}건`, color: data.breached > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white' },
          { label: '전체 준수율', value: data.overall_compliance_rate != null ? `${data.overall_compliance_rate}%` : 'N/A', color: overallColor },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{c.label}</p>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 주별 트렌드 */}
      {data.trend.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">주별 SLA 준수율 트렌드</h3>
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-4 shadow-sm overflow-x-auto">
            <div className="flex items-end gap-1 min-w-max h-32">
              {data.trend.map((t) => {
                const metPct = t.total > 0 ? Math.round((t.met / t.total) * 100) : 0
                const breachPct = t.total > 0 ? Math.round((t.breached / t.total) * 100) : 0
                const barH = Math.round((t.total / maxTrend) * 100)
                return (
                  <div key={t.week} className="flex flex-col items-center gap-1" title={`${t.week}\n준수: ${t.met}건 (${metPct}%)\n위반: ${t.breached}건`}>
                    <div
                      className="w-6 rounded-t-sm flex flex-col-reverse overflow-hidden"
                      style={{ height: `${Math.max(barH, 4)}%` }}
                    >
                      <div className="bg-green-400 dark:bg-green-600" style={{ height: `${metPct}%` }} />
                      <div className="bg-red-400 dark:bg-red-600" style={{ height: `${breachPct}%` }} />
                    </div>
                    <span className="text-[9px] text-gray-400 dark:text-gray-500 rotate-90 origin-center mt-2 w-10 text-center whitespace-nowrap">
                      {t.week.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-400" />준수</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-400" />위반</span>
            </div>
          </div>
        </div>
      )}

      {/* 우선순위별 */}
      {data.by_priority.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">우선순위별 SLA 준수율</h3>
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">우선순위</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">전체</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-green-600">준수</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-red-500">위반</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600">준수율</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-800">
                {data.by_priority.map((p) => {
                  const rateColor = p.compliance_rate == null ? 'text-gray-400' :
                    p.compliance_rate >= 90 ? 'text-green-600' :
                    p.compliance_rate >= 70 ? 'text-yellow-600' : 'text-red-600'
                  return (
                    <tr key={p.priority} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 capitalize">{p.priority}</td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{p.total}</td>
                      <td className="px-4 py-3 text-right text-green-600">{p.total - p.breached}</td>
                      <td className="px-4 py-3 text-right text-red-500">{p.breached}</td>
                      <td className={`px-4 py-3 text-right font-bold ${rateColor}`}>
                        {p.compliance_rate != null ? `${p.compliance_rate}%` : 'N/A'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.total === 0 && (
        <div className="py-16 text-center text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p>해당 기간에 SLA 기록이 없습니다.</p>
        </div>
      )}
    </div>
  )
}

function ReportsContent() {
  const t = useTranslations('reports')
  const { isAgent, isAdmin } = useAuth()
  const roleLabels = useRoleLabels()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [tab, setTab] = useState<'overview' | 'agents' | 'dora' | 'time' | 'sla'>('overview')
  const [sharedRatingStats, setSharedRatingStats] = useState<RatingStats | null>(null)

  useEffect(() => {
    fetchRatingStats({ from, to }).then(setSharedRatingStats).catch(() => setSharedRatingStats(null))
  }, [from, to])

  if (!isAgent) {
    return (
      <div className="text-center py-16 text-red-500">
        <p className="text-xl">{t('permission_required')}</p>
      </div>
    )
  }

  const csvUrl = exportReport({ from, to })
  const xlsxUrl = exportReportXlsx({ from, to })
  const agentLabel = roleLabels.agent ?? t('agent_col_agent')

  return (
    <div>
      {/* print-only header */}
      <div className="print-report-header hidden mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t('print_header')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('print_date')}: {new Date().toLocaleDateString()} · {t('print_period')}: {from} ~ {to}</p>
      </div>

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/admin/workload"
              className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('workload_btn')}
            </Link>
          )}
          <div className="flex items-center gap-2">
            <a href={csvUrl} className="bg-green-600 text-white px-4 py-2 rounded-md text-sm hover:bg-green-700 transition-colors">
              {t('export_csv')}
            </a>
            <a href={xlsxUrl} className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700 transition-colors">
              {t('export_excel')}
            </a>
            <ReportExportButton from={from} to={to} />
          </div>
        </div>
      </div>

      {/* 날짜 필터 */}
      <div className="report-filter-panel bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-lg p-4 mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('filter_start')}</label>
          <input
            type="date" aria-label={t('filter_start')} value={from} max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('filter_end')}</label>
          <input
            type="date" aria-label={t('filter_end')} value={to} min={from} max={today()}
            onChange={(e) => setTo(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setFrom(thisMonthStart()); setTo(today()) }}
            className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t('preset_this_month')}
          </button>
          {([{ key: 'preset_7d', days: 7 }, { key: 'preset_30d', days: 30 }, { key: 'preset_90d', days: 90 }] as const).map(({ key, days }) => (
            <button
              key={days}
              onClick={() => { setFrom(daysAgo(days)); setTo(today()) }}
              className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('preset_recent', { label: t(key) })}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 */}
      <div className="report-tab-nav flex gap-1 mb-6 border-b dark:border-gray-700 overflow-x-auto">
        {([
          { key: 'overview', label: t('tab_overview') },
          { key: 'agents', label: t('tab_agents') },
          { key: 'dora', label: t('tab_dora') },
          { key: 'time', label: '⏱️ 시간 추적' },
          { key: 'sla', label: '📋 SLA 리포트' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
        <div className="report-tab-panel print-section">
          <SummarySection from={from} to={to} ratingStats={sharedRatingStats} />
          <BreakdownSection from={from} to={to} />
          <SLAHeatmap weeks={12} />
          <RatingDetail from={from} to={to} stats={sharedRatingStats} />
          <CSATTrendSection from={from} to={to} />
          <AgentRatingRanking from={from} to={to} />
          <TrendTable from={from} to={to} />
        </div>
      )}

      {tab === 'agents' && (
        <div className="report-tab-panel print-section">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('agent_performance_title', { agentLabel })}</h2>
          <AgentPerformanceSection from={from} to={to} />
        </div>
      )}

      {tab === 'dora' && (
        <div className="report-tab-panel print-section">
          <DoraSection days={Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) || 30} />
        </div>
      )}

      {tab === 'time' && (
        <div className="report-tab-panel print-section">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">⏱️ 시간 추적 리포트</h2>
          <TimeTrackingSection from={from} to={to} />
        </div>
      )}

      {tab === 'sla' && (
        <div className="report-tab-panel print-section">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">📋 SLA 준수율 리포트</h2>
          <SLAComplianceSection />
        </div>
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
