'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchTrends, exportReport, fetchRatingStats, fetchCurrentStats, fetchBreakdown, fetchAgentPerformance } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { formatName } from '@/lib/utils'
import type { RatingStats, RealtimeStats, BreakdownStats, AgentPerformance } from '@/types'

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

function SummarySection({ from, to }: { from: string; to: string }) {
  const [ticket, setTicket] = useState<RealtimeStats | null>(null)
  const [rating, setRating] = useState<RatingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      fetchCurrentStats({ from, to }),
      fetchRatingStats({ from, to }),
    ])
      .then(([t, r]) => { setTicket(t); setRating(r) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [from, to])

  const satisfactionPct = rating && rating.total > 0
    ? Math.round(((rating.distribution[4] ?? 0) + (rating.distribution[5] ?? 0)) / rating.total * 100)
    : 0

  const cards = [
    { label: '신규 티켓', value: ticket?.new,          color: 'text-blue-600',   border: 'border-blue-100' },
    { label: '처리 완료', value: ticket?.closed,        color: 'text-green-600',  border: 'border-green-100' },
    { label: 'SLA 위반',  value: ticket?.sla_breached,  color: 'text-red-600',    border: 'border-red-100' },
    {
      label: '평균 만족도',
      value: rating?.average !== null && rating?.average !== undefined
        ? rating.average.toFixed(1)
        : '-',
      color: 'text-yellow-500', border: 'border-yellow-100',
      sub: rating?.average != null
        ? '★'.repeat(Math.round(rating.average)) + '☆'.repeat(5 - Math.round(rating.average))
        : null,
    },
    { label: '평가 건수',   value: rating?.total,       color: 'text-indigo-600', border: 'border-indigo-100' },
    { label: '만족 비율',   value: `${satisfactionPct}%`, color: 'text-teal-600', border: 'border-teal-100',
      sub: '4점 이상' },
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white border rounded-lg p-5 shadow-sm text-center animate-pulse">
            <div className="h-9 bg-gray-200 rounded mb-2 mx-auto w-14" />
            <div className="h-3 bg-gray-100 rounded mx-auto w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
        ⚠️ 통계를 불러오지 못했습니다.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map(({ label, value, color, border, sub }) => (
        <div key={label} className={`bg-white border ${border} rounded-lg p-4 shadow-sm text-center`}>
          <div className={`text-3xl font-bold ${color}`}>{value ?? '-'}</div>
          {sub && <div className="text-xs text-yellow-400 mt-0.5">{sub}</div>}
          <div className="text-xs text-gray-500 mt-1">{label}</div>
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
      <hr className="my-8 border-gray-200" />
      <h2 className="text-lg font-bold text-gray-800 mb-4">만족도 상세</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 점수 분포 */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">점수 분포</h3>
          <div className="space-y-3">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = stats.distribution[score] ?? 0
              const pct = stats.total > 0 ? Math.round(count / stats.total * 100) : 0
              return (
                <div key={score} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-gray-500 shrink-0">
                    {'★'.repeat(score)} {scoreLabels[score]}
                  </div>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${scoreColors[score]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-14 text-right text-xs text-gray-500 shrink-0">{count}건 ({pct}%)</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 최근 평가 */}
        <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">최근 평가</h3>
          </div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {stats.recent.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <span className="text-yellow-400 text-sm shrink-0">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Link href={`/tickets/${r.gitlab_issue_iid}`} className="text-blue-600 hover:underline font-medium">
                      #{r.gitlab_issue_iid}
                    </Link>
                    <span className="text-gray-600">{r.employee_name}</span>
                    <span className="text-gray-400">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                  {r.comment && <p className="text-xs text-gray-500 mt-0.5 truncate">&ldquo;{r.comment}&rdquo;</p>}
                </div>
                <span className="text-sm font-bold text-gray-600 shrink-0">{r.score}점</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

const STATUS_KO: Record<string, string> = { open: '접수됨', in_progress: '처리중', resolved: '처리완료', closed: '종료' }
const STATUS_COLOR: Record<string, string> = {
  open: 'text-blue-600 border-blue-100',
  in_progress: 'text-orange-600 border-orange-100',
  resolved: 'text-green-600 border-green-100',
  closed: 'text-gray-600 border-gray-100',
}
const PRIORITY_KO: Record<string, string> = { critical: '긴급', high: '높음', medium: '보통', low: '낮음' }
const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-yellow-400', low: 'bg-blue-400',
}
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const CATEGORY_KO: Record<string, string> = {
  network: '네트워크', hardware: '하드웨어', software: '소프트웨어',
  account: '계정/권한', other: '기타', '기타': '기타',
}

function BreakdownSection({ from, to }: { from: string; to: string }) {
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
      <div className="h-5 bg-gray-200 rounded w-32 mb-4 animate-pulse" />
      <div className="h-24 bg-gray-100 rounded animate-pulse" />
    </div>
  )
  if (!data) return null

  const total = data.total
  const statuses = ['open', 'in_progress', 'resolved', 'closed'] as const

  // 카테고리 정렬 (건수 내림차순)
  const catEntries = Object.entries(data.by_category).sort((a, b) => b[1] - a[1])
  const prioEntries = PRIORITY_ORDER
    .filter(p => data.by_priority[p] != null)
    .map(p => [p, data.by_priority[p]] as [string, number])
  const maxCat = Math.max(...catEntries.map(([, v]) => v), 1)
  const maxPrio = Math.max(...prioEntries.map(([, v]) => v), 1)

  return (
    <>
      <hr className="my-8 border-gray-200" />
      <h2 className="text-lg font-bold text-gray-800 mb-4">기간 내 티켓 현황</h2>

      {/* 상태별 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm text-center">
          <div className="text-3xl font-bold text-gray-800">{total}</div>
          <div className="text-xs text-gray-500 mt-1">전체</div>
        </div>
        {statuses.map((s) => (
          <div key={s} className={`bg-white border ${STATUS_COLOR[s].split(' ')[1]} rounded-lg p-4 shadow-sm text-center`}>
            <div className={`text-3xl font-bold ${STATUS_COLOR[s].split(' ')[0]}`}>
              {data.by_status[s] ?? 0}
            </div>
            <div className="text-xs text-gray-500 mt-1">{STATUS_KO[s]}</div>
          </div>
        ))}
      </div>

      {/* 카테고리별 / 우선순위별 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 카테고리별 */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">카테고리별</h3>
          {catEntries.length === 0 ? (
            <p className="text-sm text-gray-400">데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {catEntries.map(([cat, count]) => {
                const pct = Math.round(count / maxCat * 100)
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-gray-600 shrink-0 truncate">
                      {CATEGORY_KO[cat] ?? cat}
                    </div>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-gray-600 shrink-0">
                      {count}건 ({total > 0 ? Math.round(count / total * 100) : 0}%)
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 우선순위별 */}
        <div className="bg-white border rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">우선순위별</h3>
          {prioEntries.length === 0 ? (
            <p className="text-sm text-gray-400">데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {prioEntries.map(([prio, count]) => {
                const pct = Math.round(count / maxPrio * 100)
                return (
                  <div key={prio} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-gray-600 shrink-0">
                      {PRIORITY_KO[prio] ?? prio}
                    </div>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${PRIORITY_COLOR[prio] ?? 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-gray-600 shrink-0">
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

function TrendTable({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<TrendRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchTrends({ from, to })
      .then((data) => {
        // 날짜별로 합산 (여러 프로젝트 행을 하나로)
        const map = new Map<string, TrendRow>()
        for (const row of data as TrendRow[]) {
          const existing = map.get(row.snapshot_date)
          if (existing) {
            existing.total_new        += row.total_new
            existing.total_open       += row.total_open
            existing.total_in_progress += row.total_in_progress
            existing.total_closed     += row.total_closed
            existing.total_breached   += row.total_breached
          } else {
            map.set(row.snapshot_date, { ...row })
          }
        }
        setRows(Array.from(map.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <>
      <hr className="my-8 border-gray-200" />
      <h2 className="text-lg font-bold text-gray-800 mb-4">일별 스냅샷 추이</h2>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4 text-sm">⚠️ {error}</div>
      )}
      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>해당 기간에 스냅샷 데이터가 없습니다.</p>
          <p className="text-xs mt-1 text-gray-300">스냅샷은 매일 자정에 자동 생성됩니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">날짜</th>
                <th className="px-4 py-3 text-right font-semibold text-blue-600">당일 신규</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">접수됨</th>
                <th className="px-4 py-3 text-right font-semibold text-orange-600">처리 중<span className="font-normal text-xs text-gray-400 ml-1">(대기·완료 포함)</span></th>
                <th className="px-4 py-3 text-right font-semibold text-green-600">누적 종료</th>
                <th className="px-4 py-3 text-right font-semibold text-red-600">누적 SLA 위반</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.snapshot_date} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-700">{row.snapshot_date}</td>
                  <td className="px-4 py-2 text-right text-blue-600 font-medium">{row.total_new}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{row.total_open}</td>
                  <td className="px-4 py-2 text-right text-orange-600">{row.total_in_progress}</td>
                  <td className="px-4 py-2 text-right text-green-600">{row.total_closed}</td>
                  <td className="px-4 py-2 text-right">
                    {row.total_breached > 0
                      ? <span className="text-red-600 font-medium">{row.total_breached}</span>
                      : <span className="text-gray-300">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
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

  if (loading) return <div className="text-center py-12 text-gray-400">불러오는 중...</div>
  if (data.length === 0) return <div className="text-center py-12 text-gray-400">해당 기간에 데이터가 없습니다.</div>

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">담당자</th>
            <th className="px-4 py-3 text-right font-semibold text-blue-600">배정</th>
            <th className="px-4 py-3 text-right font-semibold text-green-600">처리완료</th>
            <th className="px-4 py-3 text-right font-semibold text-yellow-500">평균 만족도</th>
            <th className="px-4 py-3 text-right font-semibold text-purple-600">SLA 준수율</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((agent) => (
            <tr key={agent.agent_username} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-800">{formatName(agent.agent_name)}</div>
                <div className="text-xs text-gray-400">@{agent.agent_username}</div>
              </td>
              <td className="px-4 py-3 text-right text-blue-600 font-medium">{agent.assigned}</td>
              <td className="px-4 py-3 text-right text-green-600 font-medium">{agent.resolved}</td>
              <td className="px-4 py-3 text-right">
                {agent.avg_rating != null ? (
                  <span className="text-yellow-500 font-medium">{agent.avg_rating.toFixed(1)}★</span>
                ) : (
                  <span className="text-gray-300">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {agent.sla_met_rate != null ? (
                  <span className={`font-medium ${agent.sla_met_rate >= 90 ? 'text-green-600' : agent.sla_met_rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {agent.sla_met_rate.toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-gray-300">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportsContent() {
  const { isAgent } = useAuth()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [tab, setTab] = useState<'overview' | 'agents'>('overview')

  if (!isAgent) {
    return (
      <div className="text-center py-16 text-red-500">
        <p className="text-xl">에이전트 이상 권한이 필요합니다.</p>
      </div>
    )
  }

  const csvUrl = exportReport({ from, to })

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📊 리포트</h1>
        <a href={csvUrl} className="bg-green-600 text-white px-4 py-2 rounded-md text-sm hover:bg-green-700">
          ⬇️ CSV 다운로드
        </a>
      </div>

      {/* 날짜 필터 */}
      <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">시작일</label>
          <input
            type="date" value={from} max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">종료일</label>
          <input
            type="date" value={to} min={from} max={today()}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {[{ label: '7일', days: 7 }, { label: '30일', days: 30 }, { label: '90일', days: 90 }].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => { setFrom(daysAgo(days)); setTo(today()) }}
              className="text-sm border px-3 py-1.5 rounded-md text-gray-600 hover:bg-gray-50"
            >
              최근 {label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b">
        {([['overview', '전체 현황'], ['agents', '에이전트 성과']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {/* 기간 요약 통계 (6개 카드) */}
          <SummarySection from={from} to={to} />

          {/* 기간 내 상태별·카테고리별·우선순위별 */}
          <BreakdownSection from={from} to={to} />

          {/* 만족도 분포 + 최근 평가 */}
          <RatingDetail from={from} to={to} />

          {/* 일별 스냅샷 추이 */}
          <TrendTable from={from} to={to} />
        </>
      )}

      {tab === 'agents' && (
        <>
          <h2 className="text-lg font-bold text-gray-800 mb-4">에이전트 성과</h2>
          <AgentPerformanceSection from={from} to={to} />
        </>
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
