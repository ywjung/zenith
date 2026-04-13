/**
 * 즐겨찾기(별표) 티켓 — localStorage 기반 personal favorites.
 * 백엔드 API 필요 없음.
 */

const KEY = 'starred-tickets-v1'

function load(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as number[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function save(set: Set<number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(set)))
  } catch {
    // ignore quota
  }
}

export function isStarred(iid: number): boolean {
  return load().has(iid)
}

export function getStarredIds(): number[] {
  return Array.from(load()).sort((a, b) => b - a)
}

export function toggleStar(iid: number): boolean {
  const set = load()
  if (set.has(iid)) {
    set.delete(iid)
    save(set)
    // 변경 이벤트 발행 (다른 컴포넌트가 동기화 가능)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('starred-tickets:change'))
    }
    return false
  }
  set.add(iid)
  save(set)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('starred-tickets:change'))
  }
  return true
}
