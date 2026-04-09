'use client'

import { useEffect, useState } from 'react'

/**
 * 값 변경을 지정된 ms만큼 지연시킨다.
 * 사용 예: 검색 입력에 300ms debounce
 *
 *   const [search, setSearch] = useState('')
 *   const debouncedSearch = useDebounce(search, 300)
 *   useEffect(() => { fetch(`/api?q=${debouncedSearch}`) }, [debouncedSearch])
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
