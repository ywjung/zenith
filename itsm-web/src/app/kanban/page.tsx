'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult, DragStart } from '@hello-pangea/dnd'
import { fetchTickets, updateTicket, fetchProjects } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import type { Ticket, GitLabProject } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import Link from 'next/link'
import { useServiceTypes } from '@/context/ServiceTypesContext'

const COLUMNS: { id: string; label: string; bg: string; header: string; wip: number }[] = [
  { id: 'open',              label: '접수됨',       bg: 'bg-gray-50 dark:bg-gray-800/60',    header: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200',     wip: 20 },
  { id: 'approved',          label: '승인완료',     bg: 'bg-teal-50 dark:bg-teal-900/20',    header: 'bg-teal-200 dark:bg-teal-800/60 text-teal-800 dark:text-teal-200',   wip: 10 },
  { id: 'in_progress',       label: '처리 중',      bg: 'bg-blue-50 dark:bg-blue-900/20',    header: 'bg-blue-200 dark:bg-blue-800/60 text-blue-800 dark:text-blue-200',   wip: 10 },
  { id: 'waiting',           label: '추가정보 대기', bg: 'bg-yellow-50 dark:bg-yellow-900/20', header: 'bg-yellow-200 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200', wip: 10 },
  { id: 'resolved',          label: '처리 완료',    bg: 'bg-green-50 dark:bg-green-900/20',  header: 'bg-green-200 dark:bg-green-800/60 text-green-800 dark:text-green-200', wip: 30 },
  { id: 'testing',           label: '테스트중',     bg: 'bg-violet-50 dark:bg-violet-900/20', header: 'bg-violet-200 dark:bg-violet-800/60 text-violet-800 dark:text-violet-200', wip: 10 },
  { id: 'ready_for_release', label: '운영배포전',   bg: 'bg-amber-50 dark:bg-amber-900/20',  header: 'bg-amber-200 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200', wip: 20 },
  { id: 'released',          label: '운영반영완료', bg: 'bg-indigo-50 dark:bg-indigo-900/20', header: 'bg-indigo-200 dark:bg-indigo-800/60 text-indigo-800 dark:text-indigo-200', wip: 20 },
  { id: 'closed',            label: '종료됨',       bg: 'bg-slate-50 dark:bg-slate-800/50',  header: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',  wip: 50 },
]

// 백엔드 VALID_TRANSITIONS와 동일 — 드래그 중 이동 불가 컬럼 사전 차단
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
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  high:     'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  medium:   'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  low:      'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
}

const PRIORITY_LABEL: Record<string, string> = {
  critical: '긴급', high: '높음', medium: '보통', low: '낮음',
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


const CLOSED_PREVIEW = 10 // 기본 미리보기 건수

function KanbanContent() {
  const { getEmoji, getLabel } = useServiceTypes()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const initializedRef = useRef(false)
  const prevProjectRef = useRef('')
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)
  const [colOrders, setColOrders] = useState<Record<string, number[]>>({})
  const [draggingFromCol, setDraggingFromCol] = useState<string | null>(null)
  const [closedExpanded, setClosedExpanded] = useState(false)
  const [closedCollapsed, setClosedCollapsed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchTickets({ project_id: selectedProject || undefined, per_page: 100 })
      setTickets(res.tickets)
      setColOrders(buildOrders(res.tickets))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
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
        fetchTickets({ per_page: 100 }),
      ])
      if (projResult.status === 'fulfilled' && projResult.value.length > 0) {
        setProjects(projResult.value)
        setSelectedProject(projResult.value[0].id)
      }
      if (ticketResult.status === 'fulfilled') {
        setTickets(ticketResult.value.tickets)
        setColOrders(buildOrders(ticketResult.value.tickets))
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

  // 언마운트 시 백그라운드 동기화 타이머 정리
  useEffect(() => () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }, [])

  const filtered = useMemo(() => tickets.filter(t => {
    if (filterPriority && t.priority !== filterPriority) return false
    if (filterAssignee && t.assignee_name !== filterAssignee) return false
    return true
  }), [tickets, filterPriority, filterAssignee])

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
    const iid = parseInt(start.draggableId, 10)
    const ticket = tickets.find(t => t.iid === iid)
    const col = ticket?.state === 'closed' ? 'closed' : (ticket?.status || 'open')
    setDraggingFromCol(col)
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

    setTickets(prev => prev.map(t =>
      t.iid === iid
        ? { ...t, status: newStatus, state: newStatus === 'closed' ? 'closed' : 'opened' }
        : t
    ))
    setColOrders(prev => ({ ...prev, [srcCol]: newSrcOrder, [dstCol]: newDstOrder }))

    try {
      await updateTicket(iid, { status: newStatus }, selectedProject || undefined)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetchTickets({ project_id: selectedProject || undefined, per_page: 100 })
          setTickets(res.tickets)
          setColOrders(prev => {
            const serverOrders = buildOrders(res.tickets)
            const merged: Record<string, number[]> = { ...prev }
            const serverIds = new Set(res.tickets.map((t: { iid: number }) => t.iid))
            for (const col of Object.keys(merged)) {
              merged[col] = merged[col].filter(id => serverIds.has(id))
            }
            for (const col of Object.keys(serverOrders)) {
              const existing = new Set(merged[col] || [])
              const newIds = (serverOrders[col] || []).filter((id: number) => !existing.has(id))
              if (newIds.length > 0) {
                merged[col] = [...(merged[col] || []), ...newIds]
              }
            }
            return merged
          })
        } catch {
          // 백그라운드 동기화 실패 — 무시
        }
      }, 2000)
    } catch (err) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      await load()
      let msg = '상태 변경에 실패했습니다.'
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message)
          msg = parsed.detail ?? msg
        } catch {
          msg = err.message || msg
        }
      }
      setDragError(msg)
    }
  }

  const assignees = useMemo(
    () => Array.from(new Set(tickets.map(t => t.assignee_name).filter((n): n is string => !!n))),
    [tickets]
  )

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">칸반 보드</h1>

        {projects.length > 1 && (
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700"
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <div className="w-px h-4 bg-gray-200 dark:bg-gray-600" />

        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="border dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700"
        >
          <option value="">모든 우선순위</option>
          <option value="critical">긴급</option>
          <option value="high">높음</option>
          <option value="medium">보통</option>
          <option value="low">낮음</option>
        </select>

        {assignees.length > 0 && (
          <select
            value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}
            className="border dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700"
          >
            <option value="">모든 담당자</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        {(filterPriority || filterAssignee) && (
          <button
            onClick={() => { setFilterPriority(''); setFilterAssignee('') }}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            필터 초기화
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">{filtered.length}건</span>
          <button
            onClick={load}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-base leading-none"
            title="새로고침"
          >
            ↻
          </button>
          <Link href="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">← 목록</Link>
        </div>
      </div>

      {error && (
        <div className="flex-none px-5 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">{error}</div>
      )}

      {dragError && (
        <div className="flex-none flex items-center gap-3 px-5 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <span className="text-base">⚠️</span>
          <span className="flex-1">{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="text-amber-500 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-bold text-base leading-none"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 px-4 py-4">
        {loading ? (
          <div className="grid grid-cols-9 gap-3 h-full">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex flex-col rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm animate-pulse">
                <div className="h-9 bg-gray-200 dark:bg-gray-700 shrink-0" />
                <div className="flex-1 bg-gray-50 dark:bg-gray-800/60 p-2 space-y-2">
                  {[1,2,3].map(j => (
                    <div key={j} className="bg-white dark:bg-gray-700 rounded-lg p-3 space-y-2 border border-gray-100 dark:border-gray-600">
                      <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-full" />
                      <div className="h-3 bg-gray-100 dark:bg-gray-600/60 rounded w-2/3" />
                      <div className="flex gap-1 mt-1">
                        <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded-full w-10" />
                        <div className="h-4 bg-gray-100 dark:bg-gray-600/60 rounded-full w-14" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-9 gap-3 h-full">
              {COLUMNS.map(col => {
                const allColTickets = getColTickets(col.id)
                const isClosed = col.id === 'closed'

                // 종료됨 컬럼: 접힘 상태이면 미리보기 건수만 노출
                const colTickets = isClosed && !closedExpanded
                  ? allColTickets.slice(0, CLOSED_PREVIEW)
                  : allColTickets
                const hiddenCount = isClosed ? allColTickets.length - CLOSED_PREVIEW : 0

                const overWip = allColTickets.length > col.wip

                const isDisabled = draggingFromCol !== null
                  && draggingFromCol !== col.id
                  && !(VALID_TRANSITIONS[draggingFromCol]?.has(col.id))

                // 종료됨 컬럼 — 접힘(collapsed) 상태: 세로로 축소해 공간 절약
                if (isClosed && closedCollapsed) {
                  return (
                    <div
                      key={col.id}
                      className="flex flex-col min-h-0 rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700"
                    >
                      <button
                        onClick={() => setClosedCollapsed(false)}
                        className={`flex-none flex flex-col items-center justify-center gap-1 px-2 py-3 h-full ${col.header} hover:opacity-80 transition-opacity`}
                        title="종료됨 컬럼 펼치기"
                      >
                        <span className="text-xs font-bold tracking-wide writing-mode-vertical">{col.label}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/20 mt-1">
                          {allColTickets.length}
                        </span>
                        <span className="text-[10px] opacity-60 mt-1">▶</span>
                      </button>
                    </div>
                  )
                }

                return (
                  <div
                    key={col.id}
                    className={`flex flex-col min-h-0 rounded-lg overflow-hidden shadow-sm border transition-opacity ${
                      isDisabled
                        ? 'border-gray-200 dark:border-gray-700 opacity-40'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    {/* Column header */}
                    <div className={`flex-none flex items-center justify-between px-3 py-2 ${col.header}`}>
                      <span className="text-xs font-bold tracking-wide">{col.label}</span>
                      <div className="flex items-center gap-1">
                        {isDisabled && (
                          <span className="text-[10px] text-gray-500 dark:text-gray-400" title="이 상태로 바로 이동할 수 없습니다">🚫</span>
                        )}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          overWip ? 'bg-red-500 text-white' : 'bg-white/60 dark:bg-black/20'
                        }`}>
                          {allColTickets.length}{overWip && ' ⚠'}
                        </span>
                        {/* 종료됨 컬럼 접기 버튼 */}
                        {isClosed && (
                          <button
                            onClick={() => setClosedCollapsed(true)}
                            className="ml-1 text-[10px] opacity-50 hover:opacity-100 transition-opacity"
                            title="컬럼 접기"
                          >
                            ◀
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
                                ? 'ring-2 ring-inset ring-blue-300 dark:ring-blue-500 !bg-blue-50/60 dark:!bg-blue-900/30'
                                : ''
                          }`}
                        >
                          {colTickets.length === 0 && !snapshot.isDraggingOver && (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-300 dark:text-gray-600 text-xs gap-1">
                              <span className="text-xl">⊙</span>
                              <span>비어 있음</span>
                            </div>
                          )}

                          {colTickets.map((ticket, index) => {
                            const sla = getSLAStatus(ticket)
                            const priority = ticket.priority || 'medium'
                            return (
                              <Draggable key={ticket.iid} draggableId={String(ticket.iid)} index={index}>
                                {(prov, snap) => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.draggableProps}
                                    {...prov.dragHandleProps}
                                    className={`mb-2 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 border-l-4 ${
                                      PRIORITY_BORDER[priority] ?? 'border-l-gray-300 dark:border-l-gray-600'
                                    } transition-shadow cursor-grab active:cursor-grabbing ${
                                      snap.isDragging
                                        ? 'shadow-xl rotate-1 opacity-95'
                                        : 'hover:shadow-md dark:hover:shadow-gray-900/50'
                                    }`}
                                  >
                                    <div className="p-2.5">
                                      {/* Ticket number + title */}
                                      <Link href={`/tickets/${ticket.iid}`}>
                                        <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mb-0.5">#{ticket.iid}</p>
                                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 line-clamp-2 hover:text-blue-600 dark:hover:text-blue-400 leading-snug">
                                          {ticket.title}
                                        </p>
                                      </Link>

                                      {/* Badges */}
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[priority] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                                          {PRIORITY_LABEL[priority] ?? priority}
                                        </span>
                                        {ticket.category && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium">
                                            {getEmoji(ticket.category)} {getLabel(ticket.category)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Footer: SLA + age + avatar */}
                                      <div className="mt-2 flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1 min-w-0">
                                          {sla && ticket.sla_deadline && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
                                              sla === 'breached' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
                                              sla === 'warning'  ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                                                                   'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                            }`}>
                                              {sla === 'breached' ? '⚠' : '⏱'} {formatSLATime(ticket.sla_deadline)}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{formatDate(ticket.created_at)}</span>
                                        </div>
                                        <span
                                          className={`flex-none w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                                            ticket.assignee_name ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
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
                              className="w-full mt-1 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors"
                            >
                              {closedExpanded
                                ? `▴ 최근 ${CLOSED_PREVIEW}건만 보기`
                                : `▾ +${hiddenCount}건 더 보기`}
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
