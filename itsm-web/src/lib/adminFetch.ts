import { API_BASE } from './constants'

/**
 * 관리자 페이지 공통 fetch 헬퍼.
 *
 * 기존 9개 admin 페이지에 중복되어 있던 apiFetch 구현을 통합한다.
 * - credentials: 'include' 자동 적용
 * - Content-Type: application/json 기본값
 * - 204 응답 → null
 * - 비-OK 응답 → Error (응답의 detail 우선, 없으면 HTTP {status})
 * - cache: 'no-store' (관리자 UI는 항상 최신 데이터 필요)
 */
// 기본 반환형을 any로 두어 기존 호출부의 암묵적 타입 추론을 유지.
// 타입 안정성이 필요한 호출부는 adminFetch<MyType>(...)로 명시.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function adminFetch<T = any>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  if (res.status === 204) return null as T
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}
