'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'

interface MenuItem { href: string; labelKey: string; descKey: string; icon: string }
interface MenuGroup { groupKey: string; icon: string; adminOnly: boolean; items: MenuItem[] }

// 메뉴 구조 — 라벨/설명은 i18n 키로 간접 참조하여 다국어 지원.
// labelKey/descKey는 admin.nav.* 네임스페이스의 키.
const MENU_GROUPS: MenuGroup[] = [
  {
    groupKey: 'group_users', icon: '👥', adminOnly: true,
    items: [
      { href: '/admin/users',        labelKey: 'item_users_label',        descKey: 'item_users_desc',        icon: '👤' },
      { href: '/admin/role-labels',  labelKey: 'item_role_labels_label',  descKey: 'item_role_labels_desc',  icon: '🏷️' },
      { href: '/admin/ip-allowlist', labelKey: 'item_ip_allowlist_label', descKey: 'item_ip_allowlist_desc', icon: '🛡️' },
      { href: '/admin/audit',        labelKey: 'item_audit_label',        descKey: 'item_audit_desc',        icon: '🔍' },
    ],
  },
  {
    groupKey: 'group_sla', icon: '⚡', adminOnly: true,
    items: [
      { href: '/admin/sla-policies',       labelKey: 'item_sla_policies_label',   descKey: 'item_sla_policies_desc',   icon: '⏱️' },
      { href: '/admin/business-hours',     labelKey: 'item_business_hours_label', descKey: 'item_business_hours_desc', icon: '🕘' },
      { href: '/admin/escalation-policies',labelKey: 'item_escalation_label',     descKey: 'item_escalation_desc',     icon: '🚨' },
      { href: '/admin/assignment-rules',   labelKey: 'item_assignment_label',     descKey: 'item_assignment_desc',     icon: '⚡' },
      { href: '/admin/automation-rules',   labelKey: 'item_automation_label',     descKey: 'item_automation_desc',     icon: '🤖' },
      { href: '/admin/recurring-tickets',  labelKey: 'item_recurring_label',      descKey: 'item_recurring_desc',      icon: '🔄' },
    ],
  },
  {
    groupKey: 'group_tickets', icon: '🗂️', adminOnly: true,
    items: [
      { href: '/admin/service-types',   labelKey: 'item_service_types_label',   descKey: 'item_service_types_desc',   icon: '🗂️' },
      { href: '/admin/custom-fields',   labelKey: 'item_custom_fields_label',   descKey: 'item_custom_fields_desc',   icon: '📝' },
      { href: '/admin/service-catalog', labelKey: 'item_service_catalog_label', descKey: 'item_service_catalog_desc', icon: '📦' },
      { href: '/admin/templates',       labelKey: 'item_templates_label',       descKey: 'item_templates_desc',       icon: '📋' },
      { href: '/admin/quick-replies',   labelKey: 'item_quick_replies_label',   descKey: 'item_quick_replies_desc',   icon: '💬' },
      { href: '/admin/faq',             labelKey: 'item_faq_label',             descKey: 'item_faq_desc',             icon: '❓' },
    ],
  },
  {
    groupKey: 'group_notify', icon: '🔔', adminOnly: true,
    items: [
      { href: '/admin/announcements',         labelKey: 'item_announcements_label',     descKey: 'item_announcements_desc',     icon: '📢' },
      { href: '/admin/notification-channels', labelKey: 'item_channels_label',          descKey: 'item_channels_desc',          icon: '🔔' },
      { href: '/admin/email-templates',       labelKey: 'item_email_templates_label',   descKey: 'item_email_templates_desc',   icon: '📧' },
      { href: '/admin/email-ingest',          labelKey: 'item_email_ingest_label',      descKey: 'item_email_ingest_desc',      icon: '📥' },
      { href: '/admin/outbound-webhooks',     labelKey: 'item_outbound_webhooks_label', descKey: 'item_outbound_webhooks_desc', icon: '🔗' },
      { href: '/admin/api-keys',              labelKey: 'item_api_keys_label',          descKey: 'item_api_keys_desc',          icon: '🔑' },
    ],
  },
  {
    groupKey: 'group_ai', icon: '🤖', adminOnly: true,
    items: [
      { href: '/admin/ai-settings', labelKey: 'item_ai_settings_label', descKey: 'item_ai_settings_desc', icon: '🤖' },
    ],
  },
  {
    groupKey: 'group_ops', icon: '📊', adminOnly: true,
    items: [
      { href: '/admin/workload',             labelKey: 'item_workload_label',      descKey: 'item_workload_desc',      icon: '📈' },
      { href: '/admin/monitoring',           labelKey: 'item_monitoring_label',    descKey: 'item_monitoring_desc',    icon: '📊' },
      { href: '/admin/celery',               labelKey: 'item_celery_label',        descKey: 'item_celery_desc',        icon: '🔄' },
      { href: '/admin/failed-notifications', labelKey: 'item_failed_notif_label',  descKey: 'item_failed_notif_desc',  icon: '⚠️' },
      { href: '/admin/labels',               labelKey: 'item_labels_label',        descKey: 'item_labels_desc',        icon: '🏷️' },
      { href: '/admin/search-index',         labelKey: 'item_search_index_label',  descKey: 'item_search_index_desc',  icon: '🔎' },
      { href: '/admin/db-cleanup',           labelKey: 'item_db_cleanup_label',    descKey: 'item_db_cleanup_desc',    icon: '🗑️' },
    ],
  },
]

