'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { formatName } from '@/lib/utils'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'
import LocaleSwitcher from './LocaleSwitcher'

export default function Header() {
  const { user, logout, isAgent, isAdmin } = useAuth()
  const { theme, setTheme } = useTheme()
  const t = useTranslations()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function cycleTheme() {
    const next: Record<string, 'light' | 'dark' | 'system'> = {
      system: 'light', light: 'dark', dark: 'system',
    }
    setTheme(next[theme] ?? 'system')
  }
  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'

  return (
    <header className="bg-blue-700 dark:bg-gray-900 text-white shadow-md dark:shadow-gray-900/50 dark:border-b dark:border-gray-800">
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
              <Link href="/" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.tickets')}</Link>
              <Link href="/kb" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.kb')}</Link>
              <Link href="/kanban" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.kanban')}</Link>
              {isAgent && <Link href="/reports" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.reports')}</Link>}
              {isAgent && <Link href="/admin" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.admin')}</Link>}
              <Link href="/help" className="hover:underline opacity-90 whitespace-nowrap">{t('nav.help')}</Link>
              {process.env.NEXT_PUBLIC_GITLAB_URL && (
                <a
                  href={process.env.NEXT_PUBLIC_GITLAB_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="hover:underline opacity-90 whitespace-nowrap"
                >GitLab ↗</a>
              )}
              <Link
                href="/tickets/new"
                className="bg-white dark:bg-gray-700 text-blue-700 dark:text-gray-100 px-3 py-1.5 rounded-md font-semibold hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors whitespace-nowrap text-xs"
              >+ {t('ticket.new')}</Link>
              <NotificationBell />
              <button
                onClick={cycleTheme}
                title={`테마: ${theme} (클릭해서 변경)`}
                className="p-1.5 rounded-md hover:bg-blue-600 dark:hover:bg-gray-700 transition-colors text-sm opacity-80 hover:opacity-100"
              >
                {themeIcon}
              </button>
              <LocaleSwitcher />
              <div className="relative flex items-center gap-2 border-l border-blue-500 dark:border-gray-700 pl-3 group">
                <button className="flex items-center gap-2 cursor-pointer">
                  <span className="opacity-90 text-sm whitespace-nowrap">{formatName(user.name)}</span>
                  {user.role !== 'user' && (
                    <span className="text-xs bg-blue-500 dark:bg-gray-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                      {user.role === 'admin' ? '관리자' : user.role === 'agent' ? 'IT담당' : user.role === 'pl' ? 'PL' : '개발자'}
                    </span>
                  )}
                  <span className="text-blue-300 dark:text-gray-500 text-xs">▾</span>
                </button>
                {/* 드롭다운 */}
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150">
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span>👤</span>
                    <span>{t('nav.profile')}</span>
                  </Link>
                  <Link
                    href="/profile/sessions"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span>🔒</span>
                    <span>세션 관리</span>
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-700" />
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <span>↩</span>
                    <span>{t('nav.logout')}</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Link href="/portal" className="hover:underline opacity-90">IT 지원 요청</Link>
              <Link href="/login" className="bg-white dark:bg-gray-700 text-blue-700 dark:text-gray-100 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors">로그인</Link>
            </>
          )}
        </nav>

        {/* 모바일 오른쪽 액션 */}
        <div className="flex md:hidden items-center gap-2">
          {user && <NotificationBell />}
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="p-2 rounded-md hover:bg-blue-600 dark:hover:bg-gray-700 transition-colors"
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
        <div className="md:hidden bg-blue-800 dark:bg-gray-900 border-t border-blue-600 dark:border-gray-800 px-4 py-3 space-y-2 text-sm">
          <Link href="/" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🎫 {t('nav.tickets')}</Link>
          <Link href="/tickets/new" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>+ {t('ticket.new')}</Link>
          <Link href="/kb" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📚 {t('nav.kb')}</Link>
          <Link href="/kanban" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🗂 {t('nav.kanban')}</Link>
          {isAgent && <Link href="/reports" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📊 {t('nav.reports')}</Link>}
          {isAgent && <Link href="/admin" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>⚙️ {t('nav.admin')}</Link>}
          <Link href="/help" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>❓ {t('nav.help')}</Link>
          <div className="border-t border-blue-600 dark:border-gray-700 pt-2 flex items-center justify-between">
            <span className="text-blue-200 dark:text-gray-400 text-xs">{user.name} ({user.role})</span>
            <button onClick={logout} className="text-blue-300 dark:text-gray-400 hover:text-white dark:hover:text-gray-200 text-xs underline">{t('nav.logout')}</button>
          </div>
        </div>
      )}
    </header>
  )
}
