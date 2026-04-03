'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'

interface MenuItem { href: string; label: string; icon: string; desc: string }
interface MenuGroup { group: string; icon: string; adminOnly: boolean; items: MenuItem[] }

const MENU_GROUPS: MenuGroup[] = [
  {
    group: '사용자 & 권한',
    icon: '👥',
    adminOnly: true,
    items: [
      { href: '/admin/users',        label: '사용자 관리',      icon: '👤', desc: '역할 부여 · 계정 관리' },
      { href: '/admin/role-labels',  label: '역할 명칭 설정',   icon: '🏷️', desc: '역할 표시 이름 커스터마이즈' },
      { href: '/admin/ip-allowlist', label: 'IP 접근 제한',     icon: '🛡️', desc: '관리자 API CIDR 허용 목록' },
      { href: '/admin/audit',        label: '감사 로그',        icon: '🔍', desc: '변경 이력 · IP 추적' },
    ],
  },
  {
    group: 'SLA & 자동화',
    icon: '⚡',
    adminOnly: true,
    items: [
      { href: '/admin/sla-policies',       label: 'SLA 정책',        icon: '⏱️', desc: '우선순위별 목표 시간' },
      { href: '/admin/business-hours',     label: '업무 시간',        icon: '🕘', desc: '공휴일 · 요일별 업무 시간' },
      { href: '/admin/escalation-policies',label: '에스컬레이션',     icon: '🚨', desc: 'SLA 위반 자동 액션' },
      { href: '/admin/assignment-rules',   label: '자동 배정 규칙',   icon: '⚡', desc: '티켓 자동 담당자 배정' },
      { href: '/admin/automation-rules',   label: '자동화 규칙',      icon: '🤖', desc: '이벤트 기반 자동 액션' },
      { href: '/admin/recurring-tickets',  label: '반복 티켓',        icon: '🔄', desc: '정기 자동 생성 스케줄' },
    ],
  },
  {
    group: '티켓 설정',
    icon: '🗂️',
    adminOnly: true,
    items: [
      { href: '/admin/service-types',   label: '서비스 유형',    icon: '🗂️', desc: '카테고리 · 색상 관리' },
      { href: '/admin/custom-fields',   label: '커스텀 필드',    icon: '📝', desc: '티켓 추가 입력 필드 정의' },
      { href: '/admin/service-catalog', label: '서비스 카탈로그',icon: '📦', desc: '포털 신청 카탈로그 항목 관리' },
      { href: '/admin/templates',       label: '티켓 템플릿',    icon: '📋', desc: '자주 쓰는 티켓 양식' },
      { href: '/admin/quick-replies',   label: '빠른 답변',      icon: '💬', desc: '에이전트 답변 템플릿' },
      { href: '/admin/faq',             label: 'FAQ 관리',       icon: '❓', desc: '자주 묻는 질문 관리' },
    ],
  },
  {
    group: '알림 & 연동',
    icon: '🔔',
    adminOnly: true,
    items: [
      { href: '/admin/announcements',         label: '공지사항 / 배너',   icon: '📢', desc: '시스템 공지 · 배너 관리' },
      { href: '/admin/notification-channels', label: '알림 채널',         icon: '🔔', desc: '이메일 · 텔레그램 · Slack' },
      { href: '/admin/email-templates',       label: '이메일 템플릿',     icon: '📧', desc: 'Jinja2 이메일 편집' },
      { href: '/admin/email-ingest',          label: '이메일 수신',       icon: '📥', desc: 'IMAP 수신 모니터링' },
      { href: '/admin/outbound-webhooks',     label: '아웃바운드 웹훅',   icon: '🔗', desc: 'Slack · Teams 연동' },
      { href: '/admin/api-keys',              label: 'API 키',            icon: '🔑', desc: '외부 시스템 인증 키' },
    ],
  },
  {
    group: 'AI 설정',
    icon: '🤖',
    adminOnly: true,
    items: [
      { href: '/admin/ai-settings', label: 'AI 설정', icon: '🤖', desc: 'OpenAI·Ollama 자동 분류·요약·KB 추천' },
    ],
  },
  {
    group: '운영 & 모니터링',
    icon: '📊',
    adminOnly: true,
    items: [
      { href: '/admin/workload',             label: '업무 현황 및 성과', icon: '📈', desc: '담당·완료율·SLA·성과등급' },
      { href: '/admin/monitoring',           label: '시스템 모니터링',   icon: '📊', desc: 'Celery 작업 · 성능 지표' },
      { href: '/admin/celery',               label: 'Celery 모니터링',   icon: '🔄', desc: '워커 · 큐 · 태스크 상세' },
      { href: '/admin/failed-notifications', label: '실패 알림 추적',    icon: '⚠️', desc: '재시도 초과 알림 관리' },
      { href: '/admin/labels',               label: 'GitLab 라벨 동기화',icon: '🏷️', desc: '라벨 현황 · 수동 동기화' },
      { href: '/admin/search-index',         label: '전문검색 색인',     icon: '🔎', desc: '검색 색인 · 수동 동기화' },
      { href: '/admin/db-cleanup',           label: 'DB 정리',           icon: '🗑️', desc: '로그·알림·KB 버전 정리' },
    ],
  },
]

