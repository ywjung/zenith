'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'
import MarkdownRenderer from './MarkdownRenderer'

interface TimelineEvent {
  type: 'comment' | 'audit' | 'system'
  id: string
  created_at: string
  body?: string
  author_name?: string
  author_avatar?: string
  internal?: boolean
  action?: string
  actor_name?: string
  actor_username?: string
  old_value?: Record<string, unknown> | null
  new_value?: Record<string, unknown> | null
}

// 액션 코드 → i18n 키 (표시명은 timeline.action_* 참조)
const ACTION_I18N_KEY: Record<string, string> = {
  'ticket.create':              'action_ticket_create',
  'ticket.update':              'action_ticket_update',
  'ticket.delete':              'action_ticket_delete',
  'ticket.custom_fields.update':'action_ticket_custom_fields',
  'ticket.pipeline_trigger':    'action_ticket_pipeline',
  'ticket.merge':               'action_ticket_merge',
  'ticket.bulk.status':         'action_ticket_bulk_status',
  'ticket.bulk.priority':       'action_ticket_bulk_priority',
  'ticket.bulk.assign':         'action_ticket_bulk_assign',
  'ticket.bulk.close':          'action_ticket_bulk_close',
  'user.role_change':           'action_user_role_change',
  create_ticket:   'action_ticket_create',
  update_status:   'action_update_status',
  update_priority: 'action_update_priority',
  update_category: 'action_update_category',
  assign_ticket:   'action_assign_ticket',
  close_ticket:    'action_close_ticket',
  reopen_ticket:   'action_reopen_ticket',
  update_title:    'action_update_title',
  add_comment:     'action_add_comment',
  delete_comment:  'action_delete_comment',
  update_labels:   'action_update_labels',
  rate_ticket:     'action_rate_ticket',
}

const ACTION_ICONS: Record<string, string> = {
  'ticket.create':              '🎫',
  'ticket.update':              '✏️',
  'ticket.delete':              '🗑️',
  'ticket.custom_fields.update':'📋',
  'ticket.pipeline_trigger':    '🚀',
  'ticket.merge':               '🔀',
  'ticket.bulk.status':         '🔄',
  'ticket.bulk.priority':       '⚡',
  'ticket.bulk.assign':         '👤',
  'ticket.bulk.close':          '🔒',
  'user.role_change':           '👤',
  create_ticket:  '🎫',
  update_status:  '🔄',
  update_priority:'⚡',
  close_ticket:   '🔒',
  reopen_ticket:  '🔓',
  assign_ticket:  '👤',
  rate_ticket:    '⭐',
}

const ACTION_COLORS: Record<string, string> = {
  'ticket.create':              'bg-blue-500',
  'ticket.update':              'bg-purple-500',
  'ticket.delete':              'bg-red-500',
  'ticket.custom_fields.update':'bg-indigo-500',
  'ticket.pipeline_trigger':    'bg-cyan-500',
  'ticket.merge':               'bg-violet-500',
  'ticket.bulk.status':         'bg-purple-500',
  'ticket.bulk.priority':       'bg-orange-500',
  'ticket.bulk.assign':         'bg-teal-500',
  'ticket.bulk.close':          'bg-gray-500',
  'user.role_change':           'bg-teal-500',
  create_ticket:  'bg-blue-500',
  update_status:  'bg-purple-500',
  update_priority:'bg-orange-500',
  close_ticket:   'bg-gray-500',
  reopen_ticket:  'bg-green-500',
  assign_ticket:  'bg-teal-500',
  rate_ticket:    'bg-yellow-500',
}

const ROLE_I18N_KEY: Record<string, string> = {
  admin: 'role_admin',
  agent: 'role_agent',
  developer: 'role_developer',
  user: 'role_user',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function Avatar({ name, url }: { name?: string; url?: string }) {
  const [imgError, setImgError] = useState(false)
  const initial = name?.[0]?.toUpperCase() ?? '?'

  if (url && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? ''}
        className="w-7 h-7 rounded-full object-cover shrink-0"
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <div className="w-7 h-7 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 shrink-0">
      {initial}
    </div>
  )
}

