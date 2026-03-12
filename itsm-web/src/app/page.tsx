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


function HomeContent() {
  const { isAgent } = useAuth()
  const { serviceTypes, getLabel, getEmoji } = useServiceTypes()
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
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority'>('newest')
  const [fromDate, setFromDate] = useState(() => searchParams.get('from') || '')
  const [toDate, setToDate] = useState(() => searchParams.get('to') || '')

  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [requesters, setRequesters] = useState<{ username: string; employee_name: string }[]>([])
  const [stats, setStats] = useState<TicketStats | null>(null)
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
  const [showAdvanced, setShowAdvanced] = useState(false)

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
    if (s && s !== 'all') params.set('status', s)
    if (cat) params.set('category', cat)
    if (prio) params.set('priority', prio)
    if (sl) params.set('sla', sl)
    if (q) params.set('q', q)
    if (assignee) params.set('assignee', assignee)
    if (fd) params.set('from', fd)
    if (td) params.set('to', td)
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
        if (projectList.value.length > 1) {
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
    }
    init().catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgent])

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
    setSelectedProject(pid); setPage(1); setPriority(''); setSla(''); setSelectedRequester(''); setSelectedIids(new Set())
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

  function handleExportCsv() {
    const params = new URLSearchParams()
    if (state && state !== 'all') params.set('state', state)
    if (category) params.set('category', category)
    if (priority) params.set('priority', priority)
    if (search) params.set('search', search)
    if (selectedProject) params.set('project_id', selectedProject)
    const qs = params.toString()
    window.open(`${API_BASE}/tickets/export/csv${qs ? `?${qs}` : ''}`, '_blank')
  }

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PER_PAGE))

  // newest/oldest는 서버사이드 정렬 — priority만 클라이언트 보조 정렬
  const sortedTickets = sortBy === 'priority'
    ? [...tickets].sort((a, b) =>
        (PRIORITY_ORDER[(b.priority ?? 'medium') as keyof typeof PRIORITY_ORDER] ?? 2) -
        (PRIORITY_ORDER[(a.priority ?? 'medium') as keyof typeof PRIORITY_ORDER] ?? 2))
    : tickets

  const hasActiveFilters = !!(category || priority || sla || search || selectedRequester || fromDate || toDate || (state && state !== 'all'))

  const PRIORITY_LABEL: Record<string, string> = { critical: '긴급', high: '높음', medium: '보통', low: '낮음' }
  const SLA_LABEL: Record<string, string> = { over: 'SLA 초과', imminent: 'SLA 임박', warning: 'SLA 주의', good: 'SLA 여유' }

  // Stat tabs config
  const statTabs = [
    { key: 'all',      label: '전체',    count: stats?.all ?? total,          ring: 'ring-gray-400',   active: 'bg-gray-100 border-gray-400',  num: 'text-gray-800'   },
    { key: 'open',        label: '접수됨',   count: stats?.open ?? 0,          ring: 'ring-yellow-400',  active: 'bg-yellow-50 border-yellow-400',   num: 'text-yellow-700'  },
    { key: 'in_progress', label: '처리중',   count: stats?.in_progress ?? 0,   ring: 'ring-blue-400',    active: 'bg-blue-50 border-blue-400',       num: 'text-blue-700'    },
    { key: 'waiting',     label: '대기중',   count: stats?.waiting ?? 0,       ring: 'ring-orange-400',  active: 'bg-orange-50 border-orange-400',   num: 'text-orange-700'  },
    { key: 'resolved',    label: '처리완료', count: stats?.resolved ?? 0,      ring: 'ring-purple-400',  active: 'bg-purple-50 border-purple-400',   num: 'text-purple-700'  },
    { key: 'closed',      label: '종료',     count: stats?.closed ?? 0,        ring: 'ring-green-400',   active: 'bg-green-50 border-green-400',     num: 'text-green-700'   },
  ]

  return (
    <div>
      {/* Status Tabs */}
      <div className="grid grid-cols-6 gap-2 mb-5">
        {statTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleStateChange(tab.key)}
            className={`rounded-lg border-2 px-2 py-2.5 text-center transition-all focus:outline-none ${
              state === tab.key
                ? `${tab.active} ring-2 ${tab.ring} shadow-sm`
                : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
            }`}
          >
            {stats === null ? (
              <div className="h-6 bg-gray-200 rounded animate-pulse mb-1" />
            ) : (
              <div className={`text-xl font-bold ${state === tab.key ? tab.num : 'text-gray-700'}`}>
                {tab.count}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-0.5 whitespace-nowrap">{tab.label}</div>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-lg border shadow-sm mb-4">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <select
              value={selectedProject}
              onChange={e => handleProjectChange(e.target.value)}
              className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map(p => <option key={p.id} value={p.id}>{p.name_with_namespace}</option>)}
            </select>
          )}

          {/* 상태 — filter-options에서 동적 생성 */}
          <select
            value={state === 'all' ? '' : state}
            onChange={e => handleStateChange(e.target.value || 'all')}
            className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 상태</option>
            {(filterOptions?.statuses ?? []).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          {/* 카테고리 — filter-options에서 동적 생성 */}
          <select
            value={category}
            onChange={e => handleCategoryChange(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">전체 카테고리</option>
            {(filterOptions?.categories ?? serviceTypes.map(t => ({ key: t.description ?? t.value, label: t.label, emoji: t.emoji }))).map(c => (
              <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
            ))}
          </select>

          {/* 우선순위 — filter-options에서 동적 생성 */}
          <select
            value={priority}
            onChange={e => handlePriorityChange(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          <button
            onClick={() => setShowAdvanced(v => !v)}
            className={`text-sm px-2 py-1.5 rounded-md border transition-colors ${showAdvanced ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            {showAdvanced ? '▲ 간단히' : '▼ 더보기'}
          </button>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-1.5 ml-auto">
            <input
              type="text"
              placeholder="제목 · 내용 검색..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700">
              검색
            </button>
          </form>
        </div>

        {/* Advanced filters */}
        {showAdvanced && (
          <div className="px-4 pb-3 flex flex-wrap gap-2 border-t pt-3 items-center">
            <select
              value={sla}
              onChange={e => handleSlaChange(e.target.value)}
              className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">전체 SLA</option>
              <option value="over">🔴 SLA 초과</option>
              <option value="imminent">🟠 SLA 임박</option>
              <option value="warning">🟡 SLA 주의</option>
              <option value="good">🟢 SLA 여유</option>
            </select>
            {isAgent && requesters.length > 0 && (
              <select
                value={selectedRequester}
                onChange={e => handleRequesterChange(e.target.value)}
                className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <span className="text-xs text-gray-500 whitespace-nowrap">등록일</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={e => { setFromDate(e.target.value); setPage(1); syncUrl({ from: e.target.value }) }}
                className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400">~</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={e => { setToDate(e.target.value); setPage(1); syncUrl({ to: e.target.value }) }}
                className="border rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {(fromDate || toDate) && (
                <button
                  onClick={() => { setFromDate(''); setToDate(''); setPage(1); syncUrl({ from: '', to: '' }) }}
                  className="text-xs text-gray-400 hover:text-red-500 px-1"
                  title="날짜 초기화"
                >✕</button>
              )}
            </div>
          </div>
        )}

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
            <span className="text-xs text-gray-400 mr-1">필터:</span>
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
          <div className="px-4 pb-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
            {savedFilters.length > 0 && (
              <>
                <select
                  defaultValue=""
                  onChange={e => {
                    const f = savedFilters.find(sf => sf.id === Number(e.target.value))
                    if (f) applyFilter(f)
                    e.target.value = ''
                  }}
                  className="border rounded-md px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">저장된 필터...</option>
                  {savedFilters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-1">
                  {savedFilters.map(f => (
                    <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      {f.name}
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
                  className="border rounded-md px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
                <button onClick={handleSaveFilter} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700">저장</button>
                <button onClick={() => { setShowSaveFilter(false); setSaveFilterName(''); setSavedFilterError(null) }} className="text-xs text-gray-500 hover:text-gray-700">취소</button>
                {savedFilterError && <span className="text-xs text-red-600">{savedFilterError}</span>}
              </div>
            ) : (
              <button onClick={() => setShowSaveFilter(true)} className="text-xs text-blue-600 hover:underline">+ 필터 저장</button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">⚠️ {error}</div>
      )}

      {/* Main content */}
      {!error && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {/* Toolbar: sort + bulk + create */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b bg-gray-50">
            <div className="flex items-center gap-3">
              {loading ? (
                <span className="text-sm text-gray-400">로드 중...</span>
              ) : (
                <span className="text-sm text-gray-500">총 <span className="font-semibold text-gray-700">{total}</span>건</span>
              )}
              {/* Bulk action — inline when items selected */}
              {isAgent && selectedIids.size > 0 && (
                <form onSubmit={handleBulkSubmit} className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                    {selectedIids.size}개 선택
                  </span>
                  <select
                    value={bulkAction}
                    onChange={e => { setBulkAction(e.target.value); setBulkValue('') }}
                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="close">일괄 종료</option>
                    <option value="assign">일괄 배정</option>
                    <option value="set_priority">우선순위 변경</option>
                  </select>
                  {bulkAction === 'assign' && (
                    <input type="number" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                      placeholder="GitLab ID" className="border rounded px-2 py-1 text-sm w-28 focus:outline-none" />
                  )}
                  {bulkAction === 'set_priority' && (
                    <select value={bulkValue} onChange={e => setBulkValue(e.target.value)} required
                      className="border rounded px-2 py-1 text-sm focus:outline-none">
                      <option value="">선택</option>
                      <option value="critical">긴급</option>
                      <option value="high">높음</option>
                      <option value="medium">보통</option>
                      <option value="low">낮음</option>
                    </select>
                  )}
                  <button type="submit" disabled={bulkProcessing}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                    {bulkProcessing ? '처리 중...' : '실행'}
                  </button>
                  <button type="button" onClick={() => setSelectedIids(new Set())} className="text-sm text-gray-500 hover:text-gray-700">취소</button>
                  {bulkError && <span className="text-xs text-red-600">{bulkError}</span>}
                </form>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Sort */}
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as 'newest' | 'oldest' | 'priority')}
                className="border rounded px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="priority">우선순위순</option>
              </select>
              {isAgent && (
                <button
                  onClick={handleExportCsv}
                  className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50 whitespace-nowrap"
                  title="현재 필터 기준으로 CSV 내보내기"
                >
                  CSV 내보내기
                </button>
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
              <tbody className="divide-y divide-gray-100">
                {[1,2,3,4,5,6,7,8].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td className="w-16 px-3 py-3"><div className="h-3 bg-gray-200 rounded w-8" /></td>
                    <td className="px-3 py-3">
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-1.5" />
                      <div className="h-3 bg-gray-100 rounded w-1/4" />
                    </td>
                    <td className="w-24 px-3 py-3"><div className="h-5 bg-gray-200 rounded-full w-16" /></td>
                    <td className="w-20 px-3 py-3"><div className="h-5 bg-gray-200 rounded-full w-12" /></td>
                    <td className="w-24 px-3 py-3"><div className="h-5 bg-gray-200 rounded-full w-14" /></td>
                    <td className="w-28 px-3 py-3"><div className="h-3 bg-gray-200 rounded w-16" /></td>
                    <td className="w-28 px-3 py-3"><div className="h-5 bg-gray-200 rounded w-20" /></td>
                    <td className="w-20 px-3 py-3"><div className="h-3 bg-gray-100 rounded w-12" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : sortedTickets.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
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
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  {isAgent && (
                    <th className="w-10 px-4 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIids.size === sortedTickets.length && sortedTickets.length > 0}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="w-16 px-3 py-2.5 text-left">번호</th>
                  <th className="px-3 py-2.5 text-left">제목</th>
                  <th className="w-24 px-3 py-2.5 text-left">상태</th>
                  <th className="w-20 px-3 py-2.5 text-left">우선순위</th>
                  <th className="w-24 px-3 py-2.5 text-left">카테고리</th>
                  <th className="w-28 px-3 py-2.5 text-left">담당자</th>
                  <th className="w-28 px-3 py-2.5 text-left">SLA</th>
                  <th className="w-20 px-3 py-2.5 text-left">등록일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedTickets.map(ticket => {
                  const ticketHref = ticket.project_id
                    ? `/tickets/${ticket.iid}?project_id=${ticket.project_id}`
                    : `/tickets/${ticket.iid}`
                  const isSelected = selectedIids.has(ticket.iid)
                  return (
                    <tr
                      key={`${ticket.project_id}-${ticket.iid}`}
                      className={`group transition-colors ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
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
                            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                          />
                        </td>
                      )}
                      <td className="w-16 px-3 py-3">
                        <Link href={ticketHref} className="font-mono text-xs text-gray-400 hover:text-blue-600">
                          #{ticket.iid}
                        </Link>
                      </td>
                      <td className="px-3 py-3 max-w-0">
                        <Link href={ticketHref} className="block">
                          <p className="font-medium text-gray-800 truncate group-hover:text-blue-600">
                            {ticket.title}
                          </p>
                          {ticket.employee_name && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">신청자: {ticket.employee_name}</p>
                          )}
                        </Link>
                      </td>
                      <td className="w-24 px-3 py-3">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="w-20 px-3 py-3">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="w-24 px-3 py-3">
                        <CategoryBadge category={ticket.category} />
                      </td>
                      <td className="w-28 px-3 py-3">
                        {ticket.assignee_name ? (
                          <span className="text-xs text-blue-600 font-medium">{formatName(ticket.assignee_name)}</span>
                        ) : (
                          <span className="text-xs text-gray-300">미배정</span>
                        )}
                      </td>
                      <td className="w-28 px-3 py-3">
                        <SlaBadge priority={ticket.priority} createdAt={ticket.created_at} state={ticket.state} slaDeadline={ticket.sla_deadline} />
                      </td>
                      <td className="w-20 px-3 py-3 text-xs text-gray-400 whitespace-nowrap">
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
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <span className="text-xs text-gray-400">{page} / {totalPages} 페이지</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 text-xs border rounded text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
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
                        pageNum === page ? 'bg-blue-600 text-white font-medium' : 'border text-gray-600 hover:bg-white'
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 text-xs border rounded text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
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
    <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 rounded-full px-2.5 py-0.5 font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 font-bold leading-none ml-0.5">×</button>
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
