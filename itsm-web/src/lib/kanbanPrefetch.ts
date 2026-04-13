import { fetchKanbanBoard } from './api'
import type { Ticket } from '@/types'

const STALE_MS = 30_000  // 30초 — 백엔드 Redis SWR TTL과 동기화

type CachedResult = { tickets: Ticket[]; fetchedAt: number; projectId: string | undefined }

let _promise: Promise<CachedResult | null> | null = null
let _result: CachedResult | null = null

/** 로그인 직후 idle 시점에 호출. 칸반 페이지 진입 시 즉시 사용 가능하도록 미리 받아둔다. */
export function prefetchKanban(projectId?: string): void {
  // 동일 프로젝트의 신선한 결과가 있으면 재요청 안 함.
  if (_result && _result.projectId === projectId && Date.now() - _result.fetchedAt < STALE_MS) return
  if (_promise) return  // 이미 진행 중인 요청 있음
  _promise = fetchKanbanBoard({ project_id: projectId, limit: 2000 })
    .then(r => {
      _result = { tickets: r.tickets, fetchedAt: Date.now(), projectId }
      return _result
    })
    .catch(() => null)
    .finally(() => { _promise = null })
}

/** 칸반 페이지가 마운트될 때 호출. 신선한 캐시 또는 진행 중인 요청을 반환. */
export function consumeKanbanPrefetch(projectId?: string): Promise<Ticket[] | null> {
  if (_result && _result.projectId === projectId && Date.now() - _result.fetchedAt < STALE_MS) {
    const tickets = _result.tickets
    _result = null  // 단발성 — 다음 진입 시 새로 받음
    return Promise.resolve(tickets)
  }
  if (_promise) {
    return _promise.then(r => (r && r.projectId === projectId ? r.tickets : null))
  }
  return Promise.resolve(null)
}
