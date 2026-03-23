'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  fetchTickets, fetchTicketStats, fetchProjects, bulkUpdateTickets,
  fetchTicketRequesters, fetchSavedFilters, createSavedFilter, deleteSavedFilter,
  fetchFilterOptions,
} from '@/lib/api'
import type { FilterOptions } from '@/lib/api'
import { formatName, formatDate } from '@/lib/utils'
import { PRIORITY_ORDER, DEFAULT_PER_PAGE, API_BASE } from '@/lib/constants'
import type { Ticket, GitLabProject, TicketStats, SavedFilter } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge, SlaBadge } from '@/components/StatusBadge'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { useTranslations } from 'next-intl'


function HomeContent() {
  const { isAgent, user } = useAuth()
  const { serviceTypes, getLabel, getEmoji } = useServiceTypes()
  const t = useTranslations()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [state, setState] = useState(() => searchParams.get('status') || 'all')
  const [category, setCategory] = useState(() => searchParams.get('category') || '')
  const [priority, setPriority] = useState(() => searchParams.get('priority') || '')
  const [sla, setSla] = useState(() => searchParams.get('sla') || '')
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '')
  const [selectedRequester, setSelectedRequester] = useState(() => searchParams.get('assignee') || '')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority'>(() => (searchParams.get('sort') as 'newest' | 'oldest' | 'priority') || 'newest')
  const [fromDate, setFromDate] = useState(() => searchParams.get('from') || '')
  const [toDate, setToDate] = useState(() => searchParams.get('to') || '')

  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [requesters, setRequesters] = useState<{ username: string; employee_name: string }[]>([])
  const [stats, setStats] = useState<TicketStats | null>(null)
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<Date | null>(null)
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)

  const [selectedIids, setSelectedIids] = useState<Set<number>>(new Set())
  const [bulkAction, setBulkAction] = useState('close')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [saveFilterName, setSaveFilterName] = useState('')
  const [showSaveFilter, setShowSaveFilter] = useState(false)
  const [savedFilterError, setSavedFilterError] = useState<string | null>(null)

  // 대시보드 위젯 설정
  const DEFAULT_WIDGETS = [
    { id: 'stats_bar',       visible: true,  label: '상태 현황 탭',   order: 0 },
    { id: 'my_tickets',      visible: true,  label: '내 담당 티켓',   order: 1 },
    { id: 'sla_status',      visible: true,  label: 'SLA 현황',       order: 2 },
    { id: 'recent_activity', visible: false, label: '최근 활동',      order: 3 },
  ]
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS)
  const [showWidgetSettings, setShowWidgetSettings] = useState(false)


  async function saveWidgets(next: typeof widgets) {
    setWidgets(next)
    await fetch(`${API_BASE}/dashboard/config`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgets: next.map(w => ({ id: w.id, visible: w.visible, order: w.order })) }),
    }).catch(() => {})
  }

  function toggleWidget(id: string) {
    saveWidgets(widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w))
  }

  function isWidgetVisible(id: string) {
    return widgets.find(w => w.id === id)?.visible ?? true
  }

  function syncUrl(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams()
    const s = overrides.status ?? state
    const cat = overrides.category ?? category
    const prio = overrides.priority ?? priority
    const sl = overrides.sla ?? sla
    const q = overrides.q ?? search
    const assignee = overrides.assignee ?? selectedRequester
    const fd = overrides.from ?? fromDate
    const td = overrides.to ?? toDate
    const sort = overrides.sort ?? sortBy
    const proj = overrides.project ?? selectedProject
    if (s && s !== 'all') params.set('status', s)
    if (cat) params.set('category', cat)
    if (prio) params.set('priority', prio)
    if (sl) params.set('sla', sl)
    if (q) params.set('q', q)
    if (assignee) params.set('assignee', assignee)
    if (fd) params.set('from', fd)
    if (td) params.set('to', td)
    if (sort && sort !== 'newest') params.set('sort', sort)
    if (proj) params.set('project', proj)
    const qs = params.toString()
    router.replace(qs ? `/?${qs}` : '/', { scroll: false })
  }

  // 초기 데이터 로딩 — fetchProjects / fetchStats / fetchSavedFilters 동시 시작 (병목 1 개선)
  useEffect(() => {
    const init = async () => {
      // ① 4개 요청 동시 출발 (filterOptions 포함)
      const [projectList, statsResult, filtersResult, filterOptsResult] = await Promise.allSettled([
        fetchProjects(),
        fetchTicketStats(undefined),
        isAgent ? fetchSavedFilters() : Promise.resolve([]),
        fetchFilterOptions(),
      ])

      if (statsResult.status === 'fulfilled') setStats(statsResult.value)
      if (filtersResult.status === 'fulfilled') setSavedFilters(filtersResult.value)
      if (filterOptsResult.status === 'fulfilled') setFilterOptions(filterOptsResult.value)

      // ② 프로젝트 수에 따라 selectedProject 결정
      //    1개: '' (전체) — list_tickets는 이미 '' 로 실행 중이므로 재로드 불필요
      //    2개+: 첫 번째 id — 변경 감지 시 list_tickets 재로드
      let pid = ''
      if (projectList.status === 'fulfilled') {
        setProjects(projectList.value)
        const urlProject = searchParams.get('project')
        if (urlProject && projectList.value.some(p => String(p.id) === urlProject)) {
          pid = urlProject
        } else if (projectList.value.length > 1) {
          pid = String(projectList.value[0].id)
        }
      }
      setSelectedProject(pid)

      // ③ requesters는 project_id 확정 후 비동기 fetch (결과 대기 없음)
      if (isAgent) {
        fetchTicketRequesters(pid || undefined)
          .then(setRequesters)
          .catch(() => {})
      }

      // ④ 대시보드 위젯 설정 로드
      fetch(`${API_BASE}/dashboard/config`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
          if (cfg?.widgets?.length > 0) {
            setWidgets(cfg.widgets.map((w: { id: string; visible: boolean; order: number }) => ({
              ...DEFAULT_WIDGETS.find(d => d.id === w.id) ?? { id: w.id, label: w.id },
              visible: w.visible,
              order: w.order,
            })))
          }
        })
        .catch(() => {})
    }
    init().catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgent])

  // 통계만 갱신 (티켓 목록 재로드 없이)
  const refreshStats = useCallback(async () => {
    try {
      const s = await fetchTicketStats(selectedProject || undefined)
      setStats(s)
      setStatsUpdatedAt(new Date())
    } catch { /* ignore */ }
  }, [selectedProject])

  // 60초 자동 갱신 + 탭 복귀 시 즉시 갱신
  useEffect(() => {
    const timer = setInterval(refreshStats, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshStats() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshStats])

  // SSE 알림 수신 시 stats 갱신 (티켓 변경 이벤트 반영)
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/notifications/stream`, { withCredentials: true })
    es.onmessage = () => { refreshStats() }
    es.onerror = () => {}
    return () => es.close()
  }, [refreshStats])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTickets({
        state: state || undefined,
        category: category || undefined,
        priority: priority || undefined,
        sla: sla || undefined,
        search: search || undefined,
        project_id: selectedProject || undefined,
        page,
        per_page: DEFAULT_PER_PAGE,
        created_by_username: selectedRequester || undefined,
        sort_by: sortBy === 'oldest' ? 'created_at' : sortBy === 'priority' ? 'priority' : 'created_at',
        order:   sortBy === 'oldest' ? 'asc' : 'desc',
        created_after:  fromDate  ? `${fromDate}T00:00:00`  : undefined,
        created_before: toDate    ? `${toDate}T23:59:59`    : undefined,
      })
      setTickets(data.tickets)
      setTotal(data.total)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '티켓을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [state, category, priority, sla, search, selectedProject, page, selectedRequester, sortBy, fromDate, toDate])

  useEffect(() => {
    load()
  }, [load, selectedProject])

  function handleStateChange(newState: string) {
    setState(newState); setPage(1); setSelectedIids(new Set()); syncUrl({ status: newState })
  }
  function handleCategoryChange(newCat: string) {
    setCategory(newCat); setPage(1); setSelectedIids(new Set()); syncUrl({ category: newCat })
  }
  function handlePriorityChange(newPrio: string) {
    setPriority(newPrio); setPage(1); setSelectedIids(new Set()); syncUrl({ priority: newPrio })
  }
  function handleSlaChange(newSla: string) {
    setSla(newSla); setPage(1); setSelectedIids(new Set()); syncUrl({ sla: newSla })
  }
  function handleSearch(e: React.FormEvent) {
    e.preventDefault(); setSearch(searchInput); setPage(1); setSelectedIids(new Set()); syncUrl({ q: searchInput })
  }
  function handleProjectChange(pid: string) {
    setSelectedProject(pid); setPage(1); setPriority(''); setSla(''); setSelectedRequester(''); setSelectedIids(new Set()); syncUrl({ project: pid })
  }
  function handleRequesterChange(username: string) {
    setSelectedRequester(username); setPage(1); setSelectedIids(new Set()); syncUrl({ assignee: username })
  }

  function resetAllFilters() {
    setState('all'); setCategory(''); setPriority(''); setSla(''); setSearch(''); setSearchInput('')
    setSelectedRequester(''); setFromDate(''); setToDate('')
    setPage(1); setSelectedIids(new Set()); router.replace('/', { scroll: false })
  }

  function applyFilter(f: SavedFilter) {
    const newState = f.filters.status || 'all'
    const newCat = f.filters.category || ''
    const newPrio = f.filters.priority || ''
    const newSla = f.filters.sla || ''
    const newSearch = f.filters.q || ''
    const newReq = f.filters.assignee || ''
    setState(newState); setCategory(newCat); setPriority(newPrio); setSla(newSla)
    setSearch(newSearch); setSearchInput(newSearch); setSelectedRequester(newReq)
    setPage(1); setSelectedIids(new Set())
    syncUrl({ status: newState, category: newCat, priority: newPrio, sla: newSla, q: newSearch, assignee: newReq })
  }

  async function handleSaveFilter() {
    if (!saveFilterName.trim()) return
    const filters: Record<string, string> = {}
    if (state && state !== 'all') filters.status = state
    if (category) filters.category = category
    if (priority) filters.priority = priority
    if (sla) filters.sla = sla
    if (search) filters.q = search
    if (selectedRequester) filters.assignee = selectedRequester
    try {
      const newFilter = await createSavedFilter(saveFilterName.trim(), filters)
      setSavedFilters(prev => [...prev, newFilter])
      setSaveFilterName(''); setShowSaveFilter(false); setSavedFilterError(null)
    } catch (e: unknown) {
      setSavedFilterError(e instanceof Error ? e.message : '저장 실패')
    }
  }

  async function handleDeleteFilter(id: number) {
    try { await deleteSavedFilter(id); setSavedFilters(prev => prev.filter(f => f.id !== id)) } catch { /* ignore */ }
  }

  function toggleSelect(iid: number) {
    setSelectedIids(prev => { const n = new Set(prev); n.has(iid) ? n.delete(iid) : n.add(iid); return n })
  }
  function toggleSelectAll() {
    setSelectedIids(selectedIids.size === tickets.length ? new Set() : new Set(tickets.map(t => t.iid)))
  }

  async function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedIids.size === 0 || !selectedProject) return
    setBulkProcessing(true); setBulkError(null)
    try {
      await bulkUpdateTickets({ iids: Array.from(selectedIids), project_id: selectedProject, action: bulkAction, value: bulkValue || undefined })
      setSelectedIids(new Set()); await load()
    } catch (err: unknown) {
      setBulkError(err instanceof Error ? err.message : '일괄작업 실패')
    } finally {
      setBulkProcessing(false)
    }
  }

  function _buildExportParams() {
    const params = new URLSearchParams()
    if (state && state !== 'all') params.set('state', state)
    if (category) params.set('category', category)
    if (priority) params.set('priority', priority)
    if (search) params.set('search', search)
    if (selectedProject) params.set('project_id', selectedProject)
    return params.toString()
  }

  function handleExportCsv() {
    const qs = _buildExportParams()
    window.open(`${API_BASE}/tickets/export/csv${qs ? `?${qs}` : ''}`, '_blank')
  }

  function handleExportXlsx() {
    const qs = _buildExportParams()
    window.open(`${API_BASE}/tickets/export/xlsx${qs ? `?${qs}` : ''}`, '_blank')
  }

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PER_PAGE))

  // newest/oldest는 서버사이드 정렬 — priority만 클라이언트 보조 정렬
  const sortedTickets = sortBy === 'priority'
    ? [...tickets].sort((a, b) =>
        (PRIORITY_ORDER[(b.priority ?? 'medium') as keyof typeof PRIORITY_ORDER] ?? 2) -
        (PRIORITY_ORDER[(a.priority ?? 'medium') as keyof typeof PRIORITY_ORDER] ?? 2))
    : tickets

  const hasActiveFilters = !!(category || priority || sla || search || selectedRequester || fromDate || toDate || (state && state !== 'all'))

  const PRIORITY_LABEL: Record<string, string> = {
    critical: t('ticket.priority.critical'),
    high:     t('ticket.priority.high'),
    medium:   t('ticket.priority.medium'),
    low:      t('ticket.priority.low'),
  }
  const SLA_LABEL: Record<string, string> = { over: 'SLA 초과', imminent: 'SLA 임박', warning: 'SLA 주의', good: 'SLA 여유' }

  // Stat tabs config
  const statTabs = [
    { key: 'all',               label: t('ticket.status.all'),               count: stats?.all ?? total,            ring: 'ring-gray-400',   active: 'bg-gray-100 border-gray-400',    num: 'text-gray-800'   },
    { key: 'open',              label: t('ticket.status.open'),              count: stats?.open ?? 0,               ring: 'ring-yellow-400', active: 'bg-yellow-50 border-yellow-400', num: 'text-yellow-700' },
    { key: 'approved',          label: '승인완료',                           count: stats?.approved ?? 0,           ring: 'ring-teal-400',   active: 'bg-teal-50 border-teal-400',     num: 'text-teal-700'   },
    { key: 'in_progress',       label: t('ticket.status.in_progress'),       count: stats?.in_progress ?? 0,        ring: 'ring-blue-400',   active: 'bg-blue-50 border-blue-400',     num: 'text-blue-700'   },
    { key: 'waiting',           label: t('ticket.status.waiting'),           count: stats?.waiting ?? 0,            ring: 'ring-orange-400', active: 'bg-orange-50 border-orange-400', num: 'text-orange-700' },
    { key: 'resolved',          label: t('ticket.status.resolved'),          count: stats?.resolved ?? 0,           ring: 'ring-purple-400', active: 'bg-purple-50 border-purple-400', num: 'text-purple-700' },
    { key: 'testing',           label: t('ticket.status.testing'),           count: stats?.testing ?? 0,            ring: 'ring-violet-400', active: 'bg-violet-50 border-violet-400', num: 'text-violet-700' },
    { key: 'ready_for_release', label: t('ticket.status.ready_for_release'), count: stats?.ready_for_release ?? 0,  ring: 'ring-amber-400',  active: 'bg-amber-50 border-amber-400',   num: 'text-amber-700'  },
    { key: 'released',          label: '운영반영완료',                       count: stats?.released ?? 0,           ring: 'ring-indigo-400', active: 'bg-indigo-50 border-indigo-400', num: 'text-indigo-700' },
    { key: 'closed',            label: t('ticket.status.closed'),            count: stats?.closed ?? 0,             ring: 'ring-green-400',  active: 'bg-green-50 border-green-400',   num: 'text-green-700'  },
  ]

  const slaOver = stats?.sla_over ?? 0
  const slaImminent = stats?.sla_imminent ?? 0
  const myTickets = tickets.filter(t => user && t.assignee_username === user.username)

  return (
    <div>
      {/* 대시보드 위젯 바 */}
      {(isWidgetVisible('my_tickets') || isWidgetVisible('sla_status') || isWidgetVisible('recent_activity')) && (
        <div className="flex gap-3 mb-4 flex-wrap">
          {/* 내 담당 티켓 */}
          {isWidgetVisible('my_tickets') && (
            <div className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">내 담당 티켓</span>
                <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{myTickets.length}</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">현재 목록에서 나에게 배정된 티켓</p>
              {myTickets.length > 0 && (
                <div className="mt-2 space-y-1">
                  {myTickets.slice(0, 3).map(t => (
                    <a key={t.iid} href={`/tickets/${t.iid}`} className="block text-xs text-blue-600 dark:text-blue-400 hover:underline truncate">
                      #{t.iid} {t.title}
                    </a>
                  ))}
                  {myTickets.length > 3 && <span className="text-xs text-gray-400">+{myTickets.length - 3}개 더</span>}
                </div>
              )}
            </div>
          )}

          {/* SLA 현황 */}
          {isWidgetVisible('sla_status') && (
            <div className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">SLA 현황</span>
                {slaOver > 0 ? (
                  <span className="text-xl font-bold text-red-600">{slaOver}</span>
                ) : (
                  <span className="text-xl font-bold text-green-600">✓</span>
                )}
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-xs"><span className="text-red-500 font-semibold">{slaOver}</span> <span className="text-gray-400">초과</span></span>
                <span className="text-xs"><span className="text-orange-500 font-semibold">{slaImminent}</span> <span className="text-gray-400">임박</span></span>
              </div>
              {slaOver === 0 && slaImminent === 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">모든 SLA 정상</p>
              )}
            </div>
          )}

          {/* 최근 활동 */}
          {isWidgetVisible('recent_activity') && (
            <div className="flex-1 min-w-[220px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">최근 활동</span>
              <div className="mt-2 space-y-1">
                {tickets.slice(0, 4).map(t => (
                  <a key={t.iid} href={`/tickets/${t.iid}`} className="flex items-center gap-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5">
                    <span className="text-gray-400 shrink-0">#{t.iid}</span>
                    <span className="text-gray-700 dark:text-gray-300 truncate">{t.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 갱신 시각 + 수동 갱신 버튼 */}
          <div className="flex flex-col items-center justify-center gap-1">
            <button
              onClick={refreshStats}
              className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="지금 갱신"
            >
              ↻
            </button>
            {statsUpdatedAt && (
              <span className="text-[10px] text-gray-300 dark:text-gray-600 whitespace-nowrap">
                {statsUpdatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>

          {/* 위젯 설정 버튼 */}
          <div className="relative">
            <button
              onClick={() => setShowWidgetSettings(v => !v)}
              className="h-full px-3 py-2 bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
              title="위젯 설정"
            >
              ⚙️
            </button>
            {showWidgetSettings && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-xl z-40 p-3 min-w-[160px]">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">위젯 표시</p>
                {widgets.map(w => (
                  <label key={w.id} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1">
                    <input
                      type="checkbox"
                      checked={w.visible}
                      onChange={() => toggleWidget(w.id)}
                      className="rounded"
                    />
                    {w.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 위젯 없을 때 설정 버튼만 표시 */}
      {!isWidgetVisible('my_tickets') && !isWidgetVisible('sla_status') && !isWidgetVisible('recent_activity') && (
        <div className="flex justify-end mb-2">
          <div className="relative">
            <button
              onClick={() => setShowWidgetSettings(v => !v)}
              className="px-3 py-1.5 bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 text-xs text-gray-400 hover:text-gray-600"
            >
              ⚙️ 위젯 설정
            </button>
            {showWidgetSettings && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-xl z-40 p-3 min-w-[160px]">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">위젯 표시</p>
                {widgets.map(w => (
                  <label key={w.id} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1">
                    <input type="checkbox" checked={w.visible} onChange={() => toggleWidget(w.id)} className="rounded" />
                    {w.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Tabs */}
      {isWidgetVisible('stats_bar') && (
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 mb-5">
          {statTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleStateChange(tab.key)}
              className={`rounded-lg border-2 px-2 py-2.5 text-center transition-all focus:outline-none ${
                state === tab.key
                  ? `${tab.active} ring-2 ${tab.ring} shadow-sm dark:bg-opacity-20`
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-sm'
              }`}
            >
              {stats === null ? (
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-1" />
              ) : (
                <div className={`text-xl font-bold ${state === tab.key ? tab.num : 'text-gray-700 dark:text-gray-300'}`}>
                  {tab.count}
                </div>
              )}
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 whitespace-nowrap">{tab.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm mb-4">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <select
              value={selectedProject}
              onChange={e => handleProjectChange(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map(p => <option key={p.id} value={p.id}>{p.name_with_namespace}</option>)}
            </select>
          )}

          {/* 1. 상태 */}
          <select
            value={state === 'all' ? '' : state}
            onChange={e => handleStateChange(e.target.value || 'all')}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 상태</option>
            {(filterOptions?.statuses ?? []).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          {/* 2. 우선순위 */}
          <select
            value={priority}
            onChange={e => handlePriorityChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 우선순위</option>
            {(filterOptions?.priorities ?? [
              { key: 'critical', label: '긴급' },
              { key: 'high',     label: '높음' },
              { key: 'medium',   label: '보통' },
              { key: 'low',      label: '낮음' },
            ]).map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>

          {/* 3. 카테고리 */}
          <select
            value={category}
            onChange={e => handleCategoryChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 카테고리</option>
            {(filterOptions?.categories ?? serviceTypes.map(t => ({ key: t.description ?? t.value, label: t.label, emoji: t.emoji }))).map(c => (
              <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
            ))}
          </select>

          {/* 4. SLA */}
          <select
            value={sla}
            onChange={e => handleSlaChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 SLA</option>
            <option value="over">🔴 SLA 초과</option>
            <option value="imminent">🟠 SLA 임박</option>
            <option value="warning">🟡 SLA 주의</option>
            <option value="good">🟢 SLA 여유</option>
          </select>

          {/* 5. 신청자 */}
          {isAgent && requesters.length > 0 && (
            <select
              value={selectedRequester}
              onChange={e => handleRequesterChange(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">전체 신청자</option>
              {requesters.map(r => (
                <option key={r.username} value={r.username}>
                  {r.employee_name ? `${r.employee_name} (${r.username})` : r.username}
                </option>
              ))}
            </select>
          )}

          {/* 등록일 기간 필터 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">등록일</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={e => { setFromDate(e.target.value); setPage(1); syncUrl({ from: e.target.value }) }}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-400 dark:text-gray-500">~</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={e => { setToDate(e.target.value); setPage(1); syncUrl({ to: e.target.value }) }}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); setPage(1); syncUrl({ from: '', to: '' }) }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 px-1"
                title="날짜 초기화"
              >✕</button>
            )}
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-1.5 ml-auto">
            <input
              type="text"
              placeholder="제목 · 내용 검색..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700">
              검색
            </button>
          </form>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 border-t dark:border-gray-700 pt-2.5">
            <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">필터:</span>
            {state && state !== 'all' && (
              <FilterChip label={`상태: ${filterOptions?.statuses.find(s => s.key === state)?.label ?? statTabs.find(t => t.key === state)?.label ?? state}`} onRemove={() => handleStateChange('all')} />
            )}
            {category && (
              <FilterChip label={`카테고리: ${getEmoji(category)} ${getLabel(category)}`} onRemove={() => handleCategoryChange('')} />
            )}
            {priority && (
              <FilterChip label={`우선순위: ${PRIORITY_LABEL[priority] ?? priority}`} onRemove={() => handlePriorityChange('')} />
            )}
            {sla && (
              <FilterChip label={SLA_LABEL[sla] ?? sla} onRemove={() => handleSlaChange('')} />
            )}
            {search && (
              <FilterChip label={`"${search}"`} onRemove={() => { setSearch(''); setSearchInput(''); syncUrl({ q: '' }) }} />
            )}
            {selectedRequester && (
              <FilterChip label={`신청자: ${selectedRequester}`} onRemove={() => handleRequesterChange('')} />
            )}
            {(fromDate || toDate) && (
              <FilterChip
                label={`등록일: ${fromDate || '~'} ~ ${toDate || '~'}`}
                onRemove={() => { setFromDate(''); setToDate(''); setPage(1); syncUrl({ from: '', to: '' }) }}
              />
            )}
            <button onClick={resetAllFilters} className="text-xs text-red-500 hover:text-red-700 ml-1 underline">
              모두 초기화
            </button>
          </div>
        )}

        {/* Saved filters — agent only */}
        {isAgent && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-2 border-t dark:border-gray-700 pt-2.5">
            {savedFilters.length > 0 && (
              <>
                <select
                  defaultValue=""
                  onChange={e => {
                    const f = savedFilters.find(sf => sf.id === Number(e.target.value))
                    if (f) applyFilter(f)
                    e.target.value = ''
                  }}
                  className="border dark:border-gray-600 rounded-md px-2 py-1 text-xs text-gray-600 dark:text-gray-300 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">저장된 필터...</option>
                  {savedFilters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-1">
                  {savedFilters.map(f => (
                    <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
                      <button onClick={() => applyFilter(f)} className="hover:text-blue-600 dark:hover:text-blue-400">{f.name}</button>
                      <button onClick={() => handleDeleteFilter(f.id)} className="hover:text-red-500 font-bold leading-none">×</button>
                    </span>
                  ))}
                </div>
              </>
            )}
            {showSaveFilter ? (
              <div className="flex items-center gap-2">
                <input
                  type="text" placeholder="필터 이름..." value={saveFilterName}
                  onChange={e => setSaveFilterName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveFilter() }}
                  className="border dark:border-gray-600 rounded-md px-2 py-1 text-xs w-32 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
                <button onClick={handleSaveFilter} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700">저장</button>
                <button onClick={() => { setShowSaveFilter(false); setSaveFilterName(''); setSavedFilterError(null) }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">취소</button>
                {savedFilterError && <span className="text-xs text-red-600 dark:text-red-400">{savedFilterError}</span>}
              </div>
            ) : (
              <button onClick={() => setShowSaveFilter(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ 필터 저장</button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 rounded-lg p-3 mb-4 text-sm">⚠️ {error}</div>
      )}

      {/* Main content */}
      {!error && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Toolbar: sort + bulk + create */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-3">
              {loading ? (
                <span className="text-sm text-gray-400 dark:text-gray-500">로드 중...</span>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">총 <span className="font-semibold text-gray-700 dark:text-gray-200">{total}</span>건</span>
              )}
              {/* Bulk action — inline when items selected */}
              {isAgent && selectedIids.size > 0 && (
                <form onSubmit={handleBulkSubmit} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
                    {selectedIids.size}개 선택
                  </span>
                  <select
                    value={bulkAction}
                    onChange={e => { setBulkAction(e.target.value); setBulkValue('') }}
                    className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="close">일괄 종료</option>
                    <option value="assign">일괄 배정</option>
                    <option value="set_priority">우선순위 변경</option>
                    <option value="set_status">상태 변경</option>
                  </select>
                  {bulkAction === 'assign' && (
                    <input type="number" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                      placeholder="GitLab ID" className="border dark:border-gray-600 rounded px-2 py-1 text-sm w-28 dark:bg-gray-700 dark:text-gray-200 focus:outline-none" />
                  )}
                  {bulkAction === 'set_priority' && (
                    <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} required
                      className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none">
                      <option value="">선택</option>
                      <option value="critical">긴급</option>
                      <option value="high">높음</option>
                      <option value="medium">보통</option>
                      <option value="low">낮음</option>
                    </select>
                  )}
                  {bulkAction === 'set_status' && (
                    <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} required
                      className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none">
                      <option value="">선택</option>
                      <option value="approved">승인완료</option>
                      <option value="in_progress">처리 중</option>
                      <option value="waiting">추가정보 대기</option>
                      <option value="testing">테스트중</option>
                      <option value="resolved">처리 완료</option>
                      <option value="ready_for_release">운영배포전</option>
                      <option value="released">운영반영완료</option>
                    </select>
                  )}
                  <button type="submit" disabled={bulkProcessing}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                    {bulkProcessing ? '처리 중...' : '실행'}
                  </button>
                  <button type="button" onClick={() => setSelectedIids(new Set())} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">취소</button>
                  {bulkError && <span className="text-xs text-red-600 dark:text-red-400">{bulkError}</span>}
                </form>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <select
                value={sortBy}
                onChange={e => { const v = e.target.value as 'newest' | 'oldest' | 'priority'; setSortBy(v); syncUrl({ sort: v }) }}
                className="border dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-600 dark:text-gray-300 dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="priority">우선순위순</option>
              </select>
              {isAgent && (
                <div className="flex gap-1">
                  <button
                    onClick={handleExportCsv}
                    className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                    title="현재 필터 기준으로 CSV 내보내기"
                  >
                    CSV
                  </button>
                  <button
                    onClick={handleExportXlsx}
                    className="border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-md text-sm hover:bg-green-50 dark:hover:bg-green-900/30 whitespace-nowrap"
                    title="현재 필터 기준으로 Excel 내보내기"
                  >
                    Excel
                  </button>
                </div>
              )}
              <Link href="/tickets/new"
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700 whitespace-nowrap">
                + 새 티켓
              </Link>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {[1,2,3,4,5,6,7,8].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td className="w-16 px-3 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-8" /></td>
                    <td className="px-3 py-3">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-1.5" />
                      <div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-1/4" />
                    </td>
                    <td className="w-24 px-3 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16" /></td>
                    <td className="w-20 px-3 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-12" /></td>
                    <td className="w-24 px-3 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-14" /></td>
                    <td className="w-28 px-3 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16" /></td>
                    <td className="w-28 px-3 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20" /></td>
                    <td className="w-20 px-3 py-3"><div className="h-3 bg-gray-100 dark:bg-gray-700/60 rounded w-12" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : sortedTickets.length === 0 ? (
            <div className="text-center py-20 text-gray-400 dark:text-gray-500">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-base mb-4">{hasActiveFilters ? '조건에 맞는 티켓이 없습니다.' : '등록된 티켓이 없습니다.'}</p>
              {hasActiveFilters ? (
                <button onClick={resetAllFilters} className="text-sm text-blue-600 hover:underline">필터 초기화</button>
              ) : (
                <Link href="/tickets/new" className="inline-block bg-blue-600 text-white px-5 py-2 rounded-md text-sm hover:bg-blue-700">
                  첫 티켓 등록하기
                </Link>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {isAgent && (
                    <th className="w-10 px-4 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIids.size === sortedTickets.length && sortedTickets.length > 0}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="w-16 px-3 py-2.5 text-left">번호</th>
                  <th className="px-3 py-2.5 text-left">제목</th>
                  <th className="w-24 px-3 py-2.5 text-left">상태</th>
                  <th className="w-20 px-3 py-2.5 text-left hidden sm:table-cell">우선순위</th>
                  <th className="w-24 px-3 py-2.5 text-left hidden md:table-cell">카테고리</th>
                  <th className="w-28 px-3 py-2.5 text-left hidden md:table-cell">담당자</th>
                  <th className="w-28 px-3 py-2.5 text-left hidden lg:table-cell">SLA</th>
                  <th className="w-20 px-3 py-2.5 text-left hidden sm:table-cell">등록일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {sortedTickets.map(ticket => {
                  const ticketHref = ticket.project_id
                    ? `/tickets/${ticket.iid}?project_id=${ticket.project_id}`
                    : `/tickets/${ticket.iid}`
                  const isSelected = selectedIids.has(ticket.iid)
                  return (
                    <tr
                      key={`${ticket.project_id}-${ticket.iid}`}
                      className={`group transition-colors ${
                        isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                      }`}
                    >
                      {isAgent && (
                        <td
                          className="w-10 px-4 py-3 cursor-pointer"
                          onClick={e => { e.stopPropagation(); toggleSelect(ticket.iid) }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                          />
                        </td>
                      )}
                      <td className="w-16 px-3 py-3">
                        <Link href={ticketHref} className="font-mono text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
                          #{ticket.iid}
                        </Link>
                      </td>
                      <td className="px-3 py-3 max-w-0">
                        <Link href={ticketHref} className="block">
                          <p className="font-medium text-gray-800 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {ticket.title}
                          </p>
                          {ticket.employee_name && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">신청자: {ticket.employee_name}</p>
                          )}
                        </Link>
                      </td>
                      <td className="w-24 px-3 py-3">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="w-20 px-3 py-3 hidden sm:table-cell">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="w-24 px-3 py-3 hidden md:table-cell">
                        <CategoryBadge category={ticket.category} />
                      </td>
                      <td className="w-28 px-3 py-3 hidden md:table-cell">
                        {ticket.assignee_name ? (
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">{formatName(ticket.assignee_name)}</span>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-gray-600">미배정</span>
                        )}
                      </td>
                      <td className="w-28 px-3 py-3 hidden lg:table-cell">
                        <SlaBadge priority={ticket.priority} createdAt={ticket.created_at} state={ticket.state} slaDeadline={ticket.sla_deadline} />
                      </td>
                      <td className="w-20 px-3 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap hidden sm:table-cell">
                        {formatDate(ticket.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <span className="text-xs text-gray-400 dark:text-gray-500">{page} / {totalPages} 페이지</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← 이전
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 7) pageNum = i + 1
                  else if (page <= 4) pageNum = i + 1
                  else if (page >= totalPages - 3) pageNum = totalPages - 6 + i
                  else pageNum = page - 3 + i
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-7 h-7 text-xs rounded transition-colors ${
                        pageNum === page ? 'bg-blue-600 text-white font-medium' : 'border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  다음 →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full px-2.5 py-0.5 font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 dark:hover:text-blue-100 font-bold leading-none ml-0.5">×</button>
    </span>
  )
}

export default function HomePage() {
  return (
    <RequireAuth>
      <HomeContent />
    </RequireAuth>
  )
}
