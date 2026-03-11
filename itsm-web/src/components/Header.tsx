'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { formatName } from '@/lib/utils'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'

export default function Header() {
  const { user, logout, isAgent, isAdmin } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="bg-blue-700 text-white shadow-md">
      <div className="w-full px-4 py-3 flex items-center justify-between gap-3">
        <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-90 shrink-0">
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 shrink-0">
              <rect width="32" height="32" rx="6" fill="white" fillOpacity="0.15"/>
              <polygon points="16,4 17.2,8.4 21.6,8.4 18.2,11 19.4,15.4 16,12.8 12.6,15.4 13.8,11 10.4,8.4 14.8,8.4" fill="#FCD34D"/>
              <path d="M9 18.5H22L9 26H23" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            ZENITH
          </span>
        </Link>

        {user && <GlobalSearch />}

        {/* 데스크톱 네비게이션 */}
        <nav className="hidden md:flex items-center gap-3 text-sm flex-shrink-0">
          {user ? (
            <>
              <Link href="/" className="hover:underline opacity-90 whitespace-nowrap">티켓</Link>
              <Link href="/kb" className="hover:underline opacity-90 whitespace-nowrap">지식베이스</Link>
              <Link href="/kanban" className="hover:underline opacity-90 whitespace-nowrap">칸반</Link>
              {isAgent && <Link href="/reports" className="hover:underline opacity-90 whitespace-nowrap">리포트</Link>}
              {isAgent && <Link href="/admin" className="hover:underline opacity-90 whitespace-nowrap">관리</Link>}
              <Link href="/help" className="hover:underline opacity-90 whitespace-nowrap">도움말</Link>
              <a
                href={process.env.NEXT_PUBLIC_GITLAB_URL || 'http://localhost:8929'}
                target="_blank" rel="noopener noreferrer"
                className="hover:underline opacity-90 whitespace-nowrap"
              >GitLab ↗</a>
              <Link
                href="/tickets/new"
                className="bg-white text-blue-700 px-3 py-1.5 rounded-md font-semibold hover:bg-blue-50 transition-colors whitespace-nowrap text-xs"
              >+ 새 티켓</Link>
              <NotificationBell />
              <div className="flex items-center gap-2 border-l border-blue-500 pl-3">
                <span className="opacity-90 text-sm whitespace-nowrap">{formatName(user.name)}</span>
                {user.role !== 'user' && (
                  <span className="text-xs bg-blue-500 px-1.5 py-0.5 rounded whitespace-nowrap">
                    {user.role === 'admin' ? '관리자' : user.role === 'agent' ? 'IT담당' : '개발자'}
                  </span>
                )}
                <button onClick={logout} className="text-blue-200 hover:text-white text-xs underline whitespace-nowrap">
                  로그아웃
                </button>
              </div>
            </>
          ) : (
            <>
              <Link href="/portal" className="hover:underline opacity-90">IT 지원 요청</Link>
              <Link href="/login" className="bg-white text-blue-700 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 transition-colors">로그인</Link>
            </>
          )}
        </nav>

        {/* 모바일 오른쪽 액션 */}
        <div className="flex md:hidden items-center gap-2">
          {user && <NotificationBell />}
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="p-2 rounded-md hover:bg-blue-600 transition-colors"
            aria-label="메뉴"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>
      </div>

      {/* 모바일 드롭다운 메뉴 */}
      {mobileMenuOpen && user && (
        <div className="md:hidden bg-blue-800 border-t border-blue-600 px-4 py-3 space-y-2 text-sm">
          <Link href="/" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>🎫 티켓 목록</Link>
          <Link href="/tickets/new" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>+ 새 티켓 등록</Link>
          <Link href="/kb" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>📚 지식베이스</Link>
          <Link href="/kanban" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>🗂 칸반</Link>
          {isAgent && <Link href="/reports" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>📊 리포트</Link>}
          {isAgent && <Link href="/admin" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>⚙️ 관리</Link>}
          <Link href="/help" className="block py-2 hover:text-blue-200" onClick={() => setMobileMenuOpen(false)}>❓ 도움말</Link>
          <div className="border-t border-blue-600 pt-2 flex items-center justify-between">
            <span className="text-blue-200 text-xs">{user.name} ({user.role})</span>
            <button onClick={logout} className="text-blue-300 hover:text-white text-xs underline">로그아웃</button>
          </div>
        </div>
      )}
    </header>
  )
}
