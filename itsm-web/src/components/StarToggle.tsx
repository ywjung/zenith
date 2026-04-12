'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { isStarred, toggleStar } from '@/lib/starredTickets'

/**
 * 티켓 즐겨찾기 별표 토글 버튼.
 * localStorage 기반 — 같은 브라우저 내 동기화 (custom event).
 */
export default function StarToggle({ iid, size = 'md' }: { iid: number; size?: 'sm' | 'md' }) {
  const t = useTranslations('common')
  const [starred, setStarred] = useState(false)

  useEffect(() => {
    setStarred(isStarred(iid))
    const onChange = () => setStarred(isStarred(iid))
    window.addEventListener('starred-tickets:change', onChange)
    return () => window.removeEventListener('starred-tickets:change', onChange)
  }, [iid])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const next = toggleStar(iid)
    setStarred(next)
  }

  const sizeCls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={starred ? t('star_remove') : t('star_add')}
      title={starred ? t('star_remove') : t('star_add')}
      className={`shrink-0 transition-all active:scale-90 ${
        starred
          ? 'text-yellow-400 hover:text-yellow-500'
          : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
      }`}
    >
      <svg
        className={sizeCls}
        fill={starred ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={starred ? 0 : 1.8}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    </button>
  )
}
