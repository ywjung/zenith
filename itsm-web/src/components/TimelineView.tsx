'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface TimelineEvent {
  type: 'comment' | 'audit' | 'system'
  id: string
  created_at: string
  // comment
  body?: string
  author_name?: string
  author_avatar?: string
  internal?: boolean
  // audit
  action?: string
  actor_name?: string
  actor_username?: string
  old_value?: Record<string, unknown> | null
  new_value?: Record<string, unknown> | null
}

const ACTION_LABELS: Record<string, string> = {
  create_ticket: '티켓 생성',
  update_status: '상태 변경',
  update_priority: '우선순위 변경',
  update_category: '카테고리 변경',
  assign_ticket: '담당자 배정',
  close_ticket: '티켓 종료',
  reopen_ticket: '티켓 재개',
  update_title: '제목 수정',
  add_comment: '댓글 추가',
  delete_comment: '댓글 삭제',
  update_labels: '레이블 변경',
  rate_ticket: '평가 제출',
}

const ACTION_COLORS: Record<string, string> = {
  create_ticket: 'bg-blue-500',
  update_status: 'bg-purple-500',
  update_priority: 'bg-orange-500',
  close_ticket: 'bg-gray-500',
  reopen_ticket: 'bg-green-500',
  assign_ticket: 'bg-teal-500',
  rate_ticket: 'bg-yellow-500',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function Avatar({ name, url }: { name?: string; url?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name ?? ''} className="w-7 h-7 rounded-full object-cover shrink-0" />
  }
  return (
    <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

function CommentEvent({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex gap-3">
      <Avatar name={ev.author_name} url={ev.author_avatar} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800">{ev.author_name}</span>
          {ev.internal && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">내부</span>
          )}
          <span className="text-xs text-gray-400">{formatDate(ev.created_at)}</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {ev.body}
        </div>
      </div>
    </div>
  )
}

function SystemEvent({ ev }: { ev: TimelineEvent }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-100 border-2 border-gray-300 flex items-center justify-center shrink-0">
        <span className="text-gray-400 text-xs">GL</span>
      </div>
      <div className="text-sm text-gray-500 italic flex-1">
        <span className="text-gray-400">{ev.body}</span>
        <span className="ml-2 text-xs text-gray-300">{formatDate(ev.created_at)}</span>
      </div>
    </div>
  )
}

function AuditEvent({ ev }: { ev: TimelineEvent }) {
  const label = ACTION_LABELS[ev.action ?? ''] ?? ev.action ?? ''
  const color = ACTION_COLORS[ev.action ?? ''] ?? 'bg-gray-400'

  let detail = ''
  if (ev.action === 'update_status' && ev.old_value && ev.new_value) {
    const oldV = ev.old_value as Record<string, string>
    const newV = ev.new_value as Record<string, string>
    detail = `${oldV.status ?? ''} → ${newV.status ?? ''}`
  } else if (ev.action === 'update_priority' && ev.old_value && ev.new_value) {
    const oldV = ev.old_value as Record<string, string>
    const newV = ev.new_value as Record<string, string>
    detail = `${oldV.priority ?? ''} → ${newV.priority ?? ''}`
  } else if (ev.action === 'assign_ticket' && ev.new_value) {
    const newV = ev.new_value as Record<string, string>
    detail = newV.assignee_name ?? newV.assignee ?? ''
  }

  return (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center shrink-0`}>
        <span className="text-white text-xs">✦</span>
      </div>
      <div className="text-sm flex-1">
        <span className="font-medium text-gray-700">{ev.actor_name ?? ev.actor_username}</span>
        <span className="text-gray-500">이(가) </span>
        <span className="font-medium text-gray-800">{label}</span>
        {detail && <span className="text-gray-500"> — {detail}</span>}
        <span className="ml-2 text-xs text-gray-400">{formatDate(ev.created_at)}</span>
      </div>
    </div>
  )
}

export default function TimelineView({ iid, projectId }: { iid: number; projectId?: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    fetch(`${API_BASE}/tickets/${iid}/timeline${params}`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setEvents)
      .catch(() => setError('타임라인을 불러올 수 없습니다.'))
      .finally(() => setLoading(false))
  }, [iid, projectId])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 h-16 bg-gray-100 rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-500 py-4">{error}</p>
  }

  if (events.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">이벤트가 없습니다.</p>
  }

  return (
    <div className="relative">
      {/* 세로 연결선 */}
      <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200" />

      <div className="space-y-5 relative">
        {events.map(ev => (
          <div key={ev.id} className="relative">
            {ev.type === 'comment' && <CommentEvent ev={ev} />}
            {ev.type === 'system' && <SystemEvent ev={ev} />}
            {ev.type === 'audit' && <AuditEvent ev={ev} />}
          </div>
        ))}
      </div>
    </div>
  )
}
