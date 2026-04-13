'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

/**
 * 모바일 우하단 floating action button — 새 티켓 빠른 접근.
 * - md 미만에서만 노출
 * - /tickets/new 페이지에서는 숨김
 * - 비로그인 시 숨김
 */
export default function MobileFab() {
  const pathname = usePathname()
  const { user } = useAuth()
  if (!user) return null
  if (pathname === '/tickets/new' || pathname?.startsWith('/auth/')) return null

  return (
    <Link
      href="/tickets/new"
      aria-label="새 티켓 작성"
      className="md:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white shadow-2xl flex items-center justify-center transition-all print-hidden"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
      </svg>
    </Link>
  )
}
