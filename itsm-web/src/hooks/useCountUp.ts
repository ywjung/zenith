'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 숫자가 변경되면 0(또는 직전값) → target으로 부드럽게 카운트업.
 *
 * 사용 예:
 *   const count = useCountUp(stats.total, 800)
 *   <span>{count}</span>
 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === value) return
    fromRef.current = value
    const start = performance.now()
    const from = fromRef.current
    const delta = target - from

    function tick(now: number) {
      const elapsed = now - start
      const t = Math.min(1, elapsed / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + delta * eased)
      setValue(next)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return value
}
