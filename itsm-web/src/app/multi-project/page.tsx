'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchMultiProjectStats } from '@/lib/api'
import type { MultiProjectStats } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import Link from 'next/link'

function rateColor(rate: number | null) {
  if (rate == null) return { text: 'text-gray-400', bg: 'bg-gray-300 dark:bg-gray-600', badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' }
  if (rate >= 90) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (rate >= 70) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', badge: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
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

function MultiProjectContent() {
  const t = useTranslations('multi_project')
  const { isAgent } = useAuth()
  const [projects, setProjects] = useState<MultiProjectStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    fetchMultiProjectStats()
      .then(d => setProjects(d.projects))
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }

  useEffect(() => { load() }, [])

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
  const totalActive = projects.reduce((s, p) => s + p.sla_active, 0)
  const totalHours = projects.reduce((s, p) => s + p.total_time_hours, 0)
  const overallRate = totalSLA > 0 ? Math.round((totalSLA - totalBreached) / totalSLA * 1000) / 10 : null

  const summaryCards = [
    {
      label: t('projects_count'), value: projects.length, unit: t('unit_count'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      iconBg: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
      valueColor: 'text-gray-900 dark:text-white',
    },
    {
      label: t('total_sla'), value: totalSLA, unit: t('unit_cases'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      iconBg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
      valueColor: 'text-gray-900 dark:text-white',
    },
    {
      label: t('active_sla'), value: totalActive, unit: t('unit_cases'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      iconBg: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
      valueColor: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: t('breached_sla'), value: totalBreached, unit: t('unit_cases'),
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      ),
      iconBg: totalBreached > 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400',
      valueColor: totalBreached > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400',
    },
    {
      label: t('overall_rate'), value: overallRate != null ? overallRate : '—', unit: overallRate != null ? '%' : '',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      iconBg: overallRate == null ? 'bg-gray-100 dark:bg-gray-800 text-gray-400' :
        overallRate >= 90 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
        overallRate >= 70 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
        'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
      valueColor: rateColor(overallRate).text,
    },
    {
      label: t('total_hours'), value: Math.round(totalHours * 10) / 10, unit: 'h',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      iconBg: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
      valueColor: 'text-purple-600 dark:text-purple-400',
    },
  ]

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </span>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t('refresh')}
          </button>
          <Link
            href="/reports"
            className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
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
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
            ))}
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

      {/* 메인 콘텐츠 */}
      {!loading && !error && projects.length > 0 && (
        <div className="space-y-6">

          {/* 요약 카드 6개 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {summaryCards.map(c => (
              <div key={c.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
                <div className={`w-9 h-9 rounded-lg ${c.iconBg} flex items-center justify-center mb-3`}>
                  {c.icon}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{c.label}</p>
                <p className={`text-xl font-bold ${c.valueColor}`}>
                  {c.value}<span className="text-sm font-medium ml-0.5">{c.unit}</span>
                </p>
              </div>
            ))}
          </div>

          {/* 2열: 테이블 + 준수율 차트 */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* 프로젝트 테이블 (3/5) */}
            <div className="lg:col-span-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('per_project')}</h2>
                <span className="text-xs text-gray-400">{projects.length} {t('projects_suffix')}</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {projects.map((p) => {
                  const rc = rateColor(p.sla_compliance_rate)
                  const rate = p.sla_compliance_rate ?? 0
                  return (
                    <div key={p.project_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <ProjectInitial name={p.project_name} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{p.project_name}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${rc.badge}`}>
                              {p.sla_compliance_rate != null ? `${p.sla_compliance_rate}%` : 'N/A'}
                            </span>
                          </div>
                          {/* 미니 프로그레스바 */}
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-1.5">
                            <div
                              className={`h-full rounded-full transition-all ${rc.bg}`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span>{t('total')} <span className="text-gray-600 dark:text-gray-300 font-medium">{p.total_sla_records}</span></span>
                            <span>{t('active')} <span className="text-amber-600 font-medium">{p.sla_active}</span></span>
                            {p.sla_breached > 0 && (
                              <span>{t('breached')} <span className="text-red-500 font-medium">{p.sla_breached}</span></span>
                            )}
                            <span className="hidden sm:inline">
                              <span className="text-purple-500 font-medium">{p.total_time_hours}h</span> {t('hours_logged')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 준수율 차트 (2/5) */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('rate_compare')}</h2>
              </div>
              <div className="p-4 space-y-4">
                {projects.filter(p => p.total_sla_records > 0).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">{t('no_sla_data')}</p>
                ) : (
                  projects.filter(p => p.total_sla_records > 0)
                    .sort((a, b) => (b.sla_compliance_rate ?? 0) - (a.sla_compliance_rate ?? 0))
                    .map((p) => {
                      const rate = p.sla_compliance_rate ?? 0
                      const rc = rateColor(p.sla_compliance_rate)
                      return (
                        <div key={p.project_id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[140px]">{p.project_name}</span>
                            <span className={`text-xs font-bold ${rc.text}`}>{rate}%</span>
                          </div>
                          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${rc.bg}`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                        </div>
                      )
                    })
                )}

                {/* 범례 */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-center gap-4">
                  {[
                    { color: 'bg-emerald-500', label: '≥90%' },
                    { color: 'bg-amber-400', label: '70–89%' },
                    { color: 'bg-red-500', label: '<70%' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                      <span className="text-xs text-gray-400">{l.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 위반 현황 하이라이트 (위반 프로젝트가 있을 때만) */}
          {projects.some(p => p.sla_breached > 0) && (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">{t('breach_projects')}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {projects.filter(p => p.sla_breached > 0).map(p => (
                  <div key={p.project_id} className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-red-200 dark:border-red-700 rounded-lg px-3 py-1.5">
                    <ProjectInitial name={p.project_name} />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.project_name}</span>
                    <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">{t('breach_count', { n: p.sla_breached })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
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