function CommentEvent({ ev }: { ev: TimelineEvent }) {
  const t = useTranslations('timeline')
  return (
    <div className="flex gap-3">
      <Avatar name={ev.author_name} url={ev.author_avatar} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{ev.author_name}</span>
          {ev.internal && (
            <span className="text-xs bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-300 dark:border-yellow-700">{t('internal')}</span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(ev.created_at)}</span>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          <MarkdownRenderer content={ev.body ?? ''} />
        </div>
      </div>
    </div>
  )
}

function SystemEvent({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 flex items-center justify-center shrink-0">
        <span className="text-gray-400 dark:text-gray-500 text-xs">GL</span>
      </div>
      <div className="text-sm text-gray-400 dark:text-gray-500 italic flex-1">
        {ev.body}
        <span className="ml-2 text-xs text-gray-300 dark:text-gray-600">{formatDate(ev.created_at)}</span>
      </div>
    </div>
  )
}

function AuditEvent({ ev }: { ev: TimelineEvent }) {
  const t = useTranslations('timeline')
  const action = ev.action ?? ''
  const labelKey = ACTION_I18N_KEY[action]
  const label = labelKey ? t(labelKey as 'action_ticket_create') : action
  const color = ACTION_COLORS[action] ?? 'bg-gray-400'
  const icon = ACTION_ICONS[action] ?? '✦'

  const statusLabel = (code?: string) => {
    if (!code) return ''
    const key = `st_${code}`
    const v = t(key as 'st_open')
    return v === key ? code : v
  }
  const priorityLabel = (code?: string) => {
    if (!code) return ''
    const key = `prio_${code}`
    const v = t(key as 'prio_low')
    return v === key ? code : v
  }
  const roleLabel = (r?: string) => {
    if (!r) return ''
    const key = ROLE_I18N_KEY[r]
    return key ? t(key as 'role_admin') : r
  }

  let detail = ''
  const nv = ev.new_value as Record<string, unknown> | null
  const ov = ev.old_value as Record<string, unknown> | null

  if (action === 'ticket.update' && nv) {
    if (nv.status && typeof nv.status === 'object') {
      const s = nv.status as { new?: string; old?: string }
      detail = t('status_detail', { old: statusLabel(s.old), new: statusLabel(s.new) })
    } else if (nv.priority && typeof nv.priority === 'object') {
      const p = nv.priority as { new?: string; old?: string }
      detail = t('priority_detail', { old: priorityLabel(p.old), new: priorityLabel(p.new) })
    } else if (nv.title) {
      detail = t('title_detail', { title: String(nv.title) })
    } else if (nv.assignee_name) {
      detail = t('assignee_detail', { name: String(nv.assignee_name) })
    }
  } else if (action === 'ticket.create' && nv) {
    const title = nv.title as string | undefined
    if (title) detail = `"${title}"`
  } else if (action === 'user.role_change' && ov && nv) {
    const oldRole = ov.role as string | undefined
    const newRole = nv.role as string | undefined
    if (oldRole || newRole) detail = t('role_detail', { old: roleLabel(oldRole), new: roleLabel(newRole) })
  }
  else if (action === 'update_status' && ov && nv) {
    const o = ov as Record<string, string>, n = nv as Record<string, string>
    detail = `${statusLabel(o.status)} → ${statusLabel(n.status)}`
  } else if (action === 'update_priority' && ov && nv) {
    const o = ov as Record<string, string>, n = nv as Record<string, string>
    detail = `${priorityLabel(o.priority)} → ${priorityLabel(n.priority)}`
  } else if (action === 'assign_ticket' && nv) {
    const n = nv as Record<string, string>
    detail = n.assignee_name ?? n.assignee ?? ''
  }

  return (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center shrink-0 text-sm`}>
        <span>{icon}</span>
      </div>
      <div className="text-sm flex-1">
        <span className="font-medium text-gray-700 dark:text-gray-300">{ev.actor_name ?? ev.actor_username}</span>
        <span className="text-gray-500 dark:text-gray-400">{t('by_user')}</span>
        <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {detail && <span className="text-gray-500 dark:text-gray-400"> — {detail}</span>}
        <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">{formatDate(ev.created_at)}</span>
      </div>
    </div>
  )
}

export default function TimelineView({ iid, projectId }: { iid: number; projectId?: string }) {
  const t = useTranslations('timeline')
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    fetch(`${API_BASE}/tickets/${iid}/timeline${params}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setEvents)
      .catch(err => {
        if ((err as Error).name !== 'AbortError') setError(t('load_failed'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iid, projectId])

  if (loading) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">...</p>
  }
  if (error) {
    return <p className="text-sm text-red-500 dark:text-red-400 py-8 text-center">{error}</p>
  }
  if (events.length === 0) return <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">{t('empty')}</p>

  return (
    <div className="relative space-y-6 py-2">
      <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
      {events.map((ev) => (
        <div key={ev.id} className="relative pl-1">
          {ev.type === 'comment' && <CommentEvent ev={ev} />}
          {ev.type === 'audit'   && <AuditEvent   ev={ev} />}
          {ev.type === 'system'  && <SystemEvent  ev={ev} />}
        </div>
      ))}
    </div>
  )
}
