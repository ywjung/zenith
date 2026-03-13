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
  { id: 'open',              label: '접수됨',       bg: 'bg-gray-50',    header: 'bg-gray-200 text-gray-700',     wip: 20 },
  { id: 'approved',          label: '승인완료',     bg: 'bg-teal-50',    header: 'bg-teal-200 text-teal-800',     wip: 10 },
  { id: 'in_progress',       label: '처리 중',      bg: 'bg-blue-50',    header: 'bg-blue-200 text-blue-800',     wip: 10 },
  { id: 'waiting',           label: '추가정보 대기', bg: 'bg-yellow-50',  header: 'bg-yellow-200 text-yellow-800', wip: 10 },
  { id: 'resolved',          label: '처리 완료',    bg: 'bg-green-50',   header: 'bg-green-200 text-green-800',   wip: 30 },
  { id: 'ready_for_release', label: '운영배포전',   bg: 'bg-amber-50',   header: 'bg-amber-200 text-amber-800',   wip: 20 },
  { id: 'released',          label: '운영반영완료', bg: 'bg-indigo-50',  header: 'bg-indigo-200 text-indigo-800', wip: 20 },
  { id: 'closed',            label: '종료됨',       bg: 'bg-slate-50',   header: 'bg-slate-200 text-slate-700',   wip: 50 },
]

// 백엔드 VALID_TRANSITIONS와 동일 — 드래그 중 이동 불가 컬럼 사전 차단
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  open:              new Set(['approved', 'in_progress', 'waiting', 'closed']),
  approved:          new Set(['in_progress', 'waiting', 'closed']),
  in_progress:       new Set(['resolved', 'waiting', 'closed']),
  waiting:           new Set(['in_progress', 'approved', 'closed']),
  resolved:          new Set(['in_progress', 'ready_for_release', 'closed']),
  ready_for_release: new Set(['released', 'in_progress', 'closed']),
  released:          new Set(['closed']),
  closed:            new Set(['open']),  // reopened → open으로 표시됨
}