const HREF_TO_GROUP: Record<string, string> = {}
MENU_GROUPS.forEach(g => g.items.forEach(item => { HREF_TO_GROUP[item.href] = g.group }))

function AdminSidebar({ pathname, isAdmin }: { pathname: string; isAdmin: boolean }) {
  const activeGroupName = HREF_TO_GROUP[pathname] ?? ''

  // 현재 활성 그룹만 기본 펼침
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    MENU_GROUPS.forEach(g => { init[g.group] = g.group === activeGroupName })
    return init
  })

  const toggle = (name: string) =>
    setOpenGroups(prev => ({ ...prev, [name]: !prev[name] }))

  return (
    <aside className="w-52 shrink-0">
      <nav className="space-y-0.5">
        {MENU_GROUPS.filter(g => !g.adminOnly || isAdmin).map(group => {
          const isOpen = openGroups[group.group] ?? false
          const hasActive = group.items.some(i => i.href === pathname)
          return (
            <div key={group.group}>
              {/* 그룹 헤더 - 클릭으로 접기/펼치기 */}
              <button
                onClick={() => toggle(group.group)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                  hasActive
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{group.icon}</span>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    hasActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {group.group}
                  </span>
                </div>
                <svg
                  className={`w-3.5 h-3.5 transition-transform shrink-0 ${
                    isOpen ? 'rotate-180' : ''
                  } ${hasActive ? 'text-blue-500' : 'text-gray-400'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 그룹 항목 */}
              {isOpen && (
                <div className="ml-2 mb-1">
                  {group.items.map(item => {
                    const isActive = pathname === item.href
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all text-sm ${
                          isActive
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                        }`}
                      >
                        <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
                        <span className={`font-medium leading-tight text-sm ${
                          isActive ? 'text-white' : 'text-gray-800 dark:text-gray-200'
                        }`}>
                          {item.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

// 모바일: 드롭다운 메뉴
function AdminMobileMenu({ pathname, isAdmin }: { pathname: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)

  const allItems = MENU_GROUPS
    .filter(g => !g.adminOnly || isAdmin)
    .flatMap(g => g.items.map(item => ({ ...item, group: g.group })))

  const current = allItems.find(i => i.href === pathname)

  return (
    <div className="relative md:hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{current?.icon ?? '⚙️'}</span>
          <div className="text-left">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{current?.label ?? '메뉴 선택'}</div>
            {current && <div className="text-xs text-gray-400 dark:text-gray-500">{current.desc}</div>}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          {MENU_GROUPS.filter(g => !g.adminOnly || isAdmin).map(group => (
            <div key={group.group}>
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {group.icon} {group.group}
                </span>
              </div>
              {group.items.map(item => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0 transition-colors ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span className="text-base w-5 text-center">{item.icon}</span>
                    <div>
                      <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                        {item.label}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{item.desc}</div>
                    </div>
                    {isActive && (
                      <svg className="ml-auto w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAdmin, isAgent, loading } = useAuth()

  // 인증 정보 로딩 중 — 권한 플래시(Flash of Unauthorized Content) 방지
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 dark:text-gray-500">
        <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="text-sm">권한 확인 중…</span>
      </div>
    )
  }

  if (!isAgent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-500 dark:text-gray-400">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-lg font-medium">에이전트 이상 권한이 필요합니다.</p>
        <p className="text-sm mt-1">관리자에게 권한을 요청하세요.</p>
      </div>
    )
  }

  const allItems = MENU_GROUPS.flatMap(g => g.items)
  const currentItem = allItems.find(i => i.href === pathname)
  const currentGroup = MENU_GROUPS.find(g => g.items.some(i => i.href === pathname))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* 상단 헤더 */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="w-full px-4 md:px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white shadow-sm shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">시스템 관리</h1>
                {currentGroup && (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">/</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{currentGroup.group}</span>
                    {currentItem && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">/</span>
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{currentItem.label}</span>
                      </>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                {currentItem?.desc ?? '사용자·SLA·자동화·보안 설정을 관리합니다'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 본문 영역 */}
      <div className="w-full px-4 md:px-6 py-6">
        {/* 모바일: 드롭다운 */}
        <AdminMobileMenu pathname={pathname} isAdmin={isAdmin} />

        {/* 데스크톱: 사이드바 + 콘텐츠 */}
        <div className="hidden md:flex gap-6 items-start">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 sticky top-6">
            <AdminSidebar pathname={pathname} isAdmin={isAdmin} />
          </div>
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>

        {/* 모바일: 콘텐츠만 */}
        <div className="md:hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </RequireAuth>
  )
}