const HREF_TO_GROUP: Record<string, string> = {}
MENU_GROUPS.forEach(g => g.items.forEach(item => { HREF_TO_GROUP[item.href] = g.groupKey }))

// useTranslations는 Hook 규칙상 컴포넌트 내부에서만 사용 가능하므로
// 타입 가드용 헬퍼로 t를 받아 사용.
type TFn = ReturnType<typeof useTranslations>

function AdminSidebar({ pathname, isAdmin, t }: { pathname: string; isAdmin: boolean; t: TFn }) {
  const activeGroupKey = HREF_TO_GROUP[pathname] ?? ''

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    MENU_GROUPS.forEach(g => { init[g.groupKey] = g.groupKey === activeGroupKey })
    return init
  })

  const toggle = (key: string) =>
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }))

  return (
    <aside className="w-52 shrink-0">
      <nav className="space-y-0.5">
        {MENU_GROUPS.filter(g => !g.adminOnly || isAdmin).map(group => {
          const isOpen = openGroups[group.groupKey] ?? false
          const hasActive = group.items.some(i => i.href === pathname)
          return (
            <div key={group.groupKey}>
              <button
                onClick={() => toggle(group.groupKey)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                  hasActive ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{group.icon}</span>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    hasActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {t(group.groupKey as 'group_users')}
                  </span>
                </div>
                <svg
                  className={`w-3.5 h-3.5 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''} ${hasActive ? 'text-blue-500' : 'text-gray-400'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

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
                          {t(item.labelKey as 'item_users_label')}
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

function AdminMobileMenu({ pathname, isAdmin, t }: { pathname: string; isAdmin: boolean; t: TFn }) {
  const [open, setOpen] = useState(false)

  const allItems = MENU_GROUPS
    .filter(g => !g.adminOnly || isAdmin)
    .flatMap(g => g.items.map(item => ({ ...item, groupKey: g.groupKey })))

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
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {current ? t(current.labelKey as 'item_users_label') : t('mobile_menu_placeholder')}
            </div>
            {current && <div className="text-xs text-gray-400 dark:text-gray-500">{t(current.descKey as 'item_users_desc')}</div>}
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
            <div key={group.groupKey}>
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {group.icon} {t(group.groupKey as 'group_users')}
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
                        {t(item.labelKey as 'item_users_label')}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{t(item.descKey as 'item_users_desc')}</div>
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
  const t = useTranslations('admin.nav')
  const pathname = usePathname()
  const { isAdmin, isAgent, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 dark:text-gray-500">
        <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <span className="text-sm">{t('checking_perm')}</span>
      </div>
    )
  }

  if (!isAgent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-500 dark:text-gray-400">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-lg font-medium">{t('no_permission')}</p>
        <p className="text-sm mt-1">{t('no_permission_hint')}</p>
      </div>
    )
  }

  const allItems = MENU_GROUPS.flatMap(g => g.items)
  const currentItem = allItems.find(i => i.href === pathname)
  const currentGroup = MENU_GROUPS.find(g => g.items.some(i => i.href === pathname))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
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
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('header_title')}</h1>
                {currentGroup && (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">/</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{t(currentGroup.groupKey as 'group_users')}</span>
                    {currentItem && (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">/</span>
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{t(currentItem.labelKey as 'item_users_label')}</span>
                      </>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                {currentItem ? t(currentItem.descKey as 'item_users_desc') : t('default_subtitle')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-4 md:px-6 py-6">
        <AdminMobileMenu pathname={pathname} isAdmin={isAdmin} t={t} />

        <div className="hidden md:flex gap-6 items-start">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 sticky top-6">
            <AdminSidebar pathname={pathname} isAdmin={isAdmin} t={t} />
          </div>
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>

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