const PRIORITY_BORDER: Record<string, string> = {
  critical: 'border-l-red-500',
  high:     'border-l-orange-400',
  medium:   'border-l-yellow-400',
  low:      'border-l-gray-300',
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-yellow-100 text-yellow-700',
  low:      'bg-gray-100 text-gray-500',
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
  if (remaining < 0) return 'breached'          // 마감 시간 초과
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
  const prevProjectRef = useRef('')  // 이전 프로젝트 ID 추적 (init 첫 설정 구분용)
  const [dragError, setDragError] = useState<string | null>(null)
  const [colOrders, setColOrders] = useState<Record<string, number[]>>({})
  const [draggingFromCol, setDraggingFromCol] = useState<string | null>(null)

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

  // 프로젝트 목록과 티켓을 병렬로 초기 로딩 (최초 1회)
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

  // 프로젝트 변경 시 티켓 재조회
  // - init에서 '' → 첫 프로젝트ID 로 설정되는 경우는 제외 (init이 이미 티켓을 로드했음)
  // - 사용자가 직접 드롭다운에서 다른 프로젝트를 선택할 때만 재조회
  useEffect(() => {
    if (!initializedRef.current || selectedProject === '') return
    const prev = prevProjectRef.current
    prevProjectRef.current = selectedProject
    if (prev === '') return  // init이 처음 세팅한 것 — 이미 병렬 fetch로 로드됨
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject])

  const filtered = useMemo(() => tickets.filter(t => {
    if (filterPriority && t.priority !== filterPriority) return false
    if (filterAssignee && t.assignee_name !== filterAssignee) return false
    return true
  }), [tickets, filterPriority, filterAssignee])

  // Map from iid → ticket for O(1) lookup (filtered only)
  const ticketMap = useMemo(() => {
    const m: Record<number, Ticket> = {}
    for (const t of filtered) m[t.iid] = t
    return m
  }, [filtered])

  // Returns tickets for a column in current drag order, respecting active filters
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
      // Same column: local reorder only — no API call
      const visibleIids = getColTickets(srcCol).map(t => t.iid)

      // Reorder the visible subset
      const newVisibleIids = [...visibleIids]
      newVisibleIids.splice(source.index, 1)
      newVisibleIids.splice(destination.index, 0, iid)

      // Rebuild full column order, preserving positions of non-visible (filtered-out) items
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

    // Cross-column: status change via API
    const newStatus = dstCol

    // Capture visible dest tickets BEFORE optimistic update to compute insertion point
    const visibleDstIids = getColTickets(dstCol).map(t => t.iid)
    const fullDstOrder = colOrders[dstCol] || []

    let insertAt: number
    if (destination.index === 0) {
      // Before the first visible item (or start of full list if column is empty)
      insertAt = visibleDstIids.length > 0
        ? Math.max(0, fullDstOrder.indexOf(visibleDstIids[0]))
        : 0
    } else {
      // After the (destination.index − 1)th visible item
      const prevIid = visibleDstIids[destination.index - 1]
      insertAt = fullDstOrder.indexOf(prevIid) + 1
    }

    const newSrcOrder = (colOrders[srcCol] || []).filter(id => id !== iid)
    const newDstOrder = [...fullDstOrder]
    newDstOrder.splice(insertAt, 0, iid)

    // Optimistic update
    setTickets(prev => prev.map(t =>
      t.iid === iid
        ? { ...t, status: newStatus, state: newStatus === 'closed' ? 'closed' : 'opened' }
        : t
    ))
    setColOrders(prev => ({ ...prev, [srcCol]: newSrcOrder, [dstCol]: newDstOrder }))

    try {
      await updateTicket(iid, { status: newStatus }, selectedProject || undefined)
      // 성공 후 2초 뒤 서버 상태와 조용히 동기화 (GitLab 레이블 전파 지연 대비)
      // setLoading 없이 백그라운드로만 갱신
      setTimeout(async () => {
        try {
          const res = await fetchTickets({ project_id: selectedProject || undefined, per_page: 100 })
          setTickets(res.tickets)
          // colOrders는 현재 드래그 순서를 유지하되, 서버에서 새 티켓이 추가된 경우만 반영
          setColOrders(prev => {
            const serverOrders = buildOrders(res.tickets)
            const merged: Record<string, number[]> = { ...prev }
            // 서버에서 사라진 티켓 제거, 새 티켓 추가
            const serverIds = new Set(res.tickets.map((t: { iid: number }) => t.iid))
            for (const col of Object.keys(merged)) {
              merged[col] = merged[col].filter(id => serverIds.has(id))
            }
            // 서버 orders에서 아직 없는 티켓 추가
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
      // 실패 시 즉시 서버 상태로 복원
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
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-gray-800">칸반 보드</h1>

        {projects.length > 1 && (
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="border rounded px-2 py-1 text-sm text-gray-700"
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <div className="w-px h-4 bg-gray-200" />

        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="border rounded px-2 py-1 text-sm text-gray-600"
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
            className="border rounded px-2 py-1 text-sm text-gray-600"
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
          <span className="text-xs text-gray-400">{filtered.length}건</span>
          <button
            onClick={load}
            className="text-gray-400 hover:text-gray-700 text-base leading-none"
            title="새로고침"
          >
            ↻
          </button>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-800">← 목록</Link>
        </div>
      </div>

      {error && (
        <div className="flex-none px-5 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}

      {dragError && (
        <div className="flex-none flex items-center gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
          <span className="text-base">⚠️</span>
          <span className="flex-1">{dragError}</span>
          <button
            onClick={() => setDragError(null)}
            className="text-amber-500 hover:text-amber-800 font-bold text-base leading-none"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 px-4 py-4">
        {loading ? (
          <div className="grid grid-cols-8 gap-3 h-full">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex flex-col rounded-lg overflow-hidden border border-gray-200 shadow-sm animate-pulse">
                <div className="h-9 bg-gray-200 shrink-0" />
                <div className="flex-1 bg-gray-50 p-2 space-y-2">
                  {[1,2,3].map(j => (
                    <div key={j} className="bg-white rounded-lg p-3 space-y-2 border border-gray-100">
                      <div className="h-3 bg-gray-200 rounded w-full" />
                      <div className="h-3 bg-gray-100 rounded w-2/3" />
                      <div className="flex gap-1 mt-1">
                        <div className="h-4 bg-gray-200 rounded-full w-10" />
                        <div className="h-4 bg-gray-100 rounded-full w-14" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid grid-cols-8 gap-3 h-full">
              {COLUMNS.map(col => {
                const colTickets = getColTickets(col.id)
                const overWip = colTickets.length > col.wip

                // 드래그 중: 현재 컬럼(같은 컬럼 재정렬)은 항상 허용
                // 다른 컬럼: VALID_TRANSITIONS에 없으면 비활성화
                const isDisabled = draggingFromCol !== null
                  && draggingFromCol !== col.id
                  && !(VALID_TRANSITIONS[draggingFromCol]?.has(col.id))

                return (
                  <div
                    key={col.id}
                    className={`flex flex-col min-h-0 rounded-lg overflow-hidden shadow-sm border transition-opacity ${
                      isDisabled ? 'border-gray-200 opacity-40' : 'border-gray-200'
                    }`}
                  >
                    {/* Column header */}
                    <div className={`flex-none flex items-center justify-between px-3 py-2 ${col.header}`}>
                      <span className="text-xs font-bold tracking-wide">{col.label}</span>
                      <div className="flex items-center gap-1">
                        {isDisabled && (
                          <span className="text-[10px] text-gray-500" title="이 상태로 바로 이동할 수 없습니다">🚫</span>
                        )}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          overWip ? 'bg-red-500 text-white' : 'bg-white/60'
                        }`}>
                          {colTickets.length}{overWip && ' ⚠'}
                        </span>
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
                              : snapshot.isDraggingOver ? 'ring-2 ring-inset ring-blue-300 bg-blue-50/60' : ''
                          }`}
                        >
                          {colTickets.length === 0 && !snapshot.isDraggingOver && (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-300 text-xs gap-1">
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
                                    className={`mb-2 bg-white rounded-md border border-gray-200 border-l-4 ${
                                      PRIORITY_BORDER[priority] ?? 'border-l-gray-300'
                                    } transition-shadow cursor-grab active:cursor-grabbing ${
                                      snap.isDragging
                                        ? 'shadow-xl rotate-1 opacity-95'
                                        : 'hover:shadow-md'
                                    }`}
                                  >
                                    <div className="p-2.5">
                                      {/* Ticket number + title */}
                                      <Link href={`/tickets/${ticket.iid}`}>
                                        <p className="text-[10px] text-gray-400 font-mono mb-0.5">#{ticket.iid}</p>
                                        <p className="text-sm font-medium text-gray-800 line-clamp-2 hover:text-blue-600 leading-snug">
                                          {ticket.title}
                                        </p>
                                      </Link>

                                      {/* Badges */}
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[priority] ?? 'bg-gray-100 text-gray-500'}`}>
                                          {PRIORITY_LABEL[priority] ?? priority}
                                        </span>
                                        {ticket.category && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                                            {getEmoji(ticket.category)} {getLabel(ticket.category)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Footer: SLA + age + avatar */}
                                      <div className="mt-2 flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1 min-w-0">
                                          {sla && ticket.sla_deadline && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
                                              sla === 'breached' ? 'bg-red-100 text-red-600' :
                                              sla === 'warning'  ? 'bg-yellow-100 text-yellow-700' :
                                                                   'bg-green-100 text-green-700'
                                            }`}>
                                              {sla === 'breached' ? '⚠' : '⏱'} {formatSLATime(ticket.sla_deadline)}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-gray-400 truncate">{formatDate(ticket.created_at)}</span>
                                        </div>
                                        <span
                                          className={`flex-none w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                                            ticket.assignee_name ? 'bg-blue-500' : 'bg-gray-300'
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
