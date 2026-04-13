'use client'

import { useCountUp } from '@/hooks/useCountUp'

/**
 * 숫자를 0(또는 직전값) → value로 부드럽게 카운트업.
 * 대시보드 통계 등에 적용.
 */
export default function CountUp({
  value,
  duration = 700,
  className = '',
}: {
  value: number
  duration?: number
  className?: string
}) {
  const display = useCountUp(value, duration)
  return <span className={className}>{display.toLocaleString()}</span>
}
