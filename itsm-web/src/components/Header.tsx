'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { formatName } from '@/lib/utils'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'
import LocaleSwitcher from './LocaleSwitcher'

function NavLink({ href, icon, label, dataTour }: {
  href: string
  icon: React.ReactNode
  label: string
  dataTour?: string
}) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/' && pathname.startsWith(href))
  return (
    <Link
      href={href}
      data-tour={dataTour}
      className={`flex items-center gap-1 whitespace-nowrap transition-opacity ${
        active
          ? 'opacity-100 font-semibold underline underline-offset-4 decoration-white/60'
          : 'opacity-80 hover:opacity-100 hover:underline'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

export default function Header() {
  const { user, logout, isAgent, isAdmin } = useAuth()
  const { theme, setTheme } = useTheme()
  const t = useTranslations()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileViewsOpen, setMobileViewsOpen] = useState(false)

  function cycleTheme() {
    const next: Record<string, 'light' | 'dark' | 'system'> = {
      system: 'light', light: 'dark', dark: 'system',
    }
    setTheme(next[theme] ?? 'system')
  }
  const themeIcon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'

  // 현황·분석 드롭다운에 들어갈 항목 (isAgent 조건 포함)
  const analyticsItems = [
    {
      href: '/calendar',
      label: t('nav.calendar'),
      show: true,
      icon: (
        <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      href: '/gantt',
      label: t('nav.gantt'),
      show: isAgent,
      icon: (
        <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5v14M6 8h6M6 12h10M6 16h8" />
        </svg>
      ),
    },
    {
      href: '/sla',
      label: t('nav.sla'),
      show: isAgent,
      icon: (
        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      href: '/reports',
      label: t('nav.reports'),
      show: isAgent,
      dataTour: 'nav-reports',
      icon: (
        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      href: '/multi-project',
      label: '멀티뷰',
      show: isAgent,
      icon: (
        <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
  ].filter(i => i.show)

  return (
    <header className="bg-blue-700 dark:bg-gray-900 text-white shadow-md dark:shadow-gray-900/50 dark:border-b dark:border-gray-800">
      <div className="w-full px-4 py-3 flex items-center justify-between gap-3">
        {/* 로고 */}
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
              {/* ── 핵심 메뉴 ── */}
              <NavLink
                href="/"
                dataTour="nav-tickets"
                label={t('nav.tickets')}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                }
              />
              <NavLink
                href="/kb"
                label={t('nav.kb')}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                }
              />
              <NavLink
                href="/kanban"
                dataTour="nav-kanban"
                label={t('nav.kanban')}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                }
              />
              <NavLink
                href="/changes"
                label="변경관리"
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                }
              />
              <NavLink
                href="/problems"
                label="문제관리"
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                }
              />

              {/* ── 현황·분석 드롭다운 ── */}
              <div className="relative group">
                <button className="flex items-center gap-1 opacity-80 hover:opacity-100 whitespace-nowrap transition-opacity">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  현황·분석
                  <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 드롭다운 패널 */}
                <div className="absolute left-0 top-full pt-2 z-50 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150">
                  <div className="w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden py-1">
                    {analyticsItems.map(item => (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-tour={item.dataTour}
                        className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        {item.icon}
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 구분선 ── */}
              <span className="border-l border-blue-500 dark:border-gray-700 h-4 opacity-60" />

              {/* ── 관리 / 도움말 / GitLab ── */}
              {isAgent && (
                <NavLink
                  href="/admin"
                  dataTour="nav-admin"
                  label={t('nav.admin')}
                  icon={
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  }
                />
              )}
              <NavLink
                href="/help"
                label={t('nav.help')}
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              {process.env.NEXT_PUBLIC_GITLAB_URL && (
                <a
                  href={process.env.NEXT_PUBLIC_GITLAB_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 opacity-80 hover:opacity-100 whitespace-nowrap transition-opacity"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  GitLab
                </a>
              )}

              {/* ── 새 티켓 / 알림 / 테마 / 언어 / 프로필 ── */}
              <Link
                href="/tickets/new"
                className="bg-white dark:bg-gray-700 text-blue-700 dark:text-gray-100 px-3 py-1.5 rounded-md font-semibold hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors whitespace-nowrap text-xs"
                data-tour="nav-new-ticket"
              >
                + {t('ticket.new')}
              </Link>
              <NotificationBell />
              <button
                onClick={cycleTheme}
                title={`Theme: ${theme} (click to change)`}
                aria-label={`테마 전환 (현재: ${theme})`}
                className="p-1.5 rounded-md hover:bg-blue-600 dark:hover:bg-gray-700 transition-colors text-sm opacity-80 hover:opacity-100"
              >
                {themeIcon}
              </button>
              <LocaleSwitcher />

              {/* 프로필 드롭다운 */}
              <div className="relative flex items-center gap-2 border-l border-blue-500 dark:border-gray-700 pl-3 group">
                <button className="flex items-center gap-2 cursor-pointer" aria-label="사용자 메뉴">
                  <span className="opacity-90 text-sm whitespace-nowrap">{formatName(user.name)}</span>
                  {user.role !== 'user' && (
                    <span className="text-xs bg-blue-500 dark:bg-gray-700 px-1.5 py-0.5 rounded whitespace-nowrap">
                      {t(`role.${user.role}`)}
                    </span>
                  )}
                  <span className="text-blue-300 dark:text-gray-500 text-xs">▾</span>
                </button>
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150">
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span>{t('nav.profile')}</span>
                  </Link>
                  <Link
                    href="/profile/sessions"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>{t('nav.sessions')}</span>
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-700" />
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>{t('nav.logout')}</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Link href="/portal" className="hover:underline opacity-90">{t('portal.title')}</Link>
              <Link href="/login" className="bg-white dark:bg-gray-700 text-blue-700 dark:text-gray-100 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors">{t('auth.login')}</Link>
            </>
          )}
        </nav>

        {/* 모바일 오른쪽 액션 */}
        <div className="flex md:hidden items-center gap-2">
          {user && <NotificationBell />}
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="p-2 rounded-md hover:bg-blue-600 dark:hover:bg-gray-700 transition-colors"
            aria-label="Menu"
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
        <div className="md:hidden bg-blue-800 dark:bg-gray-900 border-t border-blue-600 dark:border-gray-800 px-4 py-3 space-y-1 text-sm">
          <p className="text-blue-300 dark:text-gray-500 text-xs uppercase tracking-wide pb-1">핵심 메뉴</p>
          <Link href="/" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🎫 {t('nav.tickets')}</Link>
          <Link href="/tickets/new" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>+ {t('ticket.new')}</Link>
          <Link href="/kb" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📚 {t('nav.kb')}</Link>
          <Link href="/kanban" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🗂 {t('nav.kanban')}</Link>
          <Link href="/changes" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🔄 변경관리</Link>
          <Link href="/problems" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>⚠️ 문제관리</Link>

          <div className="border-t border-blue-600 dark:border-gray-700 pt-2 mt-1">
            <button
              className="flex items-center gap-1 text-blue-300 dark:text-gray-400 text-xs uppercase tracking-wide pb-1 w-full"
              onClick={() => setMobileViewsOpen(o => !o)}
            >
              <span>📊 현황·분석</span>
              <span className="ml-auto">{mobileViewsOpen ? '▲' : '▼'}</span>
            </button>
            {mobileViewsOpen && (
              <div className="pl-2 space-y-1">
                <Link href="/calendar" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📅 {t('nav.calendar')}</Link>
                {isAgent && <Link href="/gantt" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📊 {t('nav.gantt')}</Link>}
                {isAgent && <Link href="/sla" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>⏰ {t('nav.sla')}</Link>}
                {isAgent && <Link href="/reports" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>📈 {t('nav.reports')}</Link>}
                {isAgent && <Link href="/multi-project" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>🗂️ 멀티뷰</Link>}
              </div>
            )}
          </div>

          <div className="border-t border-blue-600 dark:border-gray-700 pt-2 space-y-1">
            {isAgent && <Link href="/admin" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>⚙️ {t('nav.admin')}</Link>}
            <Link href="/help" className="block py-2 hover:text-blue-200 dark:hover:text-gray-300" onClick={() => setMobileMenuOpen(false)}>❓ {t('nav.help')}</Link>
          </div>

          <div className="border-t border-blue-600 dark:border-gray-700 pt-2 flex items-center justify-between">
            <span className="text-blue-200 dark:text-gray-400 text-xs">{user.name} ({user.role})</span>
            <button onClick={logout} className="text-blue-300 dark:text-gray-400 hover:text-white dark:hover:text-gray-200 text-xs underline">{t('nav.logout')}</button>
          </div>
        </div>
      )}
    </header>
  )
}
