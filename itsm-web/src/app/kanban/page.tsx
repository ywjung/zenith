'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult, DragStart } from '@hello-pangea/dnd'
import { fetchTickets, updateTicket, fetchProjects } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import type { Ticket, GitLabProject } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import Link from 'next/link'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { useTranslations } from 'next-intl'

const COLUMNS: { id: string; label: string; bg: string; header: string; accent: string; wip: number }[] = [
  { id: 'open',              label: '접수됨',       bg: 'bg-gray-50 dark:bg-gray-800/60',      header: 'bg-gray-100 dark:bg-gray-700/80',       accent: 'bg-gray-400',   wip: 20 },
  { id: 'approved',          label: '승인완료',     bg: 'bg-teal-50 dark:bg-teal-900/20',      header: 'bg-teal-50 dark:bg-teal-900/40',        accent: 'bg-teal-500',   wip: 10 },
  { id: 'in_progress',       label: '처리 중',      bg: 'bg-blue-50 dark:bg-blue-900/20',      header: 'bg-blue-50 dark:bg-blue-900/40',        accent: 'bg-blue-500',   wip: 10 },
  { id: 'waiting',           label: '추가정보 대기', bg: 'bg-yellow-50 dark:bg-yellow-900/20',  header: 'bg-yellow-50 dark:bg-yellow-900/40',    accent: 'bg-yellow-500', wip: 10 },
  { id: 'resolved',          label: '처리 완료',    bg: 'bg-green-50 dark:bg-green-900/20',    header: 'bg-green-50 dark:bg-green-900/40',      accent: 'bg-green-500',  wip: 30 },
  { id: 'testing',           label: '테스트중',     bg: 'bg-violet-50 dark:bg-violet-900/20',  header: 'bg-violet-50 dark:bg-violet-900/40',    accent: 'bg-violet-500', wip: 10 },
  { id: 'ready_for_release', label: '운영배포전',   bg: 'bg-amber-50 dark:bg-amber-900/20',    header: 'bg-amber-50 dark:bg-amber-900/40',      accent: 'bg-amber-500',  wip: 20 },
  { id: 'released',          label: '운영반영완료', bg: 'bg-indigo-50 dark:bg-indigo-900/20',  header: 'bg-indigo-50 dark:bg-indigo-900/40',    accent: 'bg-indigo-500', wip: 20 },
  { id: 'closed',            label: '종료됨',       bg: 'bg-slate-50 dark:bg-slate-800/50',    header: 'bg-slate-100 dark:bg-slate-700/60',     accent: 'bg-slate-400',  wip: 50 },
]

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  open:              new Set(['approved', 'in_progress', 'waiting', 'closed']),
  approved:          new Set(['in_progress', 'waiting', 'closed']),
  in_progress:       new Set(['resolved', 'waiting', 'closed']),
  waiting:           new Set(['in_progress', 'approved', 'closed']),
  resolved:          new Set(['testing', 'in_progress', 'ready_for_release', 'closed']),
  testing:           new Set(['ready_for_release', 'in_progress', 'closed']),
  ready_for_release: new Set(['released', 'in_progress', 'closed']),
  released:          new Set(['closed']),
  closed:            new Set(['open']),
}

const PRIORITY_BORDER: Record<string, string> = {
  critical: 'border-l-red-500',
  high:     'border-l-orange-400',
  medium:   'border-l-yellow-400',
  low:      'border-l-gray-300 dark:border-l-gray-600',
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  high:     'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  medium:   'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  low:      'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300 dark:bg-gray-500',
}

function buildOrders(ts: Ticket[]): Record<string, number[]> {
  const map: Record<string, number[]> = {}
  for (const col of COLUMNS) map[col.id] = []
  for (const t of ts) {
    const s = t.state === 'closed' ? 'closed' : (t.status || 'open')
    ;(map[s] ?? map['open']).push(t.iid)
  }
  return map
}

function getInitials(name?: string): string {
  if (!name) return '?'
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function getSLAStatus(t: Ticket): 'breached' | 'warning' | 'ok' | null {
  if (!t.sla_deadline) return null
  if (t.sla_breached) return 'breached'
  const remaining = new Date(t.sla_deadline).getTime() - Date.now()
  if (remaining < 0) return 'breached'
  return remaining < 2 * 3600_000 ? 'warning' : 'ok'
}

function formatSLATime(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now()
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600_000)
  const m = Math.floor((abs % 3600_000) / 60_000)
  const sign = diff < 0 ? '+' : ''
  if (h >= 24) return `${sign}${Math.floor(h / 24)}d ${h % 24}h`
  return `${sign}${h}h ${m}m`
}

