'use client'

import React from 'react'

/**
 * 검색어 매칭 부분을 <mark>로 하이라이트.
 * 정규식 메타문자 이스케이프 처리, case-insensitive.
 *
 * 사용 예: <HighlightMatch text={ticket.title} query={search} />
 */
export default function HighlightMatch({
  text,
  query,
  className = '',
}: {
  text: string
  query?: string
  className?: string
}) {
  if (!query?.trim() || !text) {
    return <span className={className}>{text}</span>
  }
  const q = query.trim()
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(re)
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded px-0.5">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </span>
  )
}
