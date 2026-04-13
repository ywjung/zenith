'use client'

import { useEffect, useRef } from 'react'

/**
 * textarea가 내용에 맞춰 자동으로 높이를 조정하도록.
 *
 * 사용 예:
 *   const ref = useAutoResize<HTMLTextAreaElement>(value)
 *   <textarea ref={ref} value={value} onChange={...} />
 */
export function useAutoResize<T extends HTMLTextAreaElement>(value: string, maxHeight = 400) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, maxHeight])
  return ref
}