const CLOSED_PREVIEW = 10

/** 100개 제한을 넘는 프로젝트를 위해 페이지네이션으로 전체 티켓을 로드한다. */
async function fetchAllKanbanTickets(projectId?: string): Promise<Ticket[]> {
  const all: Ticket[] = []
  let page = 1
  while (true) {
    const res = await fetchTickets({ project_id: projectId, page, per_page: 100 })
    all.push(...res.tickets)
    if (all.length >= res.total || res.tickets.length < 100) break
    page++
    if (page > 30) break // 안전 상한: 최대 3000건
  }
  return all
}

function KanbanContent() {
  const tr = useTranslations()
  const { getEmoji, getLabel } = useServiceTypes()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPeriod, setFilterPeriod] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const initializedRef = useRef(false)
  const prevProjectRef = useRef('')
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)
  const [colOrders, setColOrders] = useState<Record<string, number[]>>({})
  const [draggingFromCol, setDraggingFromCol] = useState<string | null>(null)
  const [closedExpanded, setClosedExpanded] = useState(false)
  const [closedCollapsed, setClosedCollapsed] = useState(false)
  const [pendingDrop, setPendingDrop] = useState<{ iid: number; srcCol: string; dstCol: string; newSrcOrder: number[]; newDstOrder: number[] } | null>(null)
  const [changeReason, setChangeReason] = useState('')
  const [syncFailed, setSyncFailed] = useState(false)
  const REASON_REQUIRED = new Set(['waiting', 'reopened'])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await fetchAllKanbanTickets(selectedProject || undefined)
      setTickets(all)
      setColOrders(buildOrders(all))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tr('kanban.load_error'))
    } finally {
      setLoading(false)
    }
  }, [selectedProject])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    const init = async () => {
      const [projResult, ticketResult] = await Promise.allSettled([
        fetchProjects(),
        fetchAllKanbanTickets(),
      ])
      if (projResult.status === 'fulfilled' && projResult.value.length > 0) {
        setProjects(projResult.value)
        setSelectedProject(projResult.value[0].id)
      }
      if (ticketResult.status === 'fulfilled') {
        setTickets(ticketResult.value)
        setColOrders(buildOrders(ticketResult.value))
      }
      setLoading(false)
    }
    init().catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initializedRef.current || selectedProject === '') return
    const prev = prevProjectRef.current
    prevProjectRef.current = selectedProject
    if (prev === '') return
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

  useEffect(() => () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }, [])

  // 필터 변경 시 종료됨 컬럼 펼침 상태 초기화
  useEffect(() => { setClosedExpanded(false) }, [filterPriority, filterAssignee, filterPeriod, filterSearch])

  const filtered = useMemo(() => {
    const now = Date.now()
    const periodMs: Record<string, number> = {
      today: 24 * 3600_000,
      week: 7 * 24 * 3600_000,
      month: 30 * 24 * 3600_000,
    }
    const search = filterSearch.trim().toLowerCase()
    return tickets.filter(t => {
      if (filterPriority && t.priority !== filterPriority) return false
      if (filterAssignee && t.assignee_name !== filterAssignee) return false
      if (filterPeriod && periodMs[filterPeriod]) {
        const age = now - new Date(t.created_at).getTime()
        if (age > periodMs[filterPeriod]) return false
      }
      if (search && !t.title.toLowerCase().includes(search) && !String(t.iid).includes(search)) return false
      return true
    })
  }, [tickets, filterPriority, filterAssignee, filterPeriod, filterSearch])

  const ticketMap = useMemo(() => {
    const m: Record<number, Ticket> = {}
    for (const t of filtered) m[t.iid] = t
    return m
  }, [filtered])

  const getColTickets = useCallback((colId: string): Ticket[] => {
    const order = colOrders[colId] || []
    const result: Ticket[] = []
    for (const iid of order) {
      const t = ticketMap[iid]
      if (t) result.push(t)
    }
    return result
  }, [colOrders, ticketMap])

  const onDragStart = (start: DragStart) => {
    // start.source.droppableId는 드래그 라이브러리가 실제 시각적 위치에서 주는 값이므로
    // ticket.status(서버 데이터, 백그라운드 싱크로 stale해질 수 있음)보다 신뢰할 수 있다.
    setDraggingFromCol(start.source.droppableId)
    setDragError(null)
  }

  const onDragEnd = async (result: DropResult) => {
    setDraggingFromCol(null)
    if (!result.destination) return
    const { source, destination, draggableId } = result
    const iid = parseInt(draggableId, 10)
    const srcCol = source.droppableId
    const dstCol = destination.droppableId

    if (srcCol === dstCol) {
      if (source.index === destination.index) return
      const visibleIids = getColTickets(srcCol).map(t => t.iid)
      const newVisibleIids = [...visibleIids]
      newVisibleIids.splice(source.index, 1)
      newVisibleIids.splice(destination.index, 0, iid)
      const fullOrder = colOrders[srcCol] || []
      const visibleSet = new Set(visibleIids)
      const slotsInFull = fullOrder.reduce<number[]>((acc, id, idx) => {
        if (visibleSet.has(id)) acc.push(idx)
        return acc
      }, [])
      const newFullOrder = [...fullOrder]
      slotsInFull.forEach((fullIdx, pos) => {
        newFullOrder[fullIdx] = newVisibleIids[pos]
      })
      setColOrders(prev => ({ ...prev, [srcCol]: newFullOrder }))
      return
    }

    const newStatus = dstCol
    const visibleDstIids = getColTickets(dstCol).map(t => t.iid)
    const fullDstOrder = colOrders[dstCol] || []

    let insertAt: number
    if (destination.index === 0) {
      insertAt = visibleDstIids.length > 0
        ? Math.max(0, fullDstOrder.indexOf(visibleDstIids[0]))
        : 0
    } else {
      const prevIid = visibleDstIids[destination.index - 1]
      insertAt = fullDstOrder.indexOf(prevIid) + 1
    }

    const newSrcOrder = (colOrders[srcCol] || []).filter(id => id !== iid)
    const newDstOrder = [...fullDstOrder]
    newDstOrder.splice(insertAt, 0, iid)

    // closed → open 컬럼 이동은 백엔드에서 'reopened'로 처리해야 함
    const apiStatus = srcCol === 'closed' && dstCol === 'open' ? 'reopened' : newStatus

    if (REASON_REQUIRED.has(apiStatus)) {
      setPendingDrop({ iid, srcCol, dstCol: newStatus, newSrcOrder, newDstOrder })
      setChangeReason('')
      return
    }

    setTickets(prev => prev.map(t =>
      t.iid === iid
        ? { ...t, status: newStatus, state: newStatus === 'closed' ? 'closed' : 'opened' }
        : t
    ))
    setColOrders(prev => ({ ...prev, [srcCol]: newSrcOrder, [dstCol]: newDstOrder }))

    try {
      await updateTicket(iid, { status: apiStatus }, selectedProject || undefined)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(async () => {
        try {
          const refreshed = await fetchAllKanbanTickets(selectedProject || undefined)
          setSyncFailed(false)
          setTickets(refreshed)
          setColOrders(prev => {
            const serverOrders = buildOrders(refreshed)
            const merged: Record<string, number[]> = {}
            for (const col of Object.keys(prev)) {
              merged[col] = [...prev[col]]
            }
            const serverIds = new Set(refreshed.map((t: { iid: number }) => t.iid))
            // 서버에 없는 티켓 제거
            for (const col of Object.keys(merged)) {
              merged[col] = merged[col].filter(id => serverIds.has(id))
            }
            // 이미 어느 컬럼에든 배치된 티켓 집합 계산
            const alreadyPlaced = new Set(Object.values(merged).flat())
            // 서버에서 새로 알게 된 티켓만 추가 (이미 배치된 티켓은 위치 유지)
            for (const col of Object.keys(serverOrders)) {
              const newIds = (serverOrders[col] || []).filter((id: number) => !alreadyPlaced.has(id))
              if (newIds.length > 0) {
                merged[col] = [...(merged[col] || []), ...newIds]
                for (const id of newIds) alreadyPlaced.add(id)
              }
            }
            return merged
          })
        } catch {
          setSyncFailed(true)
        }
      }, 2000)
    } catch (err) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      await load()
      const msg = err instanceof Error && err.message ? err.message : '상태 변경에 실패했습니다.'
      setDragError(msg)
    }
  }

  const confirmPendingDrop = async () => {
    if (!pendingDrop || !changeReason.trim()) return
    const { iid, srcCol, dstCol, newSrcOrder, newDstOrder } = pendingDrop
    setPendingDrop(null)

    setTickets(prev => prev.map(t =>
      t.iid === iid
        ? { ...t, status: dstCol, state: dstCol === 'closed' ? 'closed' : 'opened' }
        : t
    ))
    setColOrders(prev => ({ ...prev, [srcCol]: newSrcOrder, [dstCol]: newDstOrder }))

    try {
      const apiStatus = srcCol === 'closed' && dstCol === 'open' ? 'reopened' : dstCol
      await updateTicket(iid, { status: apiStatus, change_reason: changeReason }, selectedProject || undefined)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => { load().catch(() => setSyncFailed(true)) }, 2000)
    } catch (err) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      await load()
      setDragError(err instanceof Error ? err.message : '상태 변경에 실패했습니다.')
    }
    setChangeReason('')
  }

  const assignees = useMemo(
    () => Array.from(new Set(tickets.map(t => t.assignee_name).filter((n): n is string => !!n))),
    [tickets]
  )

  const hasFilter = !!(filterPriority || filterAssignee || filterPeriod || filterSearch)

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5 mr-1">
          <svg className="w-4 h-4 text-violet-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          칸반 보드
        </h1>

        <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 shrink-0" />

        {/* Search input */}
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            placeholder="티켓 검색…"
            className="pl-7 pr-3 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700/60 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-400 w-36 focus:w-48 transition-all"
          />
        </div>

        {projects.length > 1 && (
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700/60 focus:outline-none focus:ring-1 focus:ring-violet-400"
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 ${
            filterPriority
              ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
              : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-300'
          }`}
        >
          <option value="">{tr('kanban.all_priority')}</option>
          <option value="critical">{tr('ticket.priority.critical')}</option>
          <option value="high">{tr('ticket.priority.high')}</option>
          <option value="medium">{tr('ticket.priority.medium')}</option>
          <option value="low">{tr('ticket.priority.low')}</option>
        </select>

        {assignees.length > 0 && (
          <select
            value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}
            className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 ${
              filterAssignee
                ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-300'
            }`}
          >
            <option value="">{tr('kanban.all_assignees')}</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        <select
          value={filterPeriod}
          onChange={e => setFilterPeriod(e.target.value)}
          className={`border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 ${
            filterPeriod
              ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
              : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/60 text-gray-700 dark:text-gray-300'
          }`}
        >
          <option value="">{tr('kanban.all_period')}</option>
          <option value="today">{tr('kanban.period_today')}</option>
          <option value="week">{tr('kanban.period_week')}</option>
          <option value="month">{tr('kanban.period_month')}</option>
        </select>

        {hasFilter && (
          <button
            onClick={() => { setFilterPriority(''); setFilterAssignee(''); setFilterPeriod(''); setFilterSearch('') }}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            초기화
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {syncFailed && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-2 py-0.5 rounded-md">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              동기화 실패
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{filtered.length}건</span>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            title="새로고침"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            목록
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex-none px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">{error}</div>
      )}

      {dragError && (
        <div className="flex-none flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="flex-1">{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="text-amber-500 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
            aria-label="닫기"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 이유 입력 모달 */}
      {pendingDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-9 h-9 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  상태 전환 이유 입력
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  <span className="font-medium text-yellow-600 dark:text-yellow-400">
                    {pendingDrop.dstCol === 'waiting' ? '추가정보 대기' : '재오픈'}
                  </span> 상태로 전환하려면 이유를 입력해야 합니다.
                </p>
              </div>
            </div>
            <textarea
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:focus:ring-yellow-500 placeholder-gray-400"
              rows={3}
              placeholder="이유를 입력하세요…"
              value={changeReason}
              onChange={e => setChangeReason(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { setPendingDrop(null); setChangeReason('') }}
                className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmPendingDrop}
                disabled={!changeReason.trim()}
                className="px-4 py-1.5 text-sm rounded-lg bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 px-3 py-3 overflow-x-auto">
        {loading ? (
          <div className="grid grid-cols-9 gap-2 h-full min-w-[1440px]">
            {COLUMNS.map(col => (
              <div key={col.id} className="flex flex-col rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm animate-pulse">
                <div className="h-1 bg-gray-200 dark:bg-gray-600" />
                <div className="h-10 bg-gray-100 dark:bg-gray-700/80 shrink-0 px-3 flex items-center gap-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-16" />
                  <div className="ml-auto h-5 w-7 bg-gray-200 dark:bg-gray-600 rounded-full" />
                </div>
                <div className="flex-1 bg-gray-50 dark:bg-gray-800/60 p-2 space-y-2">
                  {[1, 2, 3].map(j => (
                    <div key={j} className="bg-white dark:bg-gray-700 rounded-lg p-3 space-y-2 border border-gray-100 dark:border-gray-600">
                      <div className="h-2.5 bg-gray-200 dark:bg-gray-600 rounded w-full" />
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-600/60 rounded w-3/4" />
                      <div className="flex gap-1.5 mt-1">
                        <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded-full w-12" />
                        <div className="h-4 bg-gray-100 dark:bg-gray-600/60 rounded-full w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-9 gap-2 h-full min-w-[1440px]">
              {COLUMNS.map(col => {
                const allColTickets = getColTickets(col.id)
                const isClosed = col.id === 'closed'

                const colTickets = isClosed && !closedExpanded
                  ? allColTickets.slice(0, CLOSED_PREVIEW)
                  : allColTickets
                const hiddenCount = isClosed ? allColTickets.length - CLOSED_PREVIEW : 0

                const overWip = allColTickets.length > col.wip
                const wipPct = Math.min(100, Math.round((allColTickets.length / col.wip) * 100))

                const isDisabled = draggingFromCol !== null
                  && draggingFromCol !== col.id
                  && !(VALID_TRANSITIONS[draggingFromCol]?.has(col.id))

                const isValidTarget = draggingFromCol !== null
                  && draggingFromCol !== col.id
                  && VALID_TRANSITIONS[draggingFromCol]?.has(col.id)

                if (isClosed && closedCollapsed) {
                  return (
                    <div key={col.id} className="flex flex-col min-h-0 rounded-xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => setClosedCollapsed(false)}
                        className={`flex-none flex flex-col items-center justify-center gap-1.5 px-2 py-3 h-full ${col.header} hover:opacity-80 transition-opacity`}
                        title="종료됨 컬럼 펼치기"
                      >
                        <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">{tr(`kanban.col_${col.id}`)}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/70 dark:bg-black/30 text-gray-700 dark:text-gray-200">
                          {allColTickets.length}
                        </span>
                        <svg className="w-3 h-3 text-gray-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )
                }

                return (
                  <div
                    key={col.id}
                    className={`flex flex-col min-h-0 rounded-xl overflow-hidden shadow-sm border transition-all ${
                      isDisabled
                        ? 'border-gray-200 dark:border-gray-700 opacity-35'
                        : isValidTarget
                          ? 'border-green-400 dark:border-green-500 ring-1 ring-green-300 dark:ring-green-600'
                          : overWip
                            ? 'border-red-400 dark:border-red-500'
                            : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    {/* WIP accent bar */}
                    <div className="h-1 shrink-0 bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div
                        className={`h-full transition-all ${overWip ? 'bg-red-500' : col.accent}`}
                        style={{ width: `${wipPct}%` }}
                      />
                    </div>

                    {/* Column header */}
                    <div className={`flex-none flex items-center justify-between px-3 py-2 ${col.header}`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 tracking-wide truncate">
                          {tr(`kanban.col_${col.id}`)}
                        </span>
                        {isDisabled && (
                          <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-400 dark:text-red-500 bg-red-50 dark:bg-red-900/30 px-1 py-0.5 rounded shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            이동 불가
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                          overWip
                            ? 'bg-red-500 text-white'
                            : 'bg-white/70 dark:bg-black/25 text-gray-600 dark:text-gray-300'
                        }`}>
                          {allColTickets.length}
                          {overWip && <span className="ml-0.5 text-[9px]">!</span>}
                        </span>
                        {isClosed && (
                          <button
                            onClick={() => setClosedCollapsed(true)}
                            className="ml-0.5 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/10 transition-colors"
                            title="컬럼 접기"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Scrollable area */}
                    <Droppable droppableId={col.id} isDropDisabled={isDisabled}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 overflow-y-auto p-2 transition-colors ${col.bg} ${
                            isDisabled
                              ? 'cursor-not-allowed'
                              : snapshot.isDraggingOver
                                ? 'ring-2 ring-inset ring-blue-300 dark:ring-blue-500 !bg-blue-50/70 dark:!bg-blue-900/30'
                                : ''
                          }`}
                        >
                          {colTickets.length === 0 && !snapshot.isDraggingOver && (
                            <div className="flex flex-col items-center justify-center py-10 gap-1.5">
                              <div className={`w-8 h-8 rounded-full ${col.header} flex items-center justify-center opacity-60`}>
                                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                              </div>
                              <span className="text-[11px] text-gray-400 dark:text-gray-600">비어 있음</span>
                            </div>
                          )}

                          {colTickets.map((ticket, index) => {
                            const sla = getSLAStatus(ticket)
                            const priority = ticket.priority || 'medium'
                            const serviceEmoji = ticket.category ? getEmoji(ticket.category) : null
                            const serviceLabel = ticket.category ? getLabel(ticket.category) : null
                            return (
                              <Draggable key={ticket.iid} draggableId={String(ticket.iid)} index={index}>
                                {(prov, snap) => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.draggableProps}
                                    {...prov.dragHandleProps}
                                    className={`mb-2 rounded-lg border-l-4 ${
                                      PRIORITY_BORDER[priority] ?? 'border-l-gray-300 dark:border-l-gray-600'
                                    } transition-shadow cursor-grab active:cursor-grabbing select-none ${
                                      sla === 'breached'
                                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700'
                                        : sla === 'warning'
                                          ? 'bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-700'
                                          : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/60'
                                    } ${
                                      snap.isDragging
                                        ? 'shadow-xl rotate-1 opacity-95 border-blue-300 dark:border-blue-600'
                                        : 'hover:shadow-md dark:hover:shadow-gray-900/50 hover:border-gray-300 dark:hover:border-gray-600'
                                    }`}
                                  >
                                    <div className="p-2.5">
                                      <Link href={`/tickets/${ticket.iid}`} onClick={e => snap.isDragging && e.preventDefault()}>
                                        <div className="flex items-start gap-1.5 mb-1">
                                          <div className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${PRIORITY_DOT[priority] ?? 'bg-gray-300'}`} />
                                          <div className="min-w-0">
                                            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono leading-none mb-0.5">#{ticket.iid}</p>
                                            <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200 line-clamp-2 hover:text-blue-600 dark:hover:text-blue-400 leading-snug">
                                              {ticket.title}
                                            </p>
                                          </div>
                                        </div>
                                      </Link>

                                      {/* Badges */}
                                      <div className="flex flex-wrap gap-1 mb-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[priority] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                          {((): string => { try { return tr(`ticket.priority.${priority}`) } catch { return priority } })()}
                                        </span>
                                        {serviceLabel && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium">
                                            {serviceEmoji && <span className="mr-0.5">{serviceEmoji}</span>}{serviceLabel}
                                          </span>
                                        )}
                                      </div>

                                      {/* Footer: SLA + age + avatar */}
                                      <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1 min-w-0 flex-wrap">
                                          {sla && ticket.sla_deadline && (
                                            <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
                                              sla === 'breached' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' :
                                              sla === 'warning'  ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' :
                                                                   'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                            }`}>
                                              {sla === 'breached'
                                                ? <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                                                : <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                              }
                                              {formatSLATime(ticket.sla_deadline)}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{formatDate(ticket.created_at)}</span>
                                        </div>
                                        <span
                                          className={`shrink-0 w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center leading-none ${
                                            ticket.assignee_name ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                                          }`}
                                          title={ticket.assignee_name ?? '미배정'}
                                        >
                                          {getInitials(ticket.assignee_name)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </Draggable>
                            )
                          })}
                          {provided.placeholder}

                          {/* 종료됨 컬럼 더보기 / 접기 */}
                          {isClosed && allColTickets.length > CLOSED_PREVIEW && (
                            <button
                              onClick={() => setClosedExpanded(e => !e)}
                              className="w-full mt-1 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/50 rounded-lg transition-colors flex items-center justify-center gap-1"
                            >
                              <svg className={`w-3 h-3 transition-transform ${closedExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              {closedExpanded
                                ? tr('kanban.hide_closed', { count: CLOSED_PREVIEW })
                                : tr('kanban.show_closed', { count: hiddenCount })}
                            </button>
                          )}
                        </div>
                      )}
                    </Droppable>
                  </div>
                )
              })}
            </div>
          </DragDropContext>
        )}
      </div>
    </div>
  )
}

export default function KanbanPage() {
  return (
    <RequireAuth>
      <KanbanContent />
    </RequireAuth>
  )
}
