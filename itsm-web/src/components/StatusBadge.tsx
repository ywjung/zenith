'use client'

import { useServiceTypes } from '@/context/ServiceTypesContext'
import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/constants'

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

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:border-gray-600',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50',
  high:     'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50',
  critical: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700/50',
}

// 우선순위별 SLA 목표 시간 (시간 단위)
const SLA_HOURS: Record<string, number> = {
  critical: 8,
  high: 24,
  medium: 72,
  low: 168,
}

export function StatusBadge({ status }: { status?: string }) {
  const key = status ?? 'open'
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[key] ?? STATUS_STYLES.open}`}
    >
      {STATUS_LABELS[key] ?? key}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const key = priority ?? 'medium'
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_STYLES[key] ?? PRIORITY_STYLES.medium}`}
    >
      {PRIORITY_LABELS[key] ?? key}
    </span>
  )
}

export function CategoryBadge({ category }: { category?: string }) {
  const { getLabel, getEmoji } = useServiceTypes()
  const label = category ? `${getEmoji(category)} ${getLabel(category)}` : '📋 기타'
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
}: {
  priority?: string
  createdAt: string
  state: string
  slaDeadline?: string | null
}) {
  if (state === 'closed') return null

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

  let label: string
  let style: string

  if (ratio > 1) {
    const overHours = Math.round(elapsedHours - slaHours)
    label = `🔴 SLA 초과 (+${overHours}h)`
    style = 'bg-red-100 text-red-800 border-red-300 font-bold dark:bg-red-900/50 dark:text-red-300 dark:border-red-700'
  } else if (ratio >= 0.9) {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = `🟠 SLA 임박 (${remainHours}h 남음)`
    style = 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700/50'
  } else if (ratio >= 0.5) {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = `🟡 SLA 주의 (${remainHours}h 남음)`
    style = 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700/50'
  } else {
    const remainHours = Math.round(slaHours - elapsedHours)
    label = `🟢 SLA 여유 (${remainHours}h 남음)`
    style = 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700/50'
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border ${style}`}
    >
      {label}
    </span>
  )
}
