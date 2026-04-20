'use client'

import { useEffect, useRef } from 'react'

/**
 * Escape 키를 누르면 `onClose`를 호출하는 공용 훅.
 *
 * - `enabled=false`면 리스너 미등록 (모달이 닫힌 상태에서 불필요한 바인딩 방지)
 * - 인라인 콜백(() => setOpen(false))을 그대로 넘겨도 매 렌더마다 리스너가 재등록되지 않도록
 *   최신 onClose를 ref로 유지 (effect 의존성에서 제외).
 * - IME 조합 중 Escape는 무시 (한/중/일 입력 취소 용도와 충돌 방지).
 *
 * 사용 예:
 *   useEscapeClose(open, () => setOpen(false))
 */
export function useEscapeClose(enabled: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return
      e.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])
}
