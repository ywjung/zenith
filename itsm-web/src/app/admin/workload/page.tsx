'use client'

import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '@/lib/constants'

interface UserWorkload {
  username: string
  name: string
  avatar_url?: string
  assigned: number
  open: number
  in_progress: number
  resolved: number
  closed: number
  backlog: number
  resolution_rate: number | null
  avg_resolve_hours: number | null
  sla_met: number
  sla_total: number
  sla_met_rate: number | null
  avg_rating: number | null
  rating_count: number
}

type SortKey = keyof UserWorkload
type SortDir = 'asc' | 'desc'

// ── 성과 점수 / 등급 계산 ──────────────────────────────────────────────────
function calcPerformance(r: UserWorkload) {
  if (r.assigned === 0) return { score: null, grade: '—', gradeClass: 'text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700' }

  let sum = 0, wt = 0

  // 완료율 (30%)
  const resRate = r.resolution_rate ?? (r.closed / r.assigned * 100)
  sum += resRate * 0.30; wt += 0.30

  // SLA 달성률 (40%) — 데이터 있을 때만
  if (r.sla_total > 0 && r.sla_met_rate !== null) {
    sum += r.sla_met_rate * 0.40; wt += 0.40
  }

  // 고객 평점 (30%) — 평가 있을 때만
  if (r.avg_rating !== null && r.rating_count > 0) {
    sum += (r.avg_rating / 5 * 100) * 0.30; wt += 0.30
  }

  const score = Math.round(sum / wt)

  if (score >= 85) return { score, grade: 'A', gradeClass: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700' }
  if (score >= 70) return { score, grade: 'B', gradeClass: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' }
  if (score >= 55) return { score, grade: 'C', gradeClass: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700' }
  if (score >= 40) return { score, grade: 'D', gradeClass: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700' }
  return { score, grade: 'F', gradeClass: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700' }
}

// ── 포맷 헬퍼 ───────────────────────────────────────────────────────────────
function fmtHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}분`
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}일`
}

// ── 서브 컴포넌트 ───────────────────────────────────────────────────────────
function Avatar({ row }: { row: UserWorkload }) {
  const [imgFailed, setImgFailed] = useState(false)
  if (row.avatar_url && !imgFailed) {
    return (
      <img
        src={row.avatar_url}
        alt=""
        className="w-8 h-8 rounded-full object-cover shrink-0"
        onError={() => setImgFailed(true)}
      />
    )
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
      {row.name.charAt(0)}
    </div>
  )
}

function SlaBar({ rate, met, total }: { rate: number | null; met: number; total: number }) {
  if (total === 0) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
  const pct = rate ?? 0
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 tabular-nums w-10 text-right">{pct}%</span>
    </div>
  )
}

function ResBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
  const color = rate >= 80 ? 'bg-blue-500' : rate >= 50 ? 'bg-indigo-400' : 'bg-gray-300 dark:bg-gray-600'
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 tabular-nums w-10 text-right">{rate}%</span>
    </div>
  )
}

