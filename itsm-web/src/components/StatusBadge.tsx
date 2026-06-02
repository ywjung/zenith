'use client'

import { useTranslations } from 'next-intl'
import { useServiceTypes } from '@/context/ServiceTypesContext'

const STATUS_STYLES: Record<string, string> = {
  open:              'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50',
  approved:          'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-700/50',
  in_progress:       'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700/50',
  waiting:           'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50',
  resolved:          'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50',
  testing:           'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-700/50',
  ready_for_release: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/50',
  released:          'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700/50',
  closed:            'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700/50',
}

const STATUS_TOOLTIP_KEYS: Record<string, string> = {
  open:              'components_statusbadge.status_tooltip_open',
  approved:          'components_statusbadge.status_tooltip_approved',
  in_progress:       'components_statusbadge.status_tooltip_in_progress',
  waiting:           'components_statusbadge.status_tooltip_waiting',
  resolved:          'components_statusbadge.status_tooltip_resolved',
  testing:           'components_statusbadge.status_tooltip_testing',
  ready_for_release: 'components_statusbadge.status_tooltip_ready_for_release',
  released:          'components_statusbadge.status_tooltip_released',
  closed:            'components_statusbadge.status_tooltip_closed',
}

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:border-gray-600',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50',
  high:     'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50',
  critical: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700/50',
}

const PRIORITY_TOOLTIP_KEYS: Record<string, string> = {
  low:      'components_statusbadge.priority_tooltip_low',
  medium:   'components_statusbadge.priority_tooltip_medium',
  high:     'components_statusbadge.priority_tooltip_high',
  critical: 'components_statusbadge.priority_tooltip_critical',
}

// 우선순위별 SLA 목표 시간 (시간 단위)
const SLA_HOURS: Record<string, number> = {
  critical: 8,
  high: 24,
  medium: 72,
  low: 168,
}

export function StatusBadge({ status }: { status?: string }) {
  const t = useTranslations()
  const key = status ?? 'open'
  let label: string
  try { label = t(`ticket.status.${key}`) } catch { label = key }
  const tooltip = STATUS_TOOLTIP_KEYS[key] ? `${label} — ${t(STATUS_TOOLTIP_KEYS[key])}` : label
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-help transition-colors duration-500 ${STATUS_STYLES[key] ?? STATUS_STYLES.open}`}
    >
      {label}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const t = useTranslations()
  const key = priority ?? 'medium'
  let label: string
  try { label = t(`ticket.priority.${key}`) } catch { label = key }
  const tooltip = PRIORITY_TOOLTIP_KEYS[key] ? `${label} — ${t(PRIORITY_TOOLTIP_KEYS[key])}` : label
  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-help transition-colors duration-500 ${PRIORITY_STYLES[key] ?? PRIORITY_STYLES.medium}`}
    >
      {label}
    </span>
  )
}

export function CategoryBadge({ category }: { category?: string }) {
  const t = useTranslations()
  const { getLabel, getEmoji } = useServiceTypes()
  const label = category ? `${getEmoji(category)} ${getLabel(category)}` : `📋 ${t('ticket.category.other')}`
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:border-gray-600">
      {label}
    </span>
  )
}

export function SlaBadge({
  priority,
  createdAt,
  state,
  slaDeadline,
  paused,
}: {
  priority?: string
  createdAt: string
  state: string
  slaDeadline?: string | null
  /** SLA가 일시정지 상태 (예: 'waiting' status) */
  paused?: boolean
}) {
  const t = useTranslations()
  if (state === 'closed') return null

  // SLA 일시정지 — 별도 표시
  if (paused) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600"
        title={t('components_statusbadge.sla_paused_tooltip')}
      >
        <span aria-hidden="true">⏸</span>
        {t('components_statusbadge.sla_paused_label')}
      </span>
    )
  }

  const slaHours = SLA_HOURS[priority ?? 'medium'] ?? 72
  const now = Date.now()

  let elapsedHours: number
  if (slaDeadline) {
    const deadlineMs = new Date(slaDeadline).getTime()
    if (isNaN(deadlineMs)) return null
    const remainMs = deadlineMs - now
    elapsedHours = slaHours - remainMs / (1000 * 60 * 60)
  } else {
    const createdMs = new Date(createdAt).getTime()
    if (isNaN(createdMs)) return null
    elapsedHours = (now - createdMs) / (1000 * 60 * 60)
  }

  const ratio = elapsedHours / slaHours
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)))

  let label: string
  let style: string
  let barColor: string

  if (ratio > 1) {
    const overHours = Math.round(elapsedHours - slaHours)
    label = t('sla.exceeded_badge', { h: overHours })
    style = 'bg-red-100 text-red-800 border-red-300 font-bold dark:bg-red-900/50 dark:text-red-300 dark:border-red-700'
    barColor = 'bg-red-500'
  } else if (ratio >= 0.9) {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = t('sla.imminent_badge', { h: remainHours })
    style = 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50'
    barColor = 'bg-orange-500'
  } else if (ratio >= 0.5) {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = t('sla.caution_badge', { h: remainHours })
    style = 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50'
    barColor = 'bg-yellow-500'
  } else {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = t('sla.ok_badge', { h: remainHours })
    style = 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700/50'
    barColor = 'bg-green-500'
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border ${style}`}
      >
        {label}
      </span>
      <span
        className="hidden md:inline-block w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        title={t('components_statusbadge.sla_progress_title', { pct })}
        aria-label={t('components_statusbadge.sla_progress_aria', { pct })}
      >
        <span
          className={`block h-full ${barColor} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
}
