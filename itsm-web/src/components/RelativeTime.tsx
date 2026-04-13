'use client'

import { useRelativeTime } from '@/hooks/useRelativeTime'

/**
 * 60초마다 자동 갱신되는 상대 시간 표시 컴포넌트.
 * title 속성에 절대 시간을 노출.
 */
export default function RelativeTime({
  iso,
  className = '',
}: {
  iso?: string | null
  className?: string
}) {
  const rel = useRelativeTime(iso)
  if (!iso) return null
  const abs = new Date(iso).toLocaleString('ko-KR')
  return (
    <time dateTime={iso} title={abs} className={className}>
      {rel}
    </time>
  )
}
