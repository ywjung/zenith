/**
 * 티켓별 "마지막 확인 시점"을 localStorage에 저장.
 * 이를 기반으로 "미읽" / "업데이트됨" 상태를 프론트엔드에서 판단.
 */

const KEY = 'ticket-read-state-v1'

interface ReadStateMap {
  [iid: number]: number // Unix timestamp ms
}

function load(): ReadStateMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(map: ReadStateMap) {
  try {
    // 최근 500건만 유지 (메모리 관리)
    const entries = Object.entries(map)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 500)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* quota */ }
}

/** 티켓을 "읽음" 처리 (현재 시점 기록) */
export function markTicketRead(iid: number): void {
  const map = load()
  map[iid] = Date.now()
  save(map)
}

/** 티켓의 마지막 확인 시점 반환 (없으면 0) */
export function getTicketReadTime(iid: number): number {
  return load()[iid] ?? 0
}

/** 티켓이 "미읽" 상태인지 (updated_at이 마지막 확인보다 나중) */
export function isTicketUnread(iid: number, updatedAt: string): boolean {
  const readTime = getTicketReadTime(iid)
  if (readTime === 0) return true // 한 번도 안 본 티켓
  const updateTime = new Date(updatedAt).getTime()
  return updateTime > readTime
}

/** 티켓이 "새로 생성"된 상태인지 (4시간 이내) */
export function isTicketNew(createdAt: string): boolean {
  const FOUR_HOURS = 4 * 60 * 60 * 1000
  return Date.now() - new Date(createdAt).getTime() < FOUR_HOURS
}
