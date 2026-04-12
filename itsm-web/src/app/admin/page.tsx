'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

interface MenuItem { href: string; labelKey: string; descKey: string }
interface MenuGroup { titleKey: string; items: MenuItem[] }

const MENU_GROUPS: MenuGroup[] = [
  {
    titleKey: 'group_users',
    items: [
      { href: '/admin/users',         labelKey: 'label_users',         descKey: 'desc_users' },
      { href: '/admin/role-labels',   labelKey: 'label_role_labels',   descKey: 'desc_role_labels' },
      { href: '/admin/ip-allowlist',  labelKey: 'label_ip_allowlist',  descKey: 'desc_ip_allowlist' },
      { href: '/admin/api-keys',      labelKey: 'label_api_keys',      descKey: 'desc_api_keys' },
    ],
  },
  {
    titleKey: 'group_automation',
    items: [
      { href: '/admin/automation-rules',    labelKey: 'label_automation_rules', descKey: 'desc_automation_rules' },
      { href: '/admin/assignment-rules',    labelKey: 'label_assignment_rules', descKey: 'desc_assignment_rules' },
      { href: '/admin/recurring-tickets',   labelKey: 'label_recurring',        descKey: 'desc_recurring' },
      { href: '/admin/escalation-policies', labelKey: 'label_escalation',       descKey: 'desc_escalation' },
      { href: '/admin/sla-policies',        labelKey: 'label_sla_policies',     descKey: 'desc_sla_policies' },
      { href: '/admin/business-hours',      labelKey: 'label_business_hours',   descKey: 'desc_business_hours' },
    ],
  },
  {
    titleKey: 'group_comm',
    items: [
      { href: '/admin/outbound-webhooks',     labelKey: 'label_outbound_webhooks', descKey: 'desc_outbound_webhooks' },
      { href: '/admin/notification-channels', labelKey: 'label_channels',          descKey: 'desc_channels' },
      { href: '/admin/email-templates',       labelKey: 'label_email_templates',   descKey: 'desc_email_templates' },
      { href: '/admin/email-ingest',          labelKey: 'label_email_ingest',      descKey: 'desc_email_ingest' },
      { href: '/admin/announcements',         labelKey: 'label_announcements',     descKey: 'desc_announcements' },
    ],
  },
  {
    titleKey: 'group_content',
    items: [
      { href: '/admin/service-types',   labelKey: 'label_service_types',   descKey: 'desc_service_types' },
      { href: '/admin/service-catalog', labelKey: 'label_service_catalog', descKey: 'desc_service_catalog' },
      { href: '/admin/templates',       labelKey: 'label_templates',       descKey: 'desc_templates' },
      { href: '/admin/quick-replies',   labelKey: 'label_quick_replies',   descKey: 'desc_quick_replies' },
      { href: '/admin/custom-fields',   labelKey: 'label_custom_fields',   descKey: 'desc_custom_fields' },
      { href: '/admin/faq',             labelKey: 'label_faq',             descKey: 'desc_faq' },
      { href: '/admin/labels',          labelKey: 'label_labels',          descKey: 'desc_labels' },
    ],
  },
  {
    titleKey: 'group_ops',
    items: [
      { href: '/admin/ai-settings',          labelKey: 'label_ai_settings',   descKey: 'desc_ai_settings' },
      { href: '/admin/monitoring',           labelKey: 'label_monitoring',    descKey: 'desc_monitoring' },
      { href: '/admin/audit',                labelKey: 'label_audit',         descKey: 'desc_audit' },
      { href: '/admin/failed-notifications', labelKey: 'label_failed_notif',  descKey: 'desc_failed_notif' },
      { href: '/admin/celery',               labelKey: 'label_celery',        descKey: 'desc_celery' },
      { href: '/admin/search-index',         labelKey: 'label_search_index',  descKey: 'desc_search_index' },
      { href: '/admin/db-cleanup',           labelKey: 'label_db_cleanup',    descKey: 'desc_db_cleanup' },
      { href: '/admin/workload',             labelKey: 'label_workload',      descKey: 'desc_workload' },
    ],
  },
]

function AdminContent() {
  const t = useTranslations('admin.home')
  const { isAdmin } = useAuth()
  if (!isAdmin) return <div className="p-8 text-center text-gray-500">{t('no_permission')}</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {MENU_GROUPS.map((group) => (
          <div key={group.titleKey} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t(group.titleKey as 'group_users')}</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">{t(item.labelKey as 'label_users')}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t(item.descKey as 'desc_users')}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminPage() {
  return <RequireAuth><AdminContent /></RequireAuth>
}
