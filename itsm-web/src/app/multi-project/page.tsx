'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchMultiProjectStats } from '@/lib/api'
import type { MultiProjectStats, MultiProjectWeeklyPoint } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import Link from 'next/link'

function rateColor(rate: number | null | undefined) {
  if (rate == null) return { text: 'text-gray-400', bg: 'bg-gray-300 dark:bg-gray-600', badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' }
  if (rate >= 90) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (rate >= 70) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', badge: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
}

function healthColor(grade: 'good' | 'warn' | 'critical' | undefined) {
  switch (grade) {
    case 'good': return { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-700/50' }
    case 'warn': return { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-700/50' }
    case 'critical': return { dot: 'bg-red-500 animate-pulse', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-700/50' }
    default: return { dot: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700' }
  }
}

function ProjectInitial({ name }: { name: string }) {
  const colors = [
    'bg-indigo-500', 'bg-violet-500', 'bg-blue-500', 'bg-teal-500',
    'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-pink-500',
  ]
  const idx = name.charCodeAt(0) % colors.length
  return (
    <div className={`w-8 h-8 rounded-lg ${colors[idx]} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/** 4주 준수율 스파크라인 */
function Sparkline({ points }: { points: MultiProjectWeeklyPoint[] }) {
  const tI18n = useTranslations()
  if (!points || points.length === 0) return <span className="text-xs text-gray-300">—</span>
  const values = points.map(p => p.compliance ?? 0)
  const max = 100
  const w = 60
  const h = 16
  const step = points.length > 1 ? w / (points.length - 1) : 0
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`).join(' ')
  const lastPct = values[values.length - 1]
  const color = lastPct >= 90 ? 'text-emerald-500' : lastPct >= 70 ? 'text-amber-500' : 'text-red-500'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`w-14 h-4 ${color}`} aria-label={tI18n('app_multi_project_page.sparkline_aria')}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        if (p.compliance == null) return null
        const cx = i * step
        const cy = h - (p.compliance / max) * h
        return <circle key={i} cx={cx} cy={cy} r={1.2} fill="currentColor" />
      })}
    </svg>
  )
}

type SortKey = 'health' | 'name' | 'breach' | 'rate' | 'open' | 'tickets'
type FilterGrade = 'all' | 'good' | 'warn' | 'critical'

function MultiProjectContent() {
  const t = useTranslations('multi_project')
  const tI18n = useTranslations()
  const { isAgent } = useAuth()
  const [projects, setProjects] = useState<MultiProjectStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('health')
  const [sortDesc, setSortDesc] = useState(true)
  const [gradeFilter, setGradeFilter] = useState<FilterGrade>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    fetchMultiProjectStats()
      .then(d => setProjects(d.projects))
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => { load() }, [])

  // 필터·정렬 적용된 목록
  const filtered = useMemo(() => {
    let list = projects
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p => p.project_name.toLowerCase().includes(q) || p.project_id.includes(q))
    }
    if (gradeFilter !== 'all') {
      list = list.filter(p => p.health_grade === gradeFilter)
    }
    const sorted = [...list].sort((a, b) => {
      let diff = 0
      switch (sortKey) {
        case 'health':   diff = (a.health_score ?? 0) - (b.health_score ?? 0); break
        case 'name':     diff = a.project_name.localeCompare(b.project_name); break
        case 'breach':   diff = a.sla_breached - b.sla_breached; break
        case 'rate':     diff = (a.sla_compliance_rate ?? -1) - (b.sla_compliance_rate ?? -1); break
        case 'open':     diff = (a.open_tickets ?? 0) - (b.open_tickets ?? 0); break
        case 'tickets':  diff = a.total_sla_records - b.total_sla_records; break
      }
      return sortDesc ? -diff : diff
    })
    return sorted
  }, [projects, search, sortKey, sortDesc, gradeFilter])

  if (!isAgent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-gray-600 dark:text-gray-400 font-medium">{t('no_permission')}</p>
      </div>
    )
  }

  const totalSLA = projects.reduce((s, p) => s + p.total_sla_records, 0)
  const totalBreached = projects.reduce((s, p) => s + p.sla_breached, 0)
  const totalOpen = projects.reduce((s, p) => s + (p.open_tickets ?? 0), 0)
  const totalHours = projects.reduce((s, p) => s + p.total_time_hours, 0)
  const overallRate = totalSLA > 0 ? Math.round((totalSLA - totalBreached) / totalSLA * 1000) / 10 : null
  const gradeCounts = {
    good: projects.filter(p => p.health_grade === 'good').length,
    warn: projects.filter(p => p.health_grade === 'warn').length,
    critical: projects.filter(p => p.health_grade === 'critical').length,
  }
  const avgMTTR = (() => {
    const vals = projects.map(p => p.mttr_hours_7d).filter((v): v is number => v != null)
    if (!vals.length) return null
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
  })()

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </span>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t('refresh')}
          </button>
          <Link href="/reports" className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('reports')}
          </Link>
        </div>
      </div>

      {/* 로딩 스켈레톤 */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />)}
          </div>
          <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400">{t('load_failed')}</p>
          <button onClick={() => load()} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t('retry')}</button>
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && !error && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl">📂</div>
          <p className="font-medium text-gray-600 dark:text-gray-400">{t('empty_title')}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">{t('empty_desc')}</p>
        </div>
      )}

      {/* 단일 프로젝트 — 통합 뷰보다 전용 대시보드(SLA/리포트)가 더 유용함을 안내 */}
      {!loading && !error && projects.length === 1 && (
        <SingleProjectNotice project={projects[0]} />
      )}

      {!loading && !error && projects.length > 1 && (
        <div className="space-y-6">
          {/* KPI 카드 8개 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('projects_count')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{projects.length}<span className="text-xs font-medium ml-0.5 text-gray-400">{t('unit_count')}</span></p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('total_sla')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{totalSLA}<span className="text-xs font-medium ml-0.5 text-gray-400">{t('unit_cases')}</span></p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{tI18n('app_multi_project_page.unresolved')}</p>
              <p className={`text-xl font-bold ${totalOpen > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                {totalOpen}<span className="text-xs font-medium ml-0.5 text-gray-400">{t('unit_cases')}</span>
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('breached_sla')}</p>
              <p className={`text-xl font-bold ${totalBreached > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                {totalBreached}<span className="text-xs font-medium ml-0.5 text-gray-400">{t('unit_cases')}</span>
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('overall_rate')}</p>
              <p className={`text-xl font-bold ${rateColor(overallRate).text}`}>{overallRate ?? '—'}<span className="text-xs font-medium ml-0.5">{overallRate != null ? '%' : ''}</span></p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{tI18n('app_multi_project_page.avg_mttr')}</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{avgMTTR ?? '—'}<span className="text-xs font-medium ml-0.5 text-gray-400">{avgMTTR != null ? 'h' : ''}</span></p>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('total_hours')}</p>
              <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{Math.round(totalHours * 10) / 10}<span className="text-xs font-medium ml-0.5 text-gray-400">h</span></p>
            </div>
            {/* 건강도 분포 카드 */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{tI18n('app_multi_project_page.health')}</p>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />{gradeCounts.good}
                </span>
                <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />{gradeCounts.warn}
                </span>
                <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />{gradeCounts.critical}
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{tI18n('app_multi_project_page.grade_legend')}</p>
            </div>
          </div>

          {/* 툴바: 검색 + 정렬 + 필터 */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* 검색 */}
              <div className="relative flex-1 min-w-[180px]">
                <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search"
                  placeholder={tI18n('app_multi_project_page.search_placeholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
              {/* 건강도 필터 */}
              <div className="flex items-center gap-1 text-xs">
                {(['all', 'critical', 'warn', 'good'] as const).map(g => {
                  const labels: Record<typeof g, string> = { all: tI18n('app_multi_project_page.filter_all'), critical: tI18n('app_multi_project_page.filter_critical'), warn: tI18n('app_multi_project_page.filter_warn'), good: tI18n('app_multi_project_page.filter_good') }
                  const colors: Record<typeof g, string> = {
                    all: 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400',
                    critical: 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400',
                    warn: 'border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400',
                    good: 'border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400',
                  }
                  const count = g === 'all' ? projects.length : gradeCounts[g]
                  return (
                    <button
                      key={g}
                      onClick={() => setGradeFilter(g)}
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                        gradeFilter === g
                          ? 'bg-gray-100 dark:bg-gray-800 ' + colors[g]
                          : 'border-transparent text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {labels[g]} <span className="text-gray-400">{count}</span>
                    </button>
                  )
                })}
              </div>
              {/* 정렬 */}
              <div className="flex items-center gap-1 text-xs">
                <span className="text-gray-400">{tI18n('app_multi_project_page.sort_label')}</span>
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-sm focus:outline-none"
                >
                  <option value="health">{tI18n('app_multi_project_page.sort_health')}</option>
                  <option value="name">{tI18n('app_multi_project_page.sort_name')}</option>
                  <option value="breach">{tI18n('app_multi_project_page.sort_breach')}</option>
                  <option value="rate">{tI18n('app_multi_project_page.sort_rate')}</option>
                  <option value="open">{tI18n('app_multi_project_page.sort_open')}</option>
                  <option value="tickets">{tI18n('app_multi_project_page.sort_tickets')}</option>
                </select>
                <button
                  onClick={() => setSortDesc(d => !d)}
                  className="px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={sortDesc ? tI18n('app_multi_project_page.sort_desc') : tI18n('app_multi_project_page.sort_asc')}
                >
                  {sortDesc ? '↓' : '↑'}
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-400 mt-2">{tI18n('app_multi_project_page.showing_count', { shown: filtered.length, total: projects.length })}</div>
          </div>

          {/* 프로젝트 테이블 (확장 가능 행) */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left w-10"></th>
                  <th className="px-3 py-2.5 text-left">{tI18n('app_multi_project_page.col_project')}</th>
                  <th className="px-3 py-2.5 text-left w-20">{tI18n('app_multi_project_page.col_health')}</th>
                  <th className="px-3 py-2.5 text-left w-24 hidden sm:table-cell">{tI18n('app_multi_project_page.col_rate')}</th>
                  <th className="px-3 py-2.5 text-left w-20 hidden md:table-cell">{tI18n('app_multi_project_page.col_trend')}</th>
                  <th className="px-3 py-2.5 text-left w-20 hidden lg:table-cell">{tI18n('app_multi_project_page.col_unresolved')}</th>
                  <th className="px-3 py-2.5 text-left w-20 hidden lg:table-cell">{tI18n('app_multi_project_page.col_breach')}</th>
                  <th className="px-3 py-2.5 text-left w-20 hidden xl:table-cell">{tI18n('app_multi_project_page.col_mttr')}</th>
                  <th className="px-3 py-2.5 text-left w-24 hidden xl:table-cell">{tI18n('app_multi_project_page.col_resolved_7d')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-gray-400">{tI18n('app_multi_project_page.no_match')}</td>
                  </tr>
                ) : filtered.map(p => {
                  const rc = rateColor(p.sla_compliance_rate)
                  const hc = healthColor(p.health_grade)
                  const isOpen = expandedId === p.project_id
                  return (
                    <>
                      <tr
                        key={p.project_id}
                        onClick={() => setExpandedId(isOpen ? null : p.project_id)}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-3">
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <ProjectInitial name={p.project_name} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.project_name}</div>
                              <div className="text-[10px] text-gray-400 font-mono">#{p.project_id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-bold ${hc.bg} ${hc.border} ${hc.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${hc.dot}`} />
                            {p.health_score != null ? p.health_score : '—'}
                          </div>
                        </td>
                        <td className="px-3 py-3 hidden sm:table-cell">
                          {p.sla_compliance_rate != null ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-12 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div className={`h-full ${rc.bg}`} style={{ width: `${p.sla_compliance_rate}%` }} />
                              </div>
                              <span className={`text-xs font-mono ${rc.text}`}>{p.sla_compliance_rate}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-300">N/A</span>}
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          {p.weekly_trend && p.weekly_trend.length > 0 ? <Sparkline points={p.weekly_trend} /> : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <span className={`text-sm font-mono ${(p.open_tickets ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                            {p.open_tickets ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <span className={`text-sm font-mono ${p.sla_breached > 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-gray-400'}`}>
                            {p.sla_breached}
                          </span>
                        </td>
                        <td className="px-3 py-3 hidden xl:table-cell">
                          {p.mttr_hours_7d != null ? (
                            <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{p.mttr_hours_7d}h</span>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-3 hidden xl:table-cell">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{tI18n('app_multi_project_page.count_cases', { count: p.resolved_7d ?? 0 })}</span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${p.project_id}-detail`}>
                          <td colSpan={9} className="px-0 py-0 bg-gray-50 dark:bg-gray-800/40 border-b dark:border-gray-700">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
                              <DetailStat label={tI18n('app_multi_project_page.detail_total_sla_records')} value={p.total_sla_records.toString()} />
                              <DetailStat label={tI18n('app_multi_project_page.detail_in_progress')} value={(p.sla_active).toString()} accent="amber" />
                              <DetailStat label={tI18n('app_multi_project_page.detail_unresolved')} value={(p.open_tickets ?? 0).toString()} accent="amber" />
                              <DetailStat label={tI18n('app_multi_project_page.detail_overall_rate')} value={p.sla_compliance_rate != null ? `${p.sla_compliance_rate}%` : '—'} />
                              <DetailStat label={tI18n('app_multi_project_page.detail_resolved_7d')} value={tI18n('app_multi_project_page.count_cases', { count: p.resolved_7d ?? 0 })} />
                              <DetailStat label={tI18n('app_multi_project_page.detail_rate_7d')} value={p.compliance_rate_7d != null ? `${p.compliance_rate_7d}%` : '—'} />
                              <DetailStat label={tI18n('app_multi_project_page.detail_mttr_7d')} value={p.mttr_hours_7d != null ? `${p.mttr_hours_7d}h` : '—'} accent="blue" />
                              <DetailStat label={tI18n('app_multi_project_page.detail_active_assignees_7d')} value={tI18n('app_multi_project_page.count_people', { count: p.active_assignees_7d ?? 0 })} />
                              <DetailStat label={tI18n('app_multi_project_page.detail_total_hours')} value={`${p.total_time_hours}h`} accent="purple" />
                              <DetailStat label={tI18n('app_multi_project_page.detail_health_score')} value={(p.health_score ?? 0).toString()} accent="indigo" />
                            </div>
                            {p.weekly_trend && p.weekly_trend.length > 0 && (
                              <div className="px-4 pb-4">
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">{tI18n('app_multi_project_page.weekly_trend_title_monday')}</div>
                                <div className="flex items-end gap-2 h-20">
                                  {p.weekly_trend.map((w, i) => {
                                    const v = w.compliance ?? 0
                                    const color = v >= 90 ? 'bg-emerald-400' : v >= 70 ? 'bg-amber-400' : v > 0 ? 'bg-red-400' : 'bg-gray-200 dark:bg-gray-700'
                                    return (
                                      <div key={i} className="flex-1 flex flex-col items-center gap-1" title={tI18n('app_multi_project_page.week_tooltip', { week: w.week, rate: w.compliance ?? 0, total: w.total })}>
                                        <div className="text-[10px] text-gray-400">{w.compliance != null ? `${w.compliance}%` : '—'}</div>
                                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded overflow-hidden" style={{ height: 40 }}>
                                          <div className={`w-full ${color}`} style={{ height: `${v}%`, marginTop: `${100 - v}%` }} />
                                        </div>
                                        <div className="text-[10px] text-gray-400 font-mono">{w.week.slice(5)}</div>
                                        <div className="text-[9px] text-gray-400">{tI18n('app_multi_project_page.count_cases', { count: w.total })}</div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function SingleProjectNotice({ project }: { project: MultiProjectStats }) {
  const tI18n = useTranslations()
  const rc = rateColor(project.sla_compliance_rate)
  const hc = healthColor(project.health_grade)
  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-gray-900 border border-indigo-200 dark:border-indigo-800/50 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{tI18n('app_multi_project_page.single_title')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              {tI18n('app_multi_project_page.single_desc')}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link href="/sla" className="inline-flex items-center gap-1.5 text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                ⏰ {tI18n('app_multi_project_page.link_sla_dashboard')} →
              </Link>
              <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                📈 {tI18n('app_multi_project_page.link_reports')} →
              </Link>
              <Link href="/" className="inline-flex items-center gap-1.5 text-sm border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                🎫 {tI18n('app_multi_project_page.link_ticket_list')} →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <ProjectInitial name={project.project_name} />
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">{project.project_name}</div>
            <div className="text-xs text-gray-400 font-mono">#{project.project_id}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${hc.bg} ${hc.border} ${hc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${hc.dot}`} />
              {tI18n('app_multi_project_page.health')} {project.health_score ?? '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DetailStat label={tI18n('app_multi_project_page.detail_total_sla')} value={tI18n('app_multi_project_page.count_cases', { count: project.total_sla_records })} />
          <DetailStat label={tI18n('app_multi_project_page.detail_unresolved')} value={tI18n('app_multi_project_page.count_cases', { count: project.open_tickets ?? 0 })} accent="amber" />
          <DetailStat label={tI18n('app_multi_project_page.detail_breach')} value={tI18n('app_multi_project_page.count_cases', { count: project.sla_breached })} accent={project.sla_breached > 0 ? 'amber' : undefined} />
          <DetailStat label={tI18n('app_multi_project_page.detail_overall_rate')} value={project.sla_compliance_rate != null ? `${project.sla_compliance_rate}%` : '—'} />
          <DetailStat label={tI18n('app_multi_project_page.detail_resolved_7d')} value={tI18n('app_multi_project_page.count_cases', { count: project.resolved_7d ?? 0 })} />
          <DetailStat label={tI18n('app_multi_project_page.detail_rate_7d_short')} value={project.compliance_rate_7d != null ? `${project.compliance_rate_7d}%` : '—'} />
          <DetailStat label={tI18n('app_multi_project_page.detail_mttr_7d_short')} value={project.mttr_hours_7d != null ? `${project.mttr_hours_7d}h` : '—'} accent="blue" />
          <DetailStat label={tI18n('app_multi_project_page.detail_total_hours_short')} value={`${project.total_time_hours}h`} accent="purple" />
        </div>

        {project.sla_compliance_rate != null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{tI18n('app_multi_project_page.sla_compliance_rate')}</span>
              <span className={rc.text}>{project.sla_compliance_rate}%</span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full ${rc.bg}`} style={{ width: `${project.sla_compliance_rate}%` }} />
            </div>
          </div>
        )}

        {project.weekly_trend && project.weekly_trend.length > 0 && (
          <div className="mt-5">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{tI18n('app_multi_project_page.weekly_trend_title')}</div>
            <div className="flex items-end gap-2 h-24">
              {project.weekly_trend.map((w, i) => {
                const v = w.compliance ?? 0
                const color = v >= 90 ? 'bg-emerald-400' : v >= 70 ? 'bg-amber-400' : v > 0 ? 'bg-red-400' : 'bg-gray-200 dark:bg-gray-700'
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={tI18n('app_multi_project_page.week_tooltip', { week: w.week, rate: w.compliance ?? 0, total: w.total })}>
                    <div className="text-[10px] text-gray-400">{w.compliance != null ? `${w.compliance}%` : '—'}</div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded overflow-hidden" style={{ height: 48 }}>
                      <div className={`w-full ${color}`} style={{ height: `${v}%`, marginTop: `${100 - v}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">{w.week.slice(5)}</div>
                    <div className="text-[9px] text-gray-400">{tI18n('app_multi_project_page.count_cases', { count: w.total })}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 dark:text-gray-500 text-center">
        💡 {tI18n('app_multi_project_page.single_footer_note')}
      </div>
    </div>
  )
}

function DetailStat({ label, value, accent }: { label: string; value: string; accent?: 'amber' | 'blue' | 'purple' | 'indigo' }) {
  const colors: Record<string, string> = {
    amber: 'text-amber-600 dark:text-amber-400',
    blue: 'text-blue-600 dark:text-blue-400',
    purple: 'text-purple-600 dark:text-purple-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
  }
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-sm font-semibold ${accent ? colors[accent] : 'text-gray-800 dark:text-gray-100'}`}>{value}</div>
    </div>
  )
}

export default function MultiProjectPage() {
  return (
    <RequireAuth>
      <MultiProjectContent />
    </RequireAuth>
  )
}
