'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'
import { API_BASE } from '@/lib/constants'
import { toast } from 'sonner'

/**
 * JWT 만료 2분 전 "세션 연장" 모달을 띄워 사용자가 작성 중 갑자기 로그아웃되는 상황 방지.
 *   - /auth/me의 exp를 읽어 남은 시간 계산
 *   - 2분 전: 모달 + 60s 카운트다운 후 자동 refresh 시도
 *   - refresh 성공 → exp 재조회, 실패 → /login?next=<현재경로>
 */
export default function SessionExpireWarning() {
  const { user } = useAuth()
  const [exp, setExp] = useState<number | null>(null)
  const [show, setShow] = useState(false)
  const [remaining, setRemaining] = useState(120)
  const refreshingRef = useRef(false)
  // 사용자가 "나중에"로 dismiss한 exp 값. 동일 exp에 대해선 재표시하지 않는다.
  // (exp가 갱신되면 다시 표시되도록 ref 값이 바뀐다 → 자연스럽게 재노출.)
  const dismissedExpRef = useRef<number | null>(null)

  // 최초 + 주기적으로 exp 조회 (10분 간격)
  const fetchExp = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include', cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (typeof data.exp === 'number') setExp(data.exp)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!user) return
    fetchExp()
    const id = setInterval(fetchExp, 600_000)
    return () => clearInterval(id)
  }, [user, fetchExp])

  // 1초마다 남은 시간 체크
  useEffect(() => {
    if (!exp) return
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      const left = exp - now
      // 이미 이 exp를 dismiss 한 경우엔 모달을 다시 열지 않는다.
      // (10초 이내 auto-extend는 별도 effect가 처리하므로 여기선 show만 억제.)
      if (left <= 120 && left > 0 && !refreshingRef.current && dismissedExpRef.current !== exp) {
        setShow(true)
        setRemaining(left)
      } else if (left <= 120 && left > 0 && dismissedExpRef.current === exp) {
        // dismiss 됐지만 remaining 값은 계속 업데이트해 auto-extend 타이머는 유효.
        setRemaining(left)
      } else if (left <= 0) {
        setShow(false)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [exp])

  const extend = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (res.ok) {
        toast.success('세션이 연장되었습니다.')
        setShow(false)
        dismissedExpRef.current = null  // 새 exp로 갱신되면 다시 표시 가능
        await fetchExp()
      } else {
        toast.error('세션 연장에 실패했습니다. 다시 로그인해주세요.')
      }
    } catch {
      toast.error('네트워크 오류로 세션 연장에 실패했습니다.')
    } finally {
      refreshingRef.current = false
    }
  }, [fetchExp])

  const dismiss = useCallback(() => {
    // 현재 exp 값을 기록해 두어 동일 세션에선 모달이 다시 뜨지 않게.
    dismissedExpRef.current = exp
    setShow(false)
  }, [exp])

  // 만료 10초 전 자동으로 연장 시도 (사용자가 나중에로 dismiss 했더라도
  // 완전히 로그아웃되는 것보다는 자동 연장을 시도하는 것이 UX 측면에서 낫다)
  useEffect(() => {
    if (remaining <= 10 && remaining > 0 && !refreshingRef.current && exp) extend()
  }, [remaining, exp, extend])

  if (!show || !user) return null

  const min = Math.floor(remaining / 60)
  const sec = remaining % 60

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">⏰</div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">세션이 곧 만료됩니다</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                {min}:{sec.toString().padStart(2, '0')}
              </span>
              {' '}후 자동 로그아웃됩니다.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            나중에
          </button>
          <button
            type="button"
            onClick={extend}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-md font-medium transition-all"
          >
            세션 연장
          </button>
        </div>
      </div>
    </div>
  )
}
