'use client'

import { useEffect, useState } from 'react'
import { fetchProjectCount } from '@/lib/api'

type CacheEntry = { count: number; ts: number }
const TTL_MS = 5 * 60 * 1000
let cache: CacheEntry | null = null
let inflight: Promise<number> | null = null

async function loadCount(): Promise<number> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.count
  if (inflight) return inflight
  inflight = fetchProjectCount()
    .then(r => {
      cache = { count: r.count, ts: Date.now() }
      return r.count
    })
    .catch(() => -1)
    .finally(() => { inflight = null })
  return inflight
}

/**
 * 활성 프로젝트 수를 반환한다. 미확정(-1 포함) 시 기본 표시를 유지하기 위해 null을 반환.
 * TTL 5분, 모듈 레벨 캐시 + inflight dedup.
 */
export function useProjectCount(enabled: boolean = true): number | null {
  const [count, setCount] = useState<number | null>(
    cache && Date.now() - cache.ts < TTL_MS ? cache.count : null
  )
  useEffect(() => {
    if (!enabled) return
    let cancel = false
    loadCount().then(c => {
      if (!cancel && c >= 0) setCount(c)
    })
    return () => { cancel = true }
  }, [enabled])
  return count
}
