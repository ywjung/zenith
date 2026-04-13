/**
 * 최근 본 티켓을 localStorage에 저장/조회.
 * 최대 5개, LRU 방식.
 */

const KEY = 'recent-tickets-v1'
const MAX = 5

export interface RecentTicket {
  iid: number
  title: string
  status?: string
  visited_at: number
  project_id?: number | string | null
}

export function getRecentTickets(): RecentTicket[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as RecentTicket[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function pushRecentTicket(t: Omit<RecentTicket, 'visited_at'>): void {
  if (typeof window === 'undefined') return
  try {
    const list = getRecentTickets()
    const filtered = list.filter((x) => x.iid !== t.iid)
    const next: RecentTicket[] = [{ ...t, visited_at: Date.now() }, ...filtered].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore quota errors
  }
}

export function clearRecentTickets(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
