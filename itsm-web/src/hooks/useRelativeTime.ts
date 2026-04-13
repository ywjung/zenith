'use client'

import { useEffect, useState } from 'react'

/**
 * ISO 시간을 한국어 상대 시간 문자열로 변환하고, 60초마다 자동 갱신.
 * 탭이 비활성일 때는 갱신을 멈추고 visible 시점에 다시 갱신.
 *
 * 예) useRelativeTime('2026-04-10T05:00:00Z') → "방금 전" → "1분 전" → "2분 전" ...
 */
export function useRelativeTime(iso?: string | null): string {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!iso) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => setTick((t) => t + 1), 60_000)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else { setTick((t) => t + 1); start() }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [iso])

  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 5) return '방금 전'
  if (diffSec < 60) return `${diffSec}초 전`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}시간 전`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}일 전`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전`
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}개월 전`
  return `${Math.floor(diffDay / 365)}년 전`
}
