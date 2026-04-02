'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  fetchTickets, fetchTicketStats, fetchProjects, bulkUpdateTickets,
  fetchTicketRequesters, fetchSavedFilters, createSavedFilter, deleteSavedFilter,
  fetchFilterOptions, fetchDashboardConfig, saveDashboardConfig,
  fetchKBArticles, importTicketsCSV, downloadImportTemplate,
  fetchDashboardExtraStats,
} from '@/lib/api'
import type { CSVImportResult, DashboardExtraStats } from '@/lib/api'
import type { FilterOptions } from '@/lib/api'
import { formatName, formatDate } from '@/lib/utils'
import { PRIORITY_ORDER, DEFAULT_PER_PAGE, API_BASE } from '@/lib/constants'
import type { Ticket, GitLabProject, TicketStats, SavedFilter, KBArticle, NotificationItem } from '@/types'
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

  // CSV 가져오기 모달
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // 대시보드 위젯 설정
  const DEFAULT_WIDGETS = [
    { id: 'my_tickets',         visible: true,  order: 0 },
    { id: 'sla_status',         visible: true,  order: 1 },
    { id: 'recent_kb',          visible: true,  order: 2 },
    { id: 'ticket_stats',       visible: true,  order: 3 },
    { id: 'notifications',      visible: true,  order: 4 },
    { id: 'quick_actions',      visible: true,  order: 5 },
    { id: 'sla_breached',       visible: false, order: 6 },
    { id: 'unassigned_tickets', visible: false, order: 7 },
    { id: 'team_workload',      visible: false, order: 8 },
  ]
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS)
  const [editingWidgets, setEditingWidgets] = useState(DEFAULT_WIDGETS)
  const [editMode, setEditMode] = useState(false)
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // 위젯 추가 데이터
  const [recentKB, setRecentKB] = useState<KBArticle[]>([])
  const [recentNotifications, setRecentNotifications] = useState<NotificationItem[]>([])
  const [extraStats, setExtraStats] = useState<DashboardExtraStats | null>(null)

  function isWidgetVisible(id: string) {
    return widgets.find(w => w.id === id)?.visible ?? true
  }

  function getSortedVisibleWidgets() {
    return [...widgets].filter(w => w.visible).sort((a, b) => a.order - b.order)
  }

  function getSortedEditingWidgets() {
    return [...editingWidgets].sort((a, b) => a.order - b.order)
  }

  function startEdit() {
    setEditingWidgets([...widgets])
    setEditMode(true)
  }

  function cancelEdit() {
    setEditMode(false)
  }

  async function saveWidgetSettings() {
    const next = editingWidgets
    setWidgets(next)
    setEditMode(false)
    saveDashboardConfig({ widgets: next.map(w => ({ id: w.id, visible: w.visible, order: w.order })) }).catch(() => {})
  }

  function toggleEditingWidget(id: string) {
    setEditingWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w))
  }

  function moveEditingWidget(id: string, direction: 'up' | 'down') {
    setEditingWidgets(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order)
      const idx = sorted.findIndex(w => w.id === id)
      if (idx < 0) return prev
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev
      const newSorted = [...sorted]
      const tempOrder = newSorted[idx].order
      newSorted[idx] = { ...newSorted[idx], order: newSorted[swapIdx].order }
      newSorted[swapIdx] = { ...newSorted[swapIdx], order: tempOrder }
      return newSorted
    })
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    const sourceId = dragIdRef.current
    dragIdRef.current = null
    setDragOverId(null)
    if (!sourceId || sourceId === targetId) return
    setEditingWidgets(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order)
      const fromIdx = sorted.findIndex(w => w.id === sourceId)
      const toIdx = sorted.findIndex(w => w.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const reordered = [...sorted]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, moved)
      return reordered.map((w, i) => ({ ...w, order: i }))
    })
  }

  function handleDragEnd() {
    dragIdRef.current = null
    setDragOverId(null)
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
      fetchDashboardConfig()
        .then(cfg => {
          if (cfg?.widgets?.length > 0) {
            const merged = DEFAULT_WIDGETS.map(def => {
              const saved = cfg.widgets.find((w: { id: string }) => w.id === def.id)
              return saved ? { ...def, visible: saved.visible, order: saved.order } : def
            })
            setWidgets(merged)
            setEditingWidgets(merged)
          }
        })
        .catch(() => {})

      // ⑤ 대시보드 부가 데이터 로드
      fetchKBArticles({ per_page: 5, page: 1 })
        .then(res => setRecentKB(res.articles))
        .catch(() => {})
      fetchDashboardExtraStats()
        .then(setExtraStats)
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

  async function handleImportCsv() {
    if (!importFile) return
    setImportLoading(true)
    setImportError(null)
    setImportResult(null)
    try {
      const result = await importTicketsCSV(importFile, selectedProject || undefined)
      setImportResult(result)
      if (result.imported > 0) await load()
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'CSV 가져오기 실패')
    } finally {
      setImportLoading(false)
    }
  }

  function closeImportModal() {
    setShowImportModal(false)
    setImportFile(null)
    setImportResult(null)
    setImportError(null)
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
  const SLA_LABEL: Record<string, string> = { over: t('filter.sla_exceeded'), imminent: t('filter.sla_warning'), warning: t('filter.sla_caution'), good: t('filter.sla_ok') }

  // Stat tabs config
  const statTabs = [
    { key: 'all',               label: t('ticket.status.all'),               count: stats?.all ?? total,            ring: 'ring-gray-400',   active: 'bg-gray-100 border-gray-400',    num: 'text-gray-800'   },
    { key: 'open',              label: t('ticket.status.open'),              count: stats?.open ?? 0,               ring: 'ring-yellow-400', active: 'bg-yellow-50 border-yellow-400', num: 'text-yellow-700' },
    { key: 'approved',          label: t('ticket.status.approved'),          count: stats?.approved ?? 0,           ring: 'ring-teal-400',   active: 'bg-teal-50 border-teal-400',     num: 'text-teal-700'   },
    { key: 'in_progress',       label: t('ticket.status.in_progress'),       count: stats?.in_progress ?? 0,        ring: 'ring-blue-400',   active: 'bg-blue-50 border-blue-400',     num: 'text-blue-700'   },
    { key: 'waiting',           label: t('ticket.status.waiting'),           count: stats?.waiting ?? 0,            ring: 'ring-orange-400', active: 'bg-orange-50 border-orange-400', num: 'text-orange-700' },
    { key: 'resolved',          label: t('ticket.status.resolved'),          count: stats?.resolved ?? 0,           ring: 'ring-purple-400', active: 'bg-purple-50 border-purple-400', num: 'text-purple-700' },
    { key: 'testing',           label: t('ticket.status.testing'),           count: stats?.testing ?? 0,            ring: 'ring-violet-400', active: 'bg-violet-50 border-violet-400', num: 'text-violet-700' },
    { key: 'ready_for_release', label: t('ticket.status.ready_for_release'), count: stats?.ready_for_release ?? 0,  ring: 'ring-amber-400',  active: 'bg-amber-50 border-amber-400',   num: 'text-amber-700'  },
    { key: 'released',          label: t('ticket.status.deployed'),          count: stats?.released ?? 0,           ring: 'ring-indigo-400', active: 'bg-indigo-50 border-indigo-400', num: 'text-indigo-700' },
    { key: 'closed',            label: t('ticket.status.closed'),            count: stats?.closed ?? 0,             ring: 'ring-green-400',  active: 'bg-green-50 border-green-400',   num: 'text-green-700'  },
  ]

  const slaOver = stats?.sla_over ?? 0
  const slaImminent = stats?.sla_imminent ?? 0
  const myTickets = tickets.filter(t => user && t.assignee_username === user.username)

  return (
    <div>
      {/* 페이지 제목 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          {t('nav.tickets')}
        </h1>
      </div>

      {/* 대시보드 편집 모드 패널 */}
      {editMode && (
        <div className="mb-4 bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-400 dark:border-blue-500 shadow-md p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('dashboard.widget_settings')}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('dashboard.widget_drag_hint')}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveWidgetSettings}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
              >
                {t('common.save')}
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {getSortedEditingWidgets().map((w) => (
              <div
                key={w.id}
                draggable
                onDragStart={e => handleDragStart(e, w.id)}
                onDragOver={e => handleDragOver(e, w.id)}
                onDrop={e => handleDrop(e, w.id)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 px-2 py-2 rounded-lg border transition-colors cursor-grab active:cursor-grabbing select-none
                  ${dragOverId === w.id && dragIdRef.current !== w.id
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                  }
                `}
              >
                {/* 드래그 핸들 */}
                <span className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 text-sm leading-none">
                  ⠿
                </span>
                <input
                  type="checkbox"
                  checked={w.visible}
                  onChange={() => toggleEditingWidget(w.id)}
                  onClick={e => e.stopPropagation()}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 cursor-pointer"
                />
                <span className={`flex-1 text-sm ${w.visible ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600 line-through'}`}>
                  {t(`dashboard.${w.id}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 대시보드 위젯 바 */}
      <div className="mb-4">
        {/* 위젯 헤더 (편집 버튼) */}
        <div className="flex justify-end mb-2">
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shadow-sm"
            title={t('dashboard.edit')}
          >
            <span>⚙️</span>
            <span>{t('dashboard.edit')}</span>
          </button>
        </div>

        {/* 위젯 목록 */}
        {getSortedVisibleWidgets().length > 0 && (
          <div className="flex gap-3 flex-wrap">
            {getSortedVisibleWidgets().map(w => {
              if (w.id === 'my_tickets') return (
                <div key="my_tickets" className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.my_tickets')}</span>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{myTickets.length}</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('dashboard.assigned_to_me')}</p>
                  {myTickets.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {myTickets.slice(0, 5).map(t => (
                        <a key={t.iid} href={`/tickets/${t.iid}`} className="block text-xs text-blue-600 dark:text-blue-400 hover:underline truncate">
                          #{t.iid} {t.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
              if (w.id === 'sla_status') return (
                <div key="sla_status" className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.sla_status')}</span>
                    {slaOver > 0 ? (
                      <span className="text-xl font-bold text-red-600">{slaOver}</span>
                    ) : (
                      <span className="text-xl font-bold text-green-600">✓</span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs"><span className="text-red-500 font-semibold">{slaOver}</span> <span className="text-gray-400">{t('dashboard.sla_exceeded')}</span></span>
                    <span className="text-xs"><span className="text-orange-500 font-semibold">{slaImminent}</span> <span className="text-gray-400">{t('dashboard.sla_warning')}</span></span>
                    <span className="text-xs"><span className="text-green-500 font-semibold">{Math.max(0, (stats?.all ?? 0) - slaOver - slaImminent)}</span> <span className="text-gray-400">{t('dashboard.sla_ok')}</span></span>
                  </div>
                  {slaOver === 0 && slaImminent === 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">{t('sla.onTime')}</p>
                  )}
                </div>
              )
              if (w.id === 'recent_kb') return (
                <div key="recent_kb" className="flex-1 min-w-[200px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.recent_kb')}</span>
                    <Link href="/kb" className="text-xs text-blue-500 hover:underline">{t('common.all')}</Link>
                  </div>
                  <div className="mt-2 space-y-1">
                    {recentKB.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500">{t('common.noData')}</p>
                    ) : recentKB.map(kb => (
                      <a key={kb.id} href={`/kb/${kb.id}`} className="block text-xs text-blue-600 dark:text-blue-400 hover:underline truncate">
                        {kb.title}
                      </a>
                    ))}
                  </div>
                </div>
              )
              if (w.id === 'ticket_stats') return (
                <div key="ticket_stats" className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.ticket_stats')}</span>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                    <div>
                      <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{stats?.open ?? 0}</div>
                      <div className="text-[10px] text-gray-400">{t('dashboard.open')}</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{stats?.in_progress ?? 0}</div>
                      <div className="text-[10px] text-gray-400">{t('dashboard.in_progress')}</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">{stats?.closed ?? 0}</div>
                      <div className="text-[10px] text-gray-400">{t('dashboard.closed')}</div>
                    </div>
                  </div>
                </div>
              )
              if (w.id === 'notifications') return (
                <div key="notifications" className="flex-1 min-w-[200px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.notifications')}</span>
                    <Link href="/notifications" className="text-xs text-blue-500 hover:underline">{t('common.all')}</Link>
                  </div>
                  <div className="mt-2 space-y-1">
                    {recentNotifications.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500">{t('notifications.empty')}</p>
                    ) : recentNotifications.map(n => (
                      <div key={n.id} className={`text-xs truncate ${n.is_read ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300 font-medium'}`}>
                        {n.link ? (
                          <a href={n.link} className="hover:underline">{n.title}</a>
                        ) : n.title}
                      </div>
                    ))}
                  </div>
                </div>
              )
              if (w.id === 'quick_actions') return (
                <div key="quick_actions" className="flex-1 min-w-[160px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.quick_actions')}</span>
                  <div className="mt-2 space-y-1.5">
                    <Link href="/tickets/new" className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      <span>+</span> {t('ticket.new')}
                    </Link>
                    <Link href="/kb" className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      <span>📚</span> {t('nav.kb')}
                    </Link>
                    <Link href="/reports" className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      <span>📊</span> {t('nav.reports')}
                    </Link>
                    <Link href="/notifications" className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      <span>🔔</span> {t('notifications.title')}
                    </Link>
                  </div>
                </div>
              )
              if (w.id === 'sla_breached') return (
                <div key="sla_breached" className="flex-1 min-w-[200px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.sla_breached')}</span>
                    <span className={`text-xl font-bold ${extraStats && extraStats.sla_breached_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {extraStats?.sla_breached_count ?? 0}
                    </span>
                  </div>
                  {extraStats?.sla_breached && extraStats.sla_breached.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {extraStats.sla_breached.slice(0, 5).map(item => (
                        <a key={item.iid} href={`/tickets/${item.iid}`} className="flex items-center justify-between text-xs hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5">
                          <span className="text-red-600 dark:text-red-400 font-mono">#{item.iid}</span>
                          <span className="text-gray-400 dark:text-gray-500 text-[10px]">
                            {item.sla_deadline ? new Date(item.sla_deadline).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '-'}
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">모든 티켓 SLA 준수 중</p>
                  )}
                </div>
              )
              if (w.id === 'unassigned_tickets') return (
                <div key="unassigned_tickets" className="flex-1 min-w-[180px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.unassigned_tickets')}</span>
                    <span className={`text-xl font-bold ${(stats?.open ?? 0) > 0 ? 'text-orange-500 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                      {stats?.open ?? 0}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">오픈 티켓 현황</p>
                  <Link href="/?status=open" className="mt-2 block text-xs text-blue-500 hover:underline">
                    미배정 티켓 보기 →
                  </Link>
                </div>
              )
              if (w.id === 'team_workload') return (
                <div key="team_workload" className="flex-1 min-w-[200px] bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('dashboard.team_workload')}</span>
                  {extraStats?.team_workload && extraStats.team_workload.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {extraStats.team_workload.slice(0, 5).map(item => {
                        const maxCount = extraStats.team_workload[0]?.count ?? 1
                        const pct = Math.round((item.count / maxCount) * 100)
                        return (
                          <div key={item.username}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="text-gray-600 dark:text-gray-400 truncate max-w-[120px]">{item.username}</span>
                              <span className="text-gray-500 dark:text-gray-500 font-medium">{item.count}</span>
                            </div>
                            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">데이터 없음</p>
                  )}
                </div>
              )
              return null
            })}

            {/* 갱신 시각 + 수동 갱신 버튼 */}
            <div className="flex flex-col items-center justify-center gap-1">
              <button
                onClick={refreshStats}
                className="px-2 py-1 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Refresh now"
              >
                ↻
              </button>
              {statsUpdatedAt && (
                <span className="text-[10px] text-gray-300 dark:text-gray-600 whitespace-nowrap">
                  {statsUpdatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status Tabs */}
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

      {/* Filter Bar */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm mb-4">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <select
              aria-label="프로젝트 선택"
              value={selectedProject}
              onChange={e => handleProjectChange(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map(p => <option key={p.id} value={p.id}>{p.name_with_namespace}</option>)}
            </select>
          )}

          {/* 1. 상태 */}
          <select
            aria-label={t('filter.all_status')}
            value={state === 'all' ? '' : state}
            onChange={e => handleStateChange(e.target.value || 'all')}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('filter.all_status')}</option>
            {(filterOptions?.statuses ?? []).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          {/* 2. 우선순위 */}
          <select
            aria-label={t('filter.all_priority')}
            value={priority}
            onChange={e => handlePriorityChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('filter.all_priority')}</option>
            {(filterOptions?.priorities ?? [
              { key: 'critical', label: t('ticket.priority.critical') },
              { key: 'high',     label: t('ticket.priority.high') },
              { key: 'medium',   label: t('ticket.priority.medium') },
              { key: 'low',      label: t('ticket.priority.low') },
            ]).map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>

          {/* 3. 카테고리 */}
          <select
            aria-label={t('filter.all_category')}
            value={category}
            onChange={e => handleCategoryChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('filter.all_category')}</option>
            {(filterOptions?.categories ?? serviceTypes.map(t => ({ key: t.label, label: t.label, emoji: t.emoji }))).map(c => (
              <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
            ))}
          </select>

          {/* 4. SLA */}
          <select
            aria-label={t('filter.all_sla')}
            value={sla}
            onChange={e => handleSlaChange(e.target.value)}
            className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('filter.all_sla')}</option>
            <option value="over">🔴 {t('filter.sla_exceeded')}</option>
            <option value="imminent">🟠 {t('filter.sla_warning')}</option>
            <option value="warning">🟡 {t('filter.sla_caution')}</option>
            <option value="good">🟢 {t('filter.sla_ok')}</option>
          </select>

          {/* 5. 신청자 */}
          {isAgent && requesters.length > 0 && (
            <select
              aria-label={t('filter.all_requester')}
              value={selectedRequester}
              onChange={e => handleRequesterChange(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('filter.all_requester')}</option>
              {requesters.map(r => (
                <option key={r.username} value={r.username}>
                  {r.employee_name ? `${r.employee_name} (${r.username})` : r.username}
                </option>
              ))}
            </select>
          )}

          {/* 등록일 기간 필터 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t('filter.date_label')}</span>
            <input
              type="date"
              aria-label={t('filter.date_from')}
              value={fromDate}
              max={toDate || undefined}
              onChange={e => { setFromDate(e.target.value); setPage(1); syncUrl({ from: e.target.value }) }}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-400 dark:text-gray-500">~</span>
            <input
              type="date"
              aria-label={t('filter.date_to')}
              value={toDate}
              min={fromDate || undefined}
              onChange={e => { setToDate(e.target.value); setPage(1); syncUrl({ to: e.target.value }) }}
              className="border dark:border-gray-600 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); setPage(1); syncUrl({ from: '', to: '' }) }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 px-1"
                title="Clear dates"
              >✕</button>
            )}
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-1.5 ml-auto">
            <input
              type="text"
              placeholder={t('filter.search_placeholder')}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="border dark:border-gray-600 rounded-md px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700">
              {t('common.search')}
            </button>
          </form>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 border-t dark:border-gray-700 pt-2.5">
            <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">{t('filter.saved')}:</span>
            {state && state !== 'all' && (
              <FilterChip label={`${t('ticket.fields.status')}: ${filterOptions?.statuses.find(s => s.key === state)?.label ?? statTabs.find(tab => tab.key === state)?.label ?? state}`} onRemove={() => handleStateChange('all')} />
            )}
            {category && (
              <FilterChip label={`${t('ticket.fields.category')}: ${getEmoji(category)} ${getLabel(category)}`} onRemove={() => handleCategoryChange('')} />
            )}
            {priority && (
              <FilterChip label={`${t('ticket.fields.priority')}: ${PRIORITY_LABEL[priority] ?? priority}`} onRemove={() => handlePriorityChange('')} />
            )}
            {sla && (
              <FilterChip label={SLA_LABEL[sla] ?? sla} onRemove={() => handleSlaChange('')} />
            )}
            {search && (
              <FilterChip label={`"${search}"`} onRemove={() => { setSearch(''); setSearchInput(''); syncUrl({ q: '' }) }} />
            )}
            {selectedRequester && (
              <FilterChip label={`${t('ticket.fields.requester')}: ${selectedRequester}`} onRemove={() => handleRequesterChange('')} />
            )}
            {(fromDate || toDate) && (
              <FilterChip
                label={`${t('filter.date_label')}: ${fromDate || '~'} ~ ${toDate || '~'}`}
                onRemove={() => { setFromDate(''); setToDate(''); setPage(1); syncUrl({ from: '', to: '' }) }}
              />
            )}
            <button onClick={resetAllFilters} className="text-xs text-red-500 hover:text-red-700 ml-1 underline">
              {t('common.reset')}
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
                  aria-label={t('filter.saved')}
                  onChange={e => {
                    const f = savedFilters.find(sf => sf.id === Number(e.target.value))
                    if (f) applyFilter(f)
                    e.target.value = ''
                  }}
                  className="border dark:border-gray-600 rounded-md px-2 py-1 text-xs text-gray-600 dark:text-gray-300 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">{t('filter.saved')}...</option>
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
                  type="text" placeholder={`${t('filter.save')}...`} value={saveFilterName}
                  onChange={e => setSaveFilterName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveFilter() }}
                  className="border dark:border-gray-600 rounded-md px-2 py-1 text-xs w-32 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
                <button onClick={handleSaveFilter} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700">{t('common.save')}</button>
                <button onClick={() => { setShowSaveFilter(false); setSaveFilterName(''); setSavedFilterError(null) }} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">{t('common.cancel')}</button>
                {savedFilterError && <span className="text-xs text-red-600 dark:text-red-400">{savedFilterError}</span>}
              </div>
            ) : (
              <button onClick={() => setShowSaveFilter(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ {t('filter.save')}</button>
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
                <span className="text-sm text-gray-400 dark:text-gray-500">{t('common.loading')}</span>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400"><span className="font-semibold text-gray-700 dark:text-gray-200">{total}</span> {t('common.total')}</span>
              )}
              {/* Bulk action — inline when items selected */}
              {isAgent && selectedIids.size > 0 && (
                <form onSubmit={handleBulkSubmit} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
                    {selectedIids.size} selected
                  </span>
                  <select
                    value={bulkAction}
                    onChange={e => { setBulkAction(e.target.value); setBulkValue('') }}
                    className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="close">Bulk Close</option>
                    <option value="assign">Bulk Assign</option>
                    <option value="set_priority">{t('ticket.fields.priority')}</option>
                    <option value="set_status">{t('ticket.fields.status')}</option>
                  </select>
                  {bulkAction === 'assign' && (
                    <input type="number" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                      placeholder="GitLab ID" className="border dark:border-gray-600 rounded px-2 py-1 text-sm w-28 dark:bg-gray-700 dark:text-gray-200 focus:outline-none" />
                  )}
                  {bulkAction === 'set_priority' && (
                    <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} required
                      className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none">
                      <option value="">Select</option>
                      <option value="critical">{t('ticket.priority.critical')}</option>
                      <option value="high">{t('ticket.priority.high')}</option>
                      <option value="medium">{t('ticket.priority.medium')}</option>
                      <option value="low">{t('ticket.priority.low')}</option>
                    </select>
                  )}
                  {bulkAction === 'set_status' && (
                    <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} required
                      className="border dark:border-gray-600 rounded px-2 py-1 text-sm dark:bg-gray-700 dark:text-gray-200 focus:outline-none">
                      <option value="">Select</option>
                      <option value="approved">{t('ticket.status.approved')}</option>
                      <option value="in_progress">{t('ticket.status.in_progress')}</option>
                      <option value="waiting">{t('ticket.status.waiting')}</option>
                      <option value="testing">{t('ticket.status.testing')}</option>
                      <option value="resolved">{t('ticket.status.resolved')}</option>
                      <option value="ready_for_release">{t('ticket.status.ready_for_release')}</option>
                      <option value="released">{t('ticket.status.deployed')}</option>
                    </select>
                  )}
                  <button type="submit" disabled={bulkProcessing}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                    {bulkProcessing ? t('common.loading') : t('common.confirm')}
                  </button>
                  <button type="button" onClick={() => setSelectedIids(new Set())} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">{t('common.cancel')}</button>
                  {bulkError && <span className="text-xs text-red-600 dark:text-red-400">{bulkError}</span>}
                </form>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <select
                value={sortBy}
                aria-label="정렬 기준"
                onChange={e => { const v = e.target.value as 'newest' | 'oldest' | 'priority'; setSortBy(v); syncUrl({ sort: v }) }}
                className="border dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-600 dark:text-gray-300 dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="newest">{t('filter.newest')}</option>
                <option value="oldest">{t('filter.oldest')}</option>
                <option value="priority">{t('filter.by_priority')}</option>
              </select>
              {isAgent && (
                <div className="flex gap-1">
                  <button
                    onClick={handleExportCsv}
                    className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                    title="Export CSV with current filters"
                  >
                    CSV
                  </button>
                  <button
                    onClick={handleExportXlsx}
                    className="border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-md text-sm hover:bg-green-50 dark:hover:bg-green-900/30 whitespace-nowrap"
                    title="Export Excel with current filters"
                  >
                    Excel
                  </button>
                  <button
                    onClick={() => setShowImportModal(true)}
                    className="border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-md text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 whitespace-nowrap"
                    title="CSV 파일로 티켓 일괄 가져오기"
                  >
                    CSV 가져오기
                  </button>
                </div>
              )}
              <Link href="/tickets/new"
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700 whitespace-nowrap">
                + {t('ticket.new')}
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
              <p className="text-base mb-4">{hasActiveFilters ? 'No tickets match your filters.' : 'No tickets yet.'}</p>
              {hasActiveFilters ? (
                <button onClick={resetAllFilters} className="text-sm text-blue-600 hover:underline">{t('common.reset')} filters</button>
              ) : (
                <Link href="/tickets/new" className="inline-block bg-blue-600 text-white px-5 py-2 rounded-md text-sm hover:bg-blue-700">
                  + {t('ticket.new')}
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
                        aria-label="전체 선택"
                        checked={selectedIids.size === sortedTickets.length && sortedTickets.length > 0}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="w-16 px-3 py-2.5 text-left">{t('ticket.fields.number')}</th>
                  <th className="px-3 py-2.5 text-left">{t('ticket.fields.title')}</th>
                  <th className="w-24 px-3 py-2.5 text-left">{t('ticket.fields.status')}</th>
                  <th className="w-20 px-3 py-2.5 text-left hidden sm:table-cell">{t('ticket.fields.priority')}</th>
                  <th className="w-24 px-3 py-2.5 text-left hidden md:table-cell">{t('ticket.fields.category')}</th>
                  <th className="w-28 px-3 py-2.5 text-left hidden md:table-cell">{t('ticket.fields.assignee')}</th>
                  <th className="w-28 px-3 py-2.5 text-left hidden lg:table-cell">{t('ticket.fields.sla')}</th>
                  <th className="w-20 px-3 py-2.5 text-left hidden sm:table-cell">{t('ticket.fields.createdAt')}</th>
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
                            aria-label={`티켓 ${ticket.iid} 선택`}
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
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{t('ticket.fields.requester')}: {ticket.employee_name}</p>
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
                          <span className="text-xs text-gray-300 dark:text-gray-600">{t('common.unassigned')}</span>
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
              <span className="text-xs text-gray-400 dark:text-gray-500">{page} / {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 text-xs border dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ← {t('common.back')}
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
                  {t('common.next')} →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CSV 가져오기 모달 */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">CSV 티켓 가져오기</h2>
              <button
                onClick={closeImportModal}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* 템플릿 다운로드 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 py-3 text-sm">
                <p className="text-blue-700 dark:text-blue-300 font-medium mb-1">CSV 형식 안내</p>
                <p className="text-blue-600 dark:text-blue-400 text-xs mb-2">
                  필수: title / 선택: description, priority (critical/high/medium/low), category, assignee_username
                </p>
                <button
                  onClick={() => downloadImportTemplate()}
                  className="text-xs text-blue-700 dark:text-blue-300 underline hover:no-underline"
                >
                  템플릿 다운로드 (샘플 데이터 포함)
                </button>
              </div>

              {/* 파일 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  CSV 파일 선택
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={e => {
                    setImportFile(e.target.files?.[0] ?? null)
                    setImportResult(null)
                    setImportError(null)
                  }}
                  className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50"
                />
              </div>

              {/* 에러 */}
              {importError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
                  {importError}
                </div>
              )}

              {/* 결과 */}
              {importResult && (
                <div className="space-y-2">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg px-4 py-3 text-sm font-medium">
                    {importResult.imported}건 성공적으로 가져왔습니다.
                  </div>
                  {importResult.failed.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
                      <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">
                        실패 {importResult.failed.length}건:
                      </p>
                      <ul className="space-y-1 max-h-32 overflow-y-auto">
                        {importResult.failed.map(f => (
                          <li key={f.row} className="text-xs text-red-600 dark:text-red-400">
                            행 {f.row}{f.title ? ` (${f.title})` : ''}: {f.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 액션 */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <button
                onClick={closeImportModal}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                닫기
              </button>
              <button
                onClick={handleImportCsv}
                disabled={!importFile || importLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {importLoading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                {importLoading ? '가져오는 중...' : '가져오기'}
              </button>
            </div>
          </div>
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