function StarRating({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
  const full = Math.round(score)
  return (
    <span className="text-yellow-400 text-xs tracking-tight" title={`${score}점`}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
      <span className="ml-1 text-gray-500 dark:text-gray-400 font-medium">{score}</span>
    </span>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg" title="1위">🥇</span>
  if (rank === 2) return <span className="text-lg" title="2위">🥈</span>
  if (rank === 3) return <span className="text-lg" title="3위">🥉</span>
  return <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums w-6 text-center">{rank}</span>
}

// ── 상위 3인 포디엄 ──────────────────────────────────────────────────────────
function TopPodium({ rows }: { rows: UserWorkload[] }) {
  const ranked = [...rows]
    .filter(r => r.assigned > 0)
    .map(r => ({ ...r, perf: calcPerformance(r) }))
    .sort((a, b) => (b.perf.score ?? 0) - (a.perf.score ?? 0))
    .slice(0, 3)

  if (ranked.length < 2) return null

  const medals = [
    { label: '1위', icon: '🥇', ring: 'ring-yellow-400', bg: 'bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20', border: 'border-yellow-200 dark:border-yellow-800' },
    { label: '2위', icon: '🥈', ring: 'ring-slate-400', bg: 'bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-800 dark:to-gray-800', border: 'border-slate-200 dark:border-slate-700' },
    { label: '3위', icon: '🥉', ring: 'ring-orange-300', bg: 'bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20', border: 'border-orange-200 dark:border-orange-800' },
  ]

  return (
    <div className="grid grid-cols-3 gap-3">
      {ranked.map((r, i) => {
        const m = medals[i]
        const { grade, gradeClass, score } = r.perf
        return (
          <div key={r.username} className={`${m.bg} border ${m.border} rounded-xl p-4 text-center`}>
            <div className="text-2xl mb-2">{m.icon}</div>
            <Avatar row={r} />
            <p className="font-semibold text-gray-900 dark:text-white mt-2 text-sm truncate">{r.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">@{r.username}</p>
            <div className="mt-3 flex items-center justify-center gap-1.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${gradeClass}`}>{grade}</span>
              {score !== null && <span className="text-xs text-gray-500 dark:text-gray-400">{score}점</span>}
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <div>담당 <span className="font-medium text-gray-700 dark:text-gray-300">{r.assigned}</span>건</div>
              {r.sla_met_rate !== null && (
                <div>SLA <span className="font-medium text-gray-700 dark:text-gray-300">{r.sla_met_rate}%</span></div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 메인 페이지 ─────────────────────────────────────────────────────────────
export default function WorkloadPage() {
  const [rows, setRows] = useState<UserWorkload[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('assigned')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [showPodium, setShowPodium] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from_date', fromDate)
      if (toDate)   params.set('to_date',   toDate)
      const res = await fetch(`${API_BASE}/admin/workload?${params}`, { credentials: 'include' })
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
      setRows(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { load() }, [load])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // 필터 + 정렬
  const filtered = rows
    .filter(r => !selectedUser || r.username === selectedUser)
    .filter(r => !search || r.name.includes(search) || r.username.includes(search))
    .map(r => ({ ...r, _perf: calcPerformance(r) }))
    .sort((a, b) => {
      // 성과점수 정렬 특수 처리
      const av = sortKey === ('_perf' as SortKey)
        ? (a._perf.score ?? -1)
        : ((a[sortKey] as number | null) ?? -1)
      const bv = sortKey === ('_perf' as SortKey)
        ? (b._perf.score ?? -1)
        : ((b[sortKey] as number | null) ?? -1)
      return sortDir === 'asc'
        ? (av < bv ? -1 : av > bv ? 1 : 0)
        : (av > bv ? -1 : av < bv ? 1 : 0)
    })

  // 요약 통계
  const totalAssigned = rows.reduce((s, r) => s + r.assigned, 0)
  const totalClosed   = rows.reduce((s, r) => s + r.closed, 0)
  const totalBacklog  = rows.reduce((s, r) => s + r.backlog, 0)
  const slaArr  = rows.filter(r => r.sla_met_rate !== null).map(r => r.sla_met_rate!)
  const avgSla  = slaArr.length ? Math.round(slaArr.reduce((s, v) => s + v, 0) / slaArr.length) : null
  const ratingArr = rows.filter(r => r.avg_rating !== null).map(r => r.avg_rating!)
  const avgRating = ratingArr.length ? (ratingArr.reduce((s, v) => s + v, 0) / ratingArr.length).toFixed(1) : null

  function exportCsv() {
    const header = ['순위', '사용자', '이름', '담당', '백로그', '완료', '완료율(%)', '평균처리시간(h)', 'SLA달성률(%)', '고객평점', '성과점수', '등급']
    const body = filtered.map((r, i) => [
      i + 1, r.username, r.name, r.assigned, r.backlog, r.closed,
      r.resolution_rate ?? '', r.avg_resolve_hours ?? '',
      r.sla_met_rate ?? '', r.avg_rating ?? '',
      r._perf.score ?? '', r._perf.grade,
    ])
    const csv = [header, ...body].map(row => row.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `performance_${fromDate || 'all'}_${toDate || 'all'}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const Th = ({ label, k, title }: { label: string; k: SortKey; title?: string }) => (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      onClick={() => handleSort(k)}
      title={title}
    >
      {label}
      {sortKey === k && <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">사용자별 업무 현황 및 성과</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">담당 티켓·완료율·SLA·고객 만족도를 종합해 성과를 평가합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPodium(v => !v)}
            className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {showPodium ? '포디엄 숨기기' : '포디엄 보기'}
          </button>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            CSV 내보내기
          </button>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-sm">
        <span className="text-xs text-gray-500 dark:text-gray-400">기간</span>
        <input
          type="date" value={fromDate} max={toDate || undefined}
          onChange={e => setFromDate(e.target.value)}
          className="border dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">~</span>
        <input
          type="date" value={toDate} min={fromDate || undefined}
          onChange={e => setToDate(e.target.value)}
          className="border dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
        />
        {(fromDate || toDate) && (
          <button onClick={() => { setFromDate(''); setToDate('') }} className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500">✕ 초기화</button>
        )}
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        <span className="text-xs text-gray-500 dark:text-gray-400">사용자명</span>
        <select
          value={selectedUser}
          onChange={e => setSelectedUser(e.target.value)}
          className="border dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800"
        >
          <option value="">전체</option>
          {rows.map(r => (
            <option key={r.username} value={r.username}>{r.name} (@{r.username})</option>
          ))}
        </select>
        {selectedUser && (
          <button onClick={() => setSelectedUser('')} className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500">✕</button>
        )}
        <div className="ml-auto">
          <input
            type="text" placeholder="이름·아이디 검색..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="border dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 bg-white dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
          />
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: '전체 사용자',    value: `${rows.length}명`,          color: 'text-blue-600',    sub: null },
          { label: '총 담당 티켓',   value: `${totalAssigned}건`,        color: 'text-indigo-600',  sub: null },
          { label: '총 완료',        value: `${totalClosed}건`,          color: 'text-emerald-600', sub: totalAssigned > 0 ? `완료율 ${Math.round(totalClosed/totalAssigned*100)}%` : null },
          { label: '총 백로그',      value: `${totalBacklog}건`,         color: totalBacklog > 10 ? 'text-orange-600' : 'text-gray-600 dark:text-gray-300', sub: null },
          { label: '평균 SLA 달성률', value: avgSla !== null ? `${avgSla}%` : '—', color: avgSla !== null && avgSla >= 80 ? 'text-emerald-600' : 'text-red-500', sub: avgRating !== null ? `고객 평점 ★ ${avgRating}` : null },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.label}</div>
            {c.sub && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 등급 범례 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-medium text-gray-600 dark:text-gray-300">성과 등급 기준</span>
        {[
          { g: 'A', label: '85점 이상', c: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700' },
          { g: 'B', label: '70–84점',   c: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' },
          { g: 'C', label: '55–69점',   c: 'text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700' },
          { g: 'D', label: '40–54점',   c: 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700' },
          { g: 'F', label: '40점 미만', c: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700' },
        ].map(({ g, label, c }) => (
          <span key={g} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${c}`}>
            {g} <span className="font-normal text-gray-400 dark:text-gray-500">{label}</span>
          </span>
        ))}
        <span className="text-gray-400 dark:text-gray-500 ml-1">· SLA 40% + 완료율 30% + 고객평점 30% 가중 합산</span>
      </div>

      {/* 상위 3인 포디엄 */}
      {showPodium && !loading && (
        <TopPodium rows={filtered} />
      )}

      {/* 에러 */}
      {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl text-sm">{error}</div>}

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">데이터가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-8">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-44">사용자</th>
                  <Th label="담당"    k="assigned"        title="전체 담당 티켓 수" />
                  <Th label="백로그"  k="backlog"         title="처리 중 + 접수됨 (미완료 티켓)" />
                  <Th label="완료"    k="closed"          title="종료 처리된 티켓 수" />
                  <Th label="완료율"  k="resolution_rate" title="완료 / 담당 × 100" />
                  <Th label="처리시간" k="avg_resolve_hours" title="평균 티켓 처리 시간" />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">SLA 달성률</th>
                  <Th label="고객평점" k="avg_rating"     title="만족도 평균 점수 (5점 만점)" />
                  <Th label="성과점수" k={'_perf' as SortKey} title="SLA·완료율·고객평점 가중 합산 (100점 만점)" />
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">등급</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((r, idx) => {
                  const { grade, gradeClass, score } = r._perf
                  const isTopPerformer = idx < 3 && r.assigned > 0
                  return (
                    <tr
                      key={r.username}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isTopPerformer ? 'bg-gradient-to-r from-white dark:from-gray-900 to-blue-50/30 dark:to-blue-900/10' : ''}`}
                    >
                      {/* 순위 */}
                      <td className="px-3 py-3 text-center">
                        <RankBadge rank={idx + 1} />
                      </td>
                      {/* 사용자 */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar row={r} />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{r.name}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">@{r.username}</p>
                          </div>
                        </div>
                      </td>
                      {/* 담당 */}
                      <td className="px-3 py-3 font-semibold text-gray-800 dark:text-gray-200">{r.assigned}</td>
                      {/* 백로그 */}
                      <td className="px-3 py-3">
                        <span className={`font-medium ${r.backlog > 5 ? 'text-orange-600' : r.backlog > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600'}`}>
                          {r.backlog || <span className="text-gray-300 dark:text-gray-600">0</span>}
                        </span>
                      </td>
                      {/* 완료 */}
                      <td className="px-3 py-3 text-emerald-600 font-medium">
                        {r.closed || <span className="text-gray-300 dark:text-gray-600">0</span>}
                      </td>
                      {/* 완료율 */}
                      <td className="px-3 py-3 min-w-[110px]">
                        <ResBar rate={r.resolution_rate} />
                      </td>
                      {/* 평균 처리 시간 */}
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300 tabular-nums">{fmtHours(r.avg_resolve_hours)}</td>
                      {/* SLA 달성률 */}
                      <td className="px-3 py-3 min-w-[110px]">
                        <SlaBar rate={r.sla_met_rate} met={r.sla_met} total={r.sla_total} />
                      </td>
                      {/* 고객 평점 */}
                      <td className="px-3 py-3">
                        <StarRating score={r.avg_rating} />
                        {r.rating_count > 0 && <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">({r.rating_count})</span>}
                      </td>
                      {/* 성과 점수 */}
                      <td className="px-3 py-3 tabular-nums">
                        {score !== null
                          ? <span className="font-semibold text-gray-800 dark:text-gray-200">{score}</span>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      {/* 등급 */}
                      <td className="px-3 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-bold ${gradeClass}`}>
                          {grade}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
