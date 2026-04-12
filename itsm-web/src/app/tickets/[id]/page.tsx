'use client'

import { toast } from 'sonner'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { fetchTicket, fetchComments, getMyRating, updateTicket, addComment, updateComment, deleteComment, deleteTicket, fetchProjectMembers, fetchMilestones, fetchTicketCustomFields, setTicketCustomFields, uploadFile, fetchTicketLinks, createTicketLink, deleteTicketLink, fetchDevProjects, fetchForwards, createForward, deleteForward, fetchTicketSLA, updateTicketSLA, fetchLinkedMRs, subscribeTicketEvents, fetchWatchers, watchTicket, unwatchTicket, fetchQuickReplies, suggestKBArticles, fetchSLAPrediction, pauseTicketSLA, resumeTicketSLA, extendTicketSLA, fetchTicketAISummary } from '@/lib/api'
import type { AISummaryResult } from '@/lib/api'
import type { QuickReply } from '@/lib/api'
import type { Ticket, Comment, Rating, ProjectMember, Milestone, TicketCustomFieldValue, TicketLink, DevProject, ProjectForward, ForwardsResponse, SLARecord, LinkedMR, SLAPrediction } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge, SlaBadge } from '@/components/StatusBadge'
import CopyButton from '@/components/CopyButton'
import Avatar from '@/components/Avatar'
import CommentReactions from '@/components/CommentReactions'
import StarToggle from '@/components/StarToggle'
import { pushRecentTicket } from '@/lib/recentTickets'
import { markTicketRead } from '@/lib/ticketReadState'
import { useConfirm } from '@/components/ConfirmProvider'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName, formatDate, formatSmartDate, formatFileSize, getFileIcon, isImageFile, markdownToHtml } from '@/lib/utils'
import { PRIORITY_OPTIONS, API_BASE } from '@/lib/constants'
import dynamic from 'next/dynamic'
import DOMPurify from 'isomorphic-dompurify'
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false })
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false })
const ResolutionNoteModal = dynamic(() => import('@/components/ResolutionNoteModal'), { ssr: false })
import FilePreview from '@/components/FilePreview'

/** 업로드 결과 URL을 표시용 URL로 변환. MinIO URL은 직접 사용, GitLab path는 proxy 래핑. */
function toDisplayUrl(result: { proxy_path?: string; full_path?: string; url?: string }): string {
  const raw = result.proxy_path || result.full_path || result.url || ''
  // MinIO: /api/storage/... → 이미 직접 접근 가능한 URL
  if (raw.startsWith('/api/storage/') || raw.startsWith('/api/v1/storage/')) return raw
  // 외부 URL (https:// 등) → 그대로
  if (/^https?:\/\//.test(raw)) return raw
  // GitLab 내부 경로 → uploads/proxy로 래핑
  return `/api/tickets/uploads/proxy?path=${encodeURIComponent(raw)}`
}
const TimelineView = dynamic(() => import('@/components/TimelineView'), { ssr: false })
const TimeTracker = dynamic(() => import('@/components/TimeTracker'), { ssr: false })
import { useTicketWS } from '@/hooks/useTicketWS'

function StarDisplay({ score }: { score: number }) {
  return (
    <span className="text-yellow-400 text-lg">
      {'★'.repeat(score)}
      {'☆'.repeat(5 - score)}
    </span>
  )
}

// 워크플로우 단계 정의
const WORKFLOW_STEPS = [
  { key: 'open',              labelKey: 'step_open' },
  { key: 'approved',          labelKey: 'step_approved' },
  { key: 'in_progress',       labelKey: 'step_in_progress' },
  { key: 'resolved',          labelKey: 'step_resolved' },
  { key: 'testing',           labelKey: 'step_testing' },
  { key: 'ready_for_release', labelKey: 'step_ready_for_release' },
  { key: 'released',          labelKey: 'step_released' },
  { key: 'closed',            labelKey: 'step_closed' },
] as const

const STEP_INDEX: Record<string, number> = {
  open:              0,
  approved:          1,
  waiting:           2,
  in_progress:       2,
  resolved:          3,
  testing:           4,
  ready_for_release: 5,
  released:          6,
  closed:            7,
}

function WorkflowStepper({ status, state }: { status: string | undefined; state: string }) {
  const t = useTranslations('ticket_detail')
  const effectiveStatus = state === 'closed' ? 'closed' : (status ?? 'open')
  const currentIdx = STEP_INDEX[effectiveStatus] ?? 0
  const isWaiting = effectiveStatus === 'waiting'

  return (
    <div className="py-1">
      {WORKFLOW_STEPS.map((step, i) => {
        const isDone = i < currentIdx
        const isCurrent = i === currentIdx
        const isCurrentWaiting = isCurrent && isWaiting && i === 2
        const label = isWaiting && i === 2 ? t('step_waiting') : t(step.labelKey as 'step_open')
        const isLast = i === WORKFLOW_STEPS.length - 1

        return (
          <div key={step.key} className="flex gap-3">
            {/* 타임라인 열 */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                  isDone
                    ? 'bg-blue-500 border-blue-500 text-white'
                    : isCurrent
                    ? isCurrentWaiting
                      ? 'bg-orange-400 border-orange-400 text-white'
                      : 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-300 dark:text-gray-600'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              {!isLast && (
                <div className={`w-px h-5 my-0.5 ${isDone ? 'bg-blue-300' : 'bg-gray-200 dark:bg-gray-700'}`} />
              )}
            </div>

            {/* 라벨 열 */}
            <div className={`pt-0.5 pb-1 text-sm leading-none ${
              isCurrent
                ? isCurrentWaiting
                  ? 'text-orange-500 font-semibold'
                  : 'text-blue-600 font-semibold'
                : isDone
                ? 'text-gray-400 dark:text-gray-500 font-medium'
                : 'text-gray-300 dark:text-gray-600 font-medium'
            }`}>
              {label}
              {isCurrent && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  isCurrentWaiting ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-500' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                }`}>{t('step_current_badge')}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


interface DescPart {
  type: 'text' | 'image' | 'file'
  content: string
  url?: string
  name?: string
}

/**
 * 설명(description)에서 본문과 파일 첨부 링크를 분리한다.
 * 티켓 생성 시 파일들은 설명 맨 뒤에 마크다운 링크로 추가된다.
 *   비이미지: [📎 name](url)
 *   이미지  : ![name](url)  ← 인라인 이미지이므로 본문에 남김
 * HTML 형식(TipTap)도 동일하게 뒤쪽 마크다운 줄을 파싱한다.
 */
// H4: target="_blank" 링크에 rel="noopener noreferrer" 강제 적용 (Tabnapping 방지)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof Element && node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// CRIT-03: 커스텀 regex sanitizer 제거 → isomorphic-dompurify로 교체
function _sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'i', 'strong', 'em', 'u', 's', 'strike',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'img', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:|\/|#)/i,
  })
}

function splitBodyAndAttachments(
  description: string,
  projectPath?: string,
): { body: string; attachments: { name: string; url: string }[] } {
  const lines = description.split('\n')
  // 뒤에서부터 비이미지 첨부 링크 줄을 추출 (마크다운 형식)
  const attachments: { name: string; url: string }[] = []
  let splitIdx = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (!trimmed) { splitIdx = i; continue }
    const m = trimmed.match(/^\[(?:📎\s*)?(.+?)\]\(([^)]+)\)$/)
    if (m && !trimmed.startsWith('!')) {
      const name = m[1].replace(/^📎\s*/, '').trim()
      let url = m[2].replace(/[&?]download=true/, '')
      if (url.startsWith('/uploads/') && projectPath) {
        url = `/api/tickets/uploads/proxy?path=${encodeURIComponent(`/${projectPath}${url}`)}`
      }
      attachments.unshift({ name, url })
      splitIdx = i
    } else {
      break
    }
  }
  let body = lines.slice(0, splitIdx).join('\n').trimEnd()

  // HTML body 안에 포함된 proxy URL <a> 링크를 추출 (PDF 등 비이미지 파일)
  // 형식: <p><a href="/api/tickets/uploads/proxy?...">📎 name</a></p>
  const proxyLinkRe = /<p>\s*<a\s+href="(\/api\/tickets\/uploads\/proxy\?[^"]+)"[^>]*>(?:📎\s*)?([^<]+)<\/a>\s*<\/p>/gi
  const htmlAttachments: { name: string; url: string }[] = []
  body = body.replace(proxyLinkRe, (_match, url, name) => {
    htmlAttachments.push({ name: name.replace(/^📎\s*/, '').trim(), url: url.replace(/&amp;/g, '&') })
    return ''
  })
  attachments.unshift(...htmlAttachments)

  return { body: body.trim(), attachments }
}

// ---------------------------------------------------------------------------
// 승인 요청 패널
// ---------------------------------------------------------------------------
interface ApprovalRequest {
  id: number
  status: string
  requester_username: string
  requester_name: string | null
  approver_username: string | null
  approver_name: string | null
  reason: string | null
  approved_at: string | null
  created_at: string
}

function ApprovalPanel({ ticketIid, projectId, isAgent, currentUsername, ticketStatus }: { ticketIid: number; projectId: string; isAgent: boolean; currentUsername?: string; ticketStatus?: string }) {
  const t = useTranslations('ticket_detail')
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [noAccess, setNoAccess] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState<number | null>(null)
  const approvalBase = `${API_BASE}/approvals`

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`${approvalBase}?ticket_iid=${ticketIid}`, { credentials: 'include' })
      if (res.status === 403) { setNoAccess(true); return }
      if (res.ok) setApprovals(await res.json())
      else setLoadError(true)
    } catch { setLoadError(true) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [ticketIid])

  const pending = approvals.filter(a => a.status === 'pending')
  const hasPending = pending.length > 0

  async function handleCreate() {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(approvalBase, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_iid: ticketIid, project_id: projectId }),
      })
      if (res.ok) { await load() }
      else {
        const data = await res.json().catch(() => ({}))
        setCreateError(data.detail || t('approval_request_failed', { status: res.status }))
      }
    } catch { setCreateError(t('approval_network_error')) }
    finally { setCreating(false) }
  }

  async function handleApprove(id: number) {
    setActionId(id)
    setActionError(null)
    try {
      const res = await fetch(`${approvalBase}/${id}/approve`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      })
      if (res.ok) await load()
      else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.detail || t('approval_approve_failed', { status: res.status }))
      }
    } catch { setActionError(t('approval_network_error')) }
    finally { setActionId(null) }
  }

  async function handleReject(id: number) {
    setActionId(id)
    setActionError(null)
    try {
      const res = await fetch(`${approvalBase}/${id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (res.ok) { setShowRejectForm(null); setReason(''); await load() }
      else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.detail || t('approval_reject_failed', { status: res.status }))
      }
    } catch { setActionError(t('approval_network_error')) }
    finally { setActionId(null) }
  }

  if (loading) return null
  if (noAccess) return null
  if (loadError) return <p className="text-xs text-red-500 py-2">{t('approval_load_failed')}</p>

  const latest = approvals[0]
  // 승인 요청 버튼: 이미 승인·종료·배포 상태이면 숨김
  const noRequestNeeded = ['approved', 'closed', 'released', 'ready_for_release'].includes(ticketStatus || '')
  if (!hasPending && !latest) {
    if (noRequestNeeded) return null
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t('approval_header')}</h3>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full text-xs bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? t('approval_creating') : t('approval_request')}
        </button>
        {createError && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-1.5">{createError}</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t('approval_header')}</h3>
      {approvals.slice(0, 3).map(req => (
        <div key={req.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              req.status === 'approved' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
              req.status === 'rejected' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' :
              'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
            }`}>
              {req.status === 'approved' ? t('approval_status_approved') : req.status === 'rejected' ? t('approval_status_rejected') : t('approval_status_pending')}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{req.requester_name || req.requester_username}</span>
          </div>
          {req.reason && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">&ldquo;{req.reason}&rdquo;</p>
          )}

          {isAgent && req.status === 'pending' && (
            <div className="mt-2 flex flex-col gap-1">
              {showRejectForm === req.id ? (
                <>
                  <input
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder={t('approval_reject_reason_placeholder')}
                    className="text-xs border dark:border-gray-600 rounded px-2 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-red-400"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleReject(req.id)}
                      disabled={actionId === req.id}
                      className="flex-1 text-xs bg-red-500 hover:bg-red-600 text-white py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionId === req.id ? '...' : t('approval_reject_confirm')}
                    </button>
                    <button onClick={() => { setShowRejectForm(null); setActionError(null) }} className="text-xs px-2 py-1 border dark:border-gray-600 rounded text-gray-500 dark:text-gray-400">{t('approval_cancel')}</button>
                  </div>
                </>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={() => { setActionError(null); handleApprove(req.id) }}
                    disabled={actionId === req.id}
                    className="flex-1 text-xs bg-green-500 hover:bg-green-600 text-white py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionId === req.id ? '...' : t('approval_approve')}
                  </button>
                  <button
                    onClick={() => { setActionError(null); setShowRejectForm(req.id) }}
                    className="flex-1 text-xs bg-red-100 dark:bg-red-900/30 hover:bg-red-200 text-red-600 dark:text-red-400 py-1 rounded"
                  >
                    {req.requester_username === currentUsername ? t('approval_cancel_own') : t('approval_reject')}
                  </button>
                </div>
              )}
              {actionError && actionId === null && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{actionError}</p>
              )}
            </div>
          )}
        </div>
      ))}
      {!hasPending && (
        <>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full text-xs text-purple-600 dark:text-purple-400 hover:underline mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? t('approval_creating') : t('approval_re_request')}
          </button>
          {createError && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-1">{createError}</p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 티켓 타입 + 문제 관리 패널
// ---------------------------------------------------------------------------

const TICKET_TYPES = [
  { value: 'incident',        labelKey: 'type_incident',        color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  { value: 'service_request', labelKey: 'type_service_request', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  { value: 'change',          labelKey: 'type_change',          color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  { value: 'problem',         labelKey: 'type_problem',         color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
]

function TicketTypePanel({
  ticketIid, projectId, isAgent,
}: { ticketIid: number; projectId: string; isAgent: boolean }) {
  const t = useTranslations('ticket_detail')
  const [ticketType, setTicketType] = useState('incident')
  const [updatedBy, setUpdatedBy] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problemLinks, setProblemLinks] = useState<{ id: number; target_iid: number; source_iid: number; link_type: string }[]>([])
  const [linkInput, setLinkInput] = useState('')
  const [linking, setLinking] = useState(false)
  const base = `${API_BASE}/ticket-types`
  const linksBase = `${API_BASE}/tickets/${ticketIid}/links`

  async function loadType() {
    try {
      const r = await fetch(`${base}/${ticketIid}?project_id=${encodeURIComponent(projectId)}`, { credentials: 'include' })
      if (r.ok) {
        const d = await r.json()
        setTicketType(d.ticket_type)
        setUpdatedBy(d.updated_by ?? null)
        setUpdatedAt(d.updated_at ?? null)
      }
    } catch { /* ignore */ }
  }

  async function loadProblemLinks() {
    try {
      const r = await fetch(`${linksBase}?project_id=${encodeURIComponent(projectId)}`, { credentials: 'include' })
      if (r.ok) {
        const all = await r.json()
        setProblemLinks(all.filter((l: { link_type: string }) => l.link_type === 'problem_of'))
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadType()
    if (isAgent) loadProblemLinks()
  }, [ticketIid])

  async function handleTypeChange(type: string) {
    setSaving(true)
    try {
      const r = await fetch(`${base}/${ticketIid}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_type: type, project_id: projectId }),
      })
      if (r.ok) {
        const d = await r.json()
        setTicketType(d.ticket_type)
        setUpdatedBy(d.updated_by ?? null)
        setUpdatedAt(d.updated_at ?? null)
        setEditing(false)
      }
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function handleAddProblemLink() {
    const targetIid = parseInt(linkInput, 10)
    if (!targetIid) return
    setLinking(true)
    try {
      const r = await fetch(linksBase, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_iid: targetIid, project_id: projectId, link_type: 'problem_of' }),
      })
      if (r.ok) { setLinkInput(''); await loadProblemLinks() }
    } catch { /* ignore */ }
    finally { setLinking(false) }
  }

  async function handleRemoveProblemLink(linkId: number) {
    try {
      await fetch(`${linksBase}/${linkId}?project_id=${encodeURIComponent(projectId)}`, { method: 'DELETE', credentials: 'include' })
      await loadProblemLinks()
    } catch { /* ignore */ }
  }

  const typeMeta = TICKET_TYPES.find(t => t.value === ticketType)
  const isProblem = ticketType === 'problem'

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('type_title')}</h3>
        {isAgent && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
          >
            {t('type_change_btn')}
          </button>
        )}
      </div>

      {/* 현재 유형 배지 */}
      {!editing && (
        <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${typeMeta?.color || ''}`}>
          {typeMeta ? t(typeMeta.labelKey as 'type_incident') : ticketType}
        </span>
      )}

      {/* 에이전트: 편집 모드 */}
      {isAgent && editing && (
        <div className="space-y-2">
          {TICKET_TYPES.map(tp => (
            <button
              key={tp.value}
              onClick={() => handleTypeChange(tp.value)}
              disabled={saving}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                ticketType === tp.value
                  ? `${tp.color} border-current font-semibold`
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
            >
              {t(tp.labelKey as 'type_incident')}
              {ticketType === tp.value && <span className="float-right">✓</span>}
            </button>
          ))}
          <button
            onClick={() => setEditing(false)}
            className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 py-1"
          >
            {t('type_cancel_btn')}
          </button>
        </div>
      )}

      {/* 마지막 변경 정보 */}
      {updatedBy && !editing && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {updatedBy} ·{' '}
          {updatedAt
            ? new Date(updatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : ''}
        </p>
      )}

      {/* 문제 유형: 연결된 티켓/변경 관리 */}
      {isAgent && isProblem && (
        <div className="pt-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('linked_problem_tickets')}</p>
          {problemLinks.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('none_label')}</p>
          ) : (
            <ul className="space-y-1 mb-2">
              {problemLinks.map(l => {
                const linked = l.source_iid === ticketIid ? l.target_iid : l.source_iid
                return (
                  <li key={l.id} className="flex items-center justify-between text-xs">
                    <a href={`/tickets/${linked}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      #{linked}
                    </a>
                    <button
                      onClick={() => handleRemoveProblemLink(l.id)}
                      className="text-gray-400 hover:text-red-500 ml-2"
                     aria-label={t('remove_aria')}>✕</button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex gap-1">
            <input
              type="number"
              placeholder={t('iid_placeholder')}
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              className="flex-1 text-xs border dark:border-gray-600 rounded px-2 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleAddProblemLink}
              disabled={linking || !linkInput}
              className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {linking ? t('linking_in_progress') : t('link_btn')}
            </button>
          </div>
        </div>
      )}

      {/* 일반/변경 유형: 연결된 문제 */}
      {isAgent && !isProblem && problemLinks.length > 0 && (
        <div className="pt-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('linked_problems_label')}</p>
          <ul className="space-y-1">
            {problemLinks.map(l => {
              const linked = l.source_iid === ticketIid ? l.target_iid : l.source_iid
              return (
                <li key={l.id} className="text-xs">
                  <a href={`/tickets/${linked}`} className="text-orange-600 dark:text-orange-400 hover:underline">
                    {t('linked_problem_item', { iid: linked })}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}


/** HTML에서 인라인 <img> 목록 추출 */
function extractInlineImages(html: string): { src: string; alt: string }[] {
  const result: { src: string; alt: string }[] = []
  const re = /<img([^>]*)>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1]
    const src = (attrs.match(/src="([^"]*)"/) || [])[1] || ''
    const alt = (attrs.match(/alt="([^"]*)"/) || [])[1] || ''
    if (src) result.push({ src, alt })
  }
  return result
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** HTML에서 특정 src를 가진 <img> 태그 제거 */
function deleteImageBySrc(html: string, src: string): string {
  // img 태그 전체 + 그것만 있는 빈 <p>/<figure> 정리
  let result = html.replace(new RegExp(`<img[^>]*src="${escRe(src)}"[^>]*>`, 'i'), '')
  // 빈 단락 정리: <p></p> 또는 <p><br></p> 등
  result = result.replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/gi, '')
  return result
}

/** HTML에서 특정 src를 새 src로 교체 */
function replaceImageSrc(html: string, oldSrc: string, newSrc: string): string {
  return html.replace(new RegExp(`(<img[^>]*src=")${escRe(oldSrc)}(")`,'i'), `$1${newSrc}$2`)
}

function parseDescParts(text: string, projectPath?: string): DescPart[] {
  const parts: DescPart[] = []
  const pattern = /(!?\[(.+?)\]\(([^)\s]+)\))/g
  let lastIndex = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    const isImg = match[1].startsWith('!')
    const name = match[2].replace(/^📎\s*/, '')
    const rawUrl = match[3]
    // download=true 제거해서 baseUrl 정규화 (뷰 URL과 다운로드 URL을 별도 관리)
    const baseUrl = rawUrl.replace(/[&?]download=true/, '')

    if (rawUrl.includes('/tickets/uploads/proxy')) {
      parts.push({ type: isImg ? 'image' : 'file', content: match[1], url: baseUrl, name })
    } else if (rawUrl.startsWith('/uploads/') && projectPath) {
      const proxyUrl = `/api/tickets/uploads/proxy?path=${encodeURIComponent(`/${projectPath}${rawUrl}`)}`
      parts.push({ type: isImg ? 'image' : 'file', content: match[1], url: proxyUrl, name })
    } else {
      parts.push({ type: 'text', content: match[1] })
    }
    lastIndex = match.index + match[1].length
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return parts
}

function AttachmentFileItem({
  url,
  name,
  onImageClick,
}: {
  url: string
  name: string
  onImageClick?: (url: string, name: string) => void
}) {
  const t = useTranslations('ticket_detail')
  const isImg = isImageFile(name)
  if (isImg) {
    return (
      <div className="border dark:border-gray-700 rounded-lg overflow-hidden max-w-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className={`max-w-full max-h-80 object-contain block bg-gray-50 dark:bg-gray-800 w-full${onImageClick ? ' cursor-zoom-in hover:opacity-90 transition-opacity' : ''}`}
          onClick={() => onImageClick?.(url, name)}
          onError={(e) => {
            const el = e.currentTarget
            el.style.display = 'none'
            const fb = el.nextSibling as HTMLElement
            if (fb) fb.style.display = 'block'
          }}
        />
        <div style={{ display: 'none' }} className="bg-gray-100 dark:bg-gray-700 px-3 py-4 text-center text-gray-400 text-sm">
          {t('img_load_failed')}{' '}
          <a href={`${url}&download=true`} download className="text-blue-500 hover:underline">{name}</a>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{name}</span>
          <a href={`${url}&download=true`} download className="text-xs text-blue-600 dark:text-blue-400 hover:underline shrink-0">{t('download_btn')}</a>
        </div>
      </div>
    )
  }
  // PDF — FilePreview 컴포넌트로 인라인 미리보기
  if (/\.pdf$/i.test(name)) {
    return (
      <div className="max-w-lg">
        <FilePreview url={url} name={name} mime="application/pdf" />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 rounded-lg px-3 py-2 max-w-lg">
      <span className="text-lg shrink-0">{getFileIcon(name)}</span>
      <span className="text-sm text-gray-700 dark:text-gray-200 flex-1 truncate">{name}</span>
      <a href={`${url}&download=true`} download className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 px-2.5 py-1 rounded shrink-0">
        {t('download_btn')}
      </a>
    </div>
  )
}

function DescriptionWithAttachments({
  description,
  projectPath,
  onImageClick,
}: {
  description: string
  projectPath?: string
  onImageClick?: (url: string, name: string) => void
}) {
  const t = useTranslations('ticket_detail')
  const isHtml = /^\s*<[a-zA-Z]/.test(description)

  if (isHtml) {
    // HTML 본문 + 뒤쪽 마크다운 첨부 링크 분리
    const { body, attachments } = splitBodyAndAttachments(description, projectPath)
    return (
      <div className="space-y-3">
        <div className="prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert" dangerouslySetInnerHTML={{ __html: _sanitizeHtml(body) }} />
        {attachments.length > 0 && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">{t('attachments_label')}</p>
            {attachments.map((att, i) => (
              <AttachmentFileItem key={i} url={att.url} name={att.name} onImageClick={onImageClick} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // 레거시 마크다운 형식 처리
  const parts = parseDescParts(description, projectPath)
  if (!parts.some((p) => p.content.trim())) return null

  // 텍스트/이미지 파트와 파일 파트를 분리해 렌더링
  const textAndImageParts = parts.filter((p) => p.type === 'text' || p.type === 'image')
  const fileParts = parts.filter((p) => p.type === 'file')

  return (
    <div className="space-y-3">
      {textAndImageParts.map((part, i) => {
        if (part.type === 'text') {
          return part.content.trim() ? <MarkdownRenderer key={i} content={part.content} /> : null
        }
        return <AttachmentFileItem key={i} url={part.url!} name={part.name!} onImageClick={onImageClick} />
      })}
      {fileParts.length > 0 && (
        <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">첨부 파일</p>
          {fileParts.map((part, i) => (
            <AttachmentFileItem key={i} url={part.url!} name={part.name!} onImageClick={onImageClick} />
          ))}
        </div>
      )}
    </div>
  )
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const t = useTranslations('ticket_detail')
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/85 animate-fadeIn backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-8 right-0 text-white/70 hover:text-white text-sm"
        >
          {t('close_esc')}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-w-full max-h-[80vh] object-contain rounded shadow-2xl" />
        <div className="flex items-center gap-4 mt-3">
          <span className="text-white/60 text-sm truncate max-w-xs">{name}</span>
          <a
            href={`${url}&download=true`}
            download
            onClick={(e) => e.stopPropagation()}
            className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded transition-colors"
          >
            {t('download_btn')}
          </a>
        </div>
      </div>
    </div>
  )
}


// Quick replies are loaded dynamically from the server (fallback to built-in)
const BUILTIN_QUICK_REPLIES: QuickReply[] = [
  { id: -1, name: '처리 시작 안내', content: '안녕하세요. 접수하신 티켓을 확인하였습니다. 현재 담당자가 배정되어 처리를 시작하였습니다. 처리 진행 상황은 이 티켓을 통해 안내드리겠습니다.', category: null, created_by: '', created_at: null },
  { id: -2, name: '추가 정보 요청', content: '안녕하세요. 원활한 처리를 위해 추가 정보가 필요합니다.\n\n1. 문제가 발생한 정확한 시간\n2. 오류 메시지 또는 스크린샷\n3. 이전에 시도해보신 해결 방법\n\n위 정보를 댓글로 남겨주시면 신속하게 처리하겠습니다.', category: null, created_by: '', created_at: null },
  { id: -3, name: '처리 완료 안내', content: '안녕하세요. 요청하신 사항에 대한 처리가 완료되었습니다.\n\n처리 내용을 확인하신 후 문제가 해결되었으면 티켓을 종료해 주시기 바랍니다. 추가 문의사항이 있으시면 언제든지 말씀해 주세요.', category: null, created_by: '', created_at: null },
  { id: -4, name: '처리 지연 안내', content: '안녕하세요. 요청하신 사항을 처리 중입니다만, 예상보다 시간이 걸리고 있습니다.\n\n처리가 완료되는 즉시 안내드리겠습니다. 불편을 드려 죄송합니다.', category: null, created_by: '', created_at: null },
  { id: -5, name: '재발 방지 완료', content: '안녕하세요. 이번 문제에 대한 처리 및 재발 방지 조치가 완료되었습니다.\n\n동일한 문제가 재발하는 경우 즉시 신규 티켓을 등록해 주시기 바랍니다. 감사합니다.', category: null, created_by: '', created_at: null },
]

function TicketDetailContent() {
  const t = useTranslations('ticket_detail')
  const confirm = useConfirm()
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const iid = Number(params.id)
  const projectId = searchParams.get('project_id') || undefined
  const { user, isDeveloper, isAgent, isAdmin } = useAuth()
  const { serviceTypes } = useServiceTypes()
  const { viewers, typingUsers, sendTyping } = useTicketWS(iid)

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentTab, setCommentTab] = useState<'comments' | 'timeline'>('comments')
  const [rating, setRating] = useState<Rating | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [customFields, setCustomFields] = useState<TicketCustomFieldValue[]>([])
  const [customFieldEdits, setCustomFieldEdits] = useState<Record<string, string>>({})
  const [savingCustomFields, setSavingCustomFields] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [resolutionModal, setResolutionModal] = useState<'resolved' | 'closed' | null>(null)
  const [waitingReasonModal, setWaitingReasonModal] = useState(false)
  const [waitingReasonInput, setWaitingReasonInput] = useState('')
  const [pendingReasonStatus, setPendingReasonStatus] = useState<string>('waiting')
  const ticketEtag = useRef<string>('')
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [savingComment, setSavingComment] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [mergeTargetIid, setMergeTargetIid] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergeSuccess, setMergeSuccess] = useState(false)
  const [pipelineRef, setPipelineRef] = useState('main')
  const [triggeringPipeline, setTriggeringPipeline] = useState(false)
  const [pipelineResult, setPipelineResult] = useState<{id: number; web_url: string; status: string} | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [pipelines, setPipelines] = useState<{id: number; ref: string; status: string; web_url: string; created_at: string}[]>([])
  const [newComment, setNewComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', description: '', category: '' })
  const [editAttachments, setEditAttachments] = useState<{ name: string; url: string }[]>([])
  const [editNewFiles, setEditNewFiles] = useState<File[]>([])
  const [editIsDragging, setEditIsDragging] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const changingImageSrcRef = useRef<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [commentUploading, setCommentUploading] = useState(false)
  const [commentIsDragging, setCommentIsDragging] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  // SLA state
  const [slaRecord, setSlaRecord] = useState<SLARecord | null>(null)
  const [slaEditDate, setSlaEditDate] = useState('')
  const [slaSaving, setSlaSaving] = useState(false)
  const [slaError, setSlaError] = useState<string | null>(null)
  const [slaPrediction, setSlaPrediction] = useState<SLAPrediction | null>(null)
  const [slaPausing, setSlaPausing] = useState(false)
  const [slaResuming, setSlaResuming] = useState(false)
  const [slaExtendMinutes, setSlaExtendMinutes] = useState('60')
  const [slaExtending, setSlaExtending] = useState(false)
  const [aiSummary, setAiSummary] = useState<AISummaryResult | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null)

  // Linked tickets state
  const [links, setLinks] = useState<TicketLink[]>([])
  const [linkTargetIid, setLinkTargetIid] = useState('')
  const [linkType, setLinkType] = useState('relates_to')
  const [addingLink, setAddingLink] = useState(false)

  // Project forwarding state
  const [devProjects, setDevProjects] = useState<DevProject[]>([])
  const [forwards, setForwards] = useState<ProjectForward[]>([])
  const [forwardsAllClosed, setForwardsAllClosed] = useState(false)
  const [selectedDevProject, setSelectedDevProject] = useState('')
  const [forwardNote, setForwardNote] = useState('')
  const [forwarding, setForwarding] = useState(false)

  // G-2: Linked MRs (agent+ only)
  const [linkedMRs, setLinkedMRs] = useState<LinkedMR[]>([])
  const [sideTab, setSideTab] = useState<'links' | 'time' | 'forward' | 'mr' | 'pipeline'>('links')

  // Watcher subscription
  const [isWatching, setIsWatching] = useState(false)
  const [watchLoading, setWatchLoading] = useState(false)

  // Quick replies (dynamic from server)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(BUILTIN_QUICK_REPLIES)

  // Resolution note
  const [resolutionNote, setResolutionNote] = useState<{
    id?: number; note?: string; resolution_type?: string;
    created_by_name?: string; created_at?: string; kb_article_id?: number | null;
  } | null>(null)
  const [convertingToKb, setConvertingToKb] = useState(false)
  const [kbConvertError, setKbConvertError] = useState<string | null>(null)
  const [kbSuggestions, setKbSuggestions] = useState<import('@/types').KBArticle[]>([])

  const isRequester = !!user && !!ticket?.created_by_username && user.username === ticket.created_by_username
  const canDelete = isAdmin || (ticket?.status === 'open' && isRequester)
  const canEdit = isDeveloper || (ticket?.status === 'open' && isRequester)

  useEffect(() => {
    if (!iid) return
    // Phase 1: 렌더링에 필요한 코어 데이터 + project_id 비의존 보조 데이터 병렬 fetch
    // (watchers/quickReplies/devProjects는 ticket 응답을 기다릴 필요가 없음)
    Promise.all([fetchTicket(iid, projectId), fetchComments(iid, projectId), getMyRating(iid)])
      .then(([t, c, r]) => {
        ticketEtag.current = t.updated_at ?? ''
        setTicket(t)
        setComments(c)
        setRating(r)
        // project_id 비의존 호출을 즉시 발사 (ticket 응답 대기 불필요)
        if (user) {
          fetchWatchers(iid).then((watchers) => {
            setIsWatching(watchers.some((w) => w.user_id === user.sub))
          }).catch(() => {})
        }
        if (isAgent) {
          fetchDevProjects().then(setDevProjects).catch(() => {})
          fetchQuickReplies().then((replies) => {
            setQuickReplies(replies.length > 0 ? replies : BUILTIN_QUICK_REPLIES)
          }).catch(() => {})
        }
        // 최근 본 티켓에 추가 + 읽음 처리
        pushRecentTicket({ iid: t.iid, title: t.title, status: t.status, project_id: t.project_id })
        markTicketRead(t.iid)
        if (t.project_id) {
          fetchProjectMembers(t.project_id).then(setMembers).catch(() => {})
          fetchMilestones(t.project_id).then(setMilestones).catch(() => {})
          fetchTicketCustomFields(iid, t.project_id).then(fields => {
            setCustomFields(fields)
            setCustomFieldEdits(Object.fromEntries(fields.map(f => [String(f.id), f.value ?? ''])))
          }).catch(() => {})
          // KB 관련 문서 추천 (에이전트 이상) — 제목+카테고리+설명 발췌로 관련성 향상
          if (t.title) {
            const descExcerpt = (t.description || '').replace(/[#*`>\[\]()\-_~|!]/g, ' ').trim().slice(0, 200)
            suggestKBArticles(t.title, 3, t.category, descExcerpt || undefined).then(setKbSuggestions).catch(() => {})
          }
          if (isDeveloper || isAgent) {
            fetchTicketLinks(iid, t.project_id).then(setLinks).catch(() => {})
            fetchForwards(iid, t.project_id).then((res) => {
              setForwards(res.forwards)
              setForwardsAllClosed(res.all_closed)
            }).catch(() => {})
            fetchTicketSLA(iid, t.project_id).then((rec) => {
              if (!rec) return
              setSlaRecord(rec)
              const today = new Date().toISOString().split('T')[0]
              const deadline = rec.sla_deadline?.split('T')[0]
              setSlaEditDate(deadline && deadline >= today ? deadline : today)
            }).catch(() => {})
            // 오픈 티켓에서만 예측 요청 (closed/resolved 제외)
            if (t.state !== 'closed') {
              fetchSLAPrediction(iid, t.project_id).then(setSlaPrediction).catch(() => {})
            }
          }
          if (isAgent) {
            fetchLinkedMRs(iid, t.project_id).then(setLinkedMRs).catch(() => {})
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [iid, projectId, isDeveloper, isAgent, user])

  // 파이프라인 탭 선택 시 목록 로드
  useEffect(() => {
    if (sideTab !== 'pipeline' || !isAgent || !iid) return
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    fetch(`${API_BASE}/tickets/${iid}/pipelines?${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPipelines)
      .catch(() => {})
  }, [sideTab, iid, isAgent, projectId])

  // 전달 이슈가 있을 때 30초마다 상태 자동 갱신 (웹훅 보완용 폴링)
  useEffect(() => {
    if (!iid || !isDeveloper || !ticket?.project_id) return
    // forwards.length를 dependency에서 제외 — early return 시 cleanup 누락 방지
    // interval 내부에서 최신 값을 읽으므로 forwards가 0이면 즉시 반환
    const pid = ticket.project_id
    const timer = setInterval(() => {
      fetchTicket(iid, pid).then(t => { ticketEtag.current = t.updated_at ?? ''; setTicket(t) }).catch(() => {})
      fetchForwards(iid, pid).then((res) => {
        setForwards(res.forwards)
        setForwardsAllClosed(res.all_closed)
      }).catch(() => {})
    }, 30_000)

    return () => clearInterval(timer)
  }, [iid, isDeveloper, ticket?.project_id])

  // 티켓 실시간 SSE 구독 — 웹훅으로 상태가 바뀌면 즉시 갱신
  useEffect(() => {
    if (!iid || !ticket?.project_id) return
    const pid = ticket.project_id
    const unsubscribe = subscribeTicketEvents(String(iid), pid, () => {
      fetchTicket(iid, pid).then(t => { ticketEtag.current = t.updated_at ?? ''; setTicket(t) }).catch(() => {})
      if (isDeveloper) {
        fetchForwards(iid, pid).then((res) => {
          setForwards(res.forwards)
          setForwardsAllClosed(res.all_closed)
        }).catch(() => {})
      }
    })
    return unsubscribe
  }, [iid, ticket?.project_id, isDeveloper])

  // 해결 노트 조회 (resolved/closed 상태일 때)
  useEffect(() => {
    if (!ticket) return
    const ticketIsResolved = ticket.status === 'resolved'
    const ticketIsClosed = ticket.state === 'closed'
    if (!ticketIsResolved && !ticketIsClosed) return
    const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    fetch(`${API_BASE}/tickets/${iid}/resolution${params}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && data.id) setResolutionNote(data) })
      .catch(() => {})
  }, [iid, projectId, ticket?.status, ticket?.state])

  async function handleStatusChange(newStatus: string) {
    if (!ticket) return
    // resolved/closed 전환 시 해결 노트 모달 표시 (에이전트 이상)
    if ((newStatus === 'resolved' || newStatus === 'closed') && isAgent) {
      setResolutionModal(newStatus as 'resolved' | 'closed')
      return
    }
    // waiting/reopened 전환 시 이유 입력 모달 표시 (백엔드 REASON_REQUIRED_TRANSITIONS)
    if (newStatus === 'waiting' || newStatus === 'reopened') {
      setWaitingReasonInput('')
      setWaitingReasonModal(true)
      setPendingReasonStatus(newStatus)
      return
    }
    await _doStatusChange(newStatus, '', '', '')
  }

  async function _doStatusChange(newStatus: string, note: string, type: string, reason: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      const updated = await updateTicket(
        iid,
        { status: newStatus, resolution_note: note || undefined, resolution_type: type || undefined, change_reason: reason || undefined },
        projectId,
        ticketEtag.current || undefined,
      )
      // ETag 저장 (다음 수정 시 낙관적 락에 활용)
      if (updated._etag) ticketEtag.current = updated._etag
      setTicket(updated)
      const updatedComments = await fetchComments(iid, projectId)
      setComments(updatedComments)
      // UX2 #4: 처리완료 전환 시 만족도 평가 안내
      if (newStatus === 'resolved') {
        toast(t('resolved_toast_title'), {
          description: t('resolved_toast_desc'),
          action: {
            label: t('resolved_toast_action'),
            onClick: () => window.open(`/tickets/${iid}/rate`, '_blank'),
          },
          duration: 6000,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('err_status_change')
      // 409 Conflict = 동시 편집 충돌
      if (msg.includes(t('conflict_message'))) {
        setActionError('⚠️ ' + msg)
      } else {
        setActionError(msg)
      }
    } finally {
      setUpdating(false)
    }
  }

  async function handlePriorityChange(newPriority: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      const updated = await updateTicket(iid, { priority: newPriority }, projectId)
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_priority_change'))
    } finally {
      setUpdating(false)
    }
  }

  async function handleCategoryChange(newCategory: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      const updated = await updateTicket(iid, { category: newCategory }, projectId)
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_service_type_change'))
    } finally {
      setUpdating(false)
    }
  }

  async function handleAssigneeChange(assigneeId: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      // -1 means unassign
      const id = assigneeId === '' ? -1 : Number(assigneeId)
      const updated = await updateTicket(iid, { assignee_id: id }, projectId)
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_assignee_change'))
    } finally {
      setUpdating(false)
    }
  }

  async function handleSaveCustomFields() {
    if (!ticket) return
    setSavingCustomFields(true)
    try {
      const updated = await setTicketCustomFields(iid, customFieldEdits, projectId)
      setCustomFields(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_custom_fields_save'))
    } finally {
      setSavingCustomFields(false)
    }
  }

  async function handleMilestoneChange(milestoneId: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      // 0 means remove milestone
      const id = milestoneId === '' ? 0 : Number(milestoneId)
      const updated = await updateTicket(iid, { milestone_id: id }, projectId)
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_milestone_change'))
    } finally {
      setUpdating(false)
    }
  }

  function startEdit() {
    if (!ticket) return
    const { body, attachments } = splitBodyAndAttachments(ticket.description || '', ticket.project_path)
    // 마크다운이면 HTML로 변환해서 editForm.description을 항상 HTML로 유지
    const htmlBody = /^\s*<[a-zA-Z]/.test(body) ? body : markdownToHtml(body)
    setEditForm({ title: ticket.title, description: htmlBody, category: ticket.category || 'software' })
    setEditAttachments(attachments)
    setEditNewFiles([])
    changingImageSrcRef.current = null
    setIsEditing(true)
  }

  function addEditFiles(selected: File[]) {
    setEditNewFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))]
    })
  }

  function handleEditFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setEditIsDragging(false)
    addEditFiles(Array.from(e.dataTransfer.files))
  }

  async function handleEditImageUpload(file: File): Promise<string> {
    const result = await uploadFile(file, ticket?.project_id || projectId)
    return toDisplayUrl(result)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ticket) return
    setEditSaving(true)
    setActionError(null)
    try {
      // 새 파일 업로드
      const uploaded: { name: string; url: string }[] = []
      for (const file of editNewFiles) {
        const result = await uploadFile(file, ticket.project_id || projectId)
        const url = toDisplayUrl(result)
        uploaded.push({ name: file.name, url })
      }

      // 본문 + 남은 첨부 링크 재조합
      const allAttachments = [...editAttachments, ...uploaded]
      let finalDesc = editForm.description.trimEnd()
      if (allAttachments.length > 0) {
        const links = allAttachments.map((a) => `[📎 ${a.name}](${a.url})`).join('\n')
        finalDesc += '\n\n' + links
      }

      const updated = await updateTicket(
        iid,
        { title: editForm.title, description: finalDesc, category: editForm.category },
        projectId,
      )
      setTicket(updated)
      setIsEditing(false)
      setEditAttachments([])
      setEditNewFiles([])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_edit_save'))
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setActionError(null)
    try {
      await deleteTicket(iid, projectId)
      router.push('/')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('err_ticket_delete'))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleClone() {
    if (!ticket) return
    setCloning(true)
    setCloneError(null)
    try {
      const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      const res = await fetch(`${API_BASE}/tickets/${iid}/clone${params}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setCloneError(d.detail ?? t('err_clone_failed'))
        return
      }
      const newTicket = await res.json()
      const href = projectId
        ? `/tickets/${newTicket.iid}?project_id=${projectId}`
        : `/tickets/${newTicket.iid}`
      router.push(href)
    } catch {
      setCloneError(t('err_network'))
    } finally {
      setCloning(false)
    }
  }

  async function handleMerge() {
    const targetNum = parseInt(mergeTargetIid, 10)
    if (!targetNum || isNaN(targetNum)) return
    setMerging(true)
    setMergeError(null)
    setMergeSuccess(false)
    try {
      const params = new URLSearchParams({ target_iid: String(targetNum) })
      if (projectId) params.set('project_id', projectId)
      const res = await fetch(`${API_BASE}/tickets/${iid}/merge?${params}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setMergeError(d.detail ?? t('err_merge_failed'))
        return
      }
      setMergeSuccess(true)
      // Refresh ticket (will show as closed after merge)
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      setMergeError(t('err_network'))
    } finally {
      setMerging(false)
    }
  }

  async function handleConvertToKb() {
    setConvertingToKb(true)
    setKbConvertError(null)
    try {
      const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      const res = await fetch(`${API_BASE}/tickets/${iid}/resolution/convert-to-kb${params}`, {
        method: 'POST', credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setKbConvertError(d.detail ?? t('err_kb_convert_failed'))
        return
      }
      const kb = await res.json()
      setResolutionNote(prev => prev ? { ...prev, kb_article_id: kb.id } : prev)
      router.push(`/kb/${kb.id}`)
    } catch {
      setKbConvertError(t('err_network'))
    } finally {
      setConvertingToKb(false)
    }
  }

  async function handleToggleWatch() {
    setWatchLoading(true)
    try {
      if (isWatching) {
        await unwatchTicket(iid)
        setIsWatching(false)
      } else {
        await watchTicket(iid)
        setIsWatching(true)
      }
    } catch {
      // silently ignore
    } finally {
      setWatchLoading(false)
    }
  }

  function addCommentFiles(selected: File[]) {
    setCommentFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))]
    })
  }

  function handleCommentFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addCommentFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  function handleCommentDrop(e: React.DragEvent) {
    e.preventDefault()
    setCommentIsDragging(false)
    addCommentFiles(Array.from(e.dataTransfer.files))
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim() && commentFiles.length === 0) return
    setCommentError(null)
    // 클라이언트 파일 크기 사전 검증 (10MB = nginx 통과 후 FastAPI 한도)
    const oversized = commentFiles.find((f) => f.size > 10 * 1024 * 1024)
    if (oversized) {
      setCommentError(t('err_file_too_large', { name: oversized.name }))
      return
    }
    setCommenting(true)
    try {
      let body = newComment.trim()
      // TipTap은 HTML을 출력한다. body가 HTML이면 첨부도 HTML 태그로 추가해야
      // dangerouslySetInnerHTML 렌더링 시 이미지가 텍스트로 보이지 않는다.
      const bodyIsHtml = body.startsWith('<')
      if (commentFiles.length > 0) {
        setCommentUploading(true)
        const attachments: string[] = []
        for (const file of commentFiles) {
          const result = await uploadFile(file, ticket?.project_id || undefined)
          const proxyUrl = toDisplayUrl(result)
          const name = result.name ?? file.name
          if (isImageFile(file.name)) {
            attachments.push(
              bodyIsHtml
                ? `<p><img src="${proxyUrl}" alt="${name}"></p>`
                : `![${name}](${proxyUrl})`
            )
          } else {
            // 비이미지(PDF 등)는 항상 마크다운 링크로 body 하단에 추가
            // → splitBodyAndAttachments가 추출 → AttachmentFileItem(PDF 미리보기)으로 렌더링
            attachments.push(`[📎 ${name}](${proxyUrl})`)
          }
        }
        setCommentUploading(false)
        const htmlAttachments = attachments.filter((a) => a.startsWith('<'))
        const mdAttachments = attachments.filter((a) => !a.startsWith('<'))
        if (bodyIsHtml) {
          body = body + htmlAttachments.join('') + (mdAttachments.length ? '\n' + mdAttachments.join('\n') : '')
        } else {
          body = body ? `${body}\n\n${attachments.join('\n')}` : attachments.join('\n')
        }
      }
      if (!body) return
      const comment = await addComment(iid, body, projectId, isInternal)
      setComments((prev) => [...prev, comment])
      setNewComment('')
      setCommentFiles([])
      setIsInternal(false)
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : t('err_comment_add'))
    } finally {
      setCommenting(false)
      setCommentUploading(false)
    }
  }

  async function handleSaveCommentEdit(noteId: number) {
    if (!editingCommentBody.trim()) return
    setSavingComment(true)
    try {
      const updated = await updateComment(iid, noteId, editingCommentBody.trim(), ticket?.project_id || undefined)
      setComments((prev) => prev.map((c) => c.id === noteId ? { ...c, body: updated.body } : c))
      setEditingCommentId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('err_edit_save'))
    } finally {
      setSavingComment(false)
    }
  }

  async function handleDeleteCommentConfirm(noteId: number) {
    if (!(await confirm({ title: t('err_comment_delete_confirm'), variant: 'danger' }))) return
    // 낙관적 제거 + 5초 동안 undo 가능
    const removed = comments.find((c) => c.id === noteId)
    if (!removed) return
    setComments((prev) => prev.filter((c) => c.id !== noteId))
    let cancelled = false
    toast(t('err_comment_delete_toast'), {
      description: t('err_comment_delete_toast_hint'),
      action: {
        label: t('err_comment_undo'),
        onClick: () => {
          cancelled = true
          setComments((prev) => [...prev, removed].sort((a, b) => a.id - b.id))
        },
      },
      duration: 5000,
    })
    setTimeout(async () => {
      if (cancelled) return
      try {
        await deleteComment(iid, noteId, ticket?.project_id || undefined)
      } catch (err) {
        // 서버 삭제 실패 시 복원
        setComments((prev) => [...prev, removed].sort((a, b) => a.id - b.id))
        toast.error(err instanceof Error ? err.message : t('err_delete_failed'))
      }
    }, 5100)
  }

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault()
    if (!ticket?.project_id || !linkTargetIid) return
    setAddingLink(true)
    try {
      const link = await createTicketLink(iid, {
        target_iid: Number(linkTargetIid),
        project_id: ticket.project_id,
        link_type: linkType,
      })
      setLinks((prev) => [...prev, link])
      setLinkTargetIid('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('err_link_add_failed'))
    } finally {
      setAddingLink(false)
    }
  }

  async function handleDeleteLink(linkId: number | string) {
    if (!ticket?.project_id) return
    try {
      await deleteTicketLink(iid, linkId)
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('err_link_delete_failed'))
    }
  }

  async function handleForward(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedDevProject || !ticket) return
    const devProject = devProjects.find((p) => p.id === selectedDevProject)
    if (!devProject) return
    setForwarding(true)
    try {
      const fwd = await createForward(iid, {
        target_project_id: selectedDevProject,
        target_project_name: devProject.name,
        note: forwardNote || undefined,
      }, projectId)
      // 전달 후 목록 재조회 (target_state 포함)
      fetchForwards(iid, projectId).then((res) => {
        setForwards(res.forwards)
        setForwardsAllClosed(res.all_closed)
      }).catch(() => {
        setForwards((prev) => [fwd, ...prev])
      })
      setSelectedDevProject('')
      setForwardNote('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('err_forward_failed'))
    } finally {
      setForwarding(false)
    }
  }

  async function handleDeleteForward(forwardId: number) {
    if (!(await confirm({ title: t('err_forward_delete_confirm'), variant: 'danger' }))) return
    try {
      await deleteForward(iid, forwardId)
      setForwards((prev) => prev.filter((f) => f.id !== forwardId))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('err_delete_failed'))
    }
  }

  async function handleSlaUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!slaEditDate) return
    setSlaSaving(true)
    setSlaError(null)
    try {
      const updated = await updateTicketSLA(iid, slaEditDate, ticket?.project_id)
      setSlaRecord(updated)
      if (updated.sla_deadline) {
        setSlaEditDate(updated.sla_deadline.split('T')[0])
      }
    } catch (err: unknown) {
      setSlaError(err instanceof Error ? err.message : t('err_sla_deadline_failed'))
    } finally {
      setSlaSaving(false)
    }
  }

  async function handleSlaPause() {
    setSlaPausing(true)
    setSlaError(null)
    try {
      const updated = await pauseTicketSLA(iid, ticket?.project_id)
      setSlaRecord(updated)
    } catch (err: unknown) {
      setSlaError(err instanceof Error ? err.message : t('err_sla_pause_failed'))
    } finally {
      setSlaPausing(false)
    }
  }

  async function handleSlaResume() {
    setSlaResuming(true)
    setSlaError(null)
    try {
      const updated = await resumeTicketSLA(iid, ticket?.project_id)
      setSlaRecord(updated)
    } catch (err: unknown) {
      setSlaError(err instanceof Error ? err.message : t('err_sla_resume_failed'))
    } finally {
      setSlaResuming(false)
    }
  }

  async function handleSlaExtend(e: React.FormEvent) {
    e.preventDefault()
    const mins = parseInt(slaExtendMinutes, 10)
    if (!mins || mins <= 0) return
    setSlaExtending(true)
    setSlaError(null)
    try {
      const updated = await extendTicketSLA(iid, mins, ticket?.project_id)
      setSlaRecord(updated)
      if (updated.sla_deadline) setSlaEditDate(updated.sla_deadline.split('T')[0])
    } catch (err: unknown) {
      setSlaError(err instanceof Error ? err.message : t('err_sla_extend_failed'))
    } finally {
      setSlaExtending(false)
    }
  }

  async function handleAISummary() {
    setAiSummaryLoading(true)
    setAiSummaryError(null)
    try {
      const result = await fetchTicketAISummary(iid, ticket?.project_id)
      setAiSummary(result)
    } catch (err: unknown) {
      setAiSummaryError(err instanceof Error ? err.message : t('err_ai_summary_failed'))
    } finally {
      setAiSummaryLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-4xl mb-3">⏳</div>
        <p>{t('loading')}</p>
      </div>
    )
  }

  if (error || !ticket) {
    // 404 상태로 판단되면 Next.js notFound 페이지로 (브레드크럼/SEO/HTTP 시맨틱)
    const is404 = !!error && /404|not.?found|찾을 수 없/i.test(error)  // keep regex
    return (
      <div className="text-center py-16 animate-fadeIn">
        <div className="text-7xl mb-4 select-none" aria-hidden="true">{is404 ? '🔍' : '⚠️'}</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {is404 ? t('not_found_title') : t('load_failed_title')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {is404 ? t('not_found_desc') : (error || t('retry_later'))}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-semibold transition-all"
          >
            {t('home_btn')}
          </Link>
          {!is404 && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 text-sm font-medium text-gray-700 dark:text-gray-300 transition-all"
            >
              {t('retry_btn')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const isClosed = ticket.state === 'closed'
  const isResolved = ticket.status === 'resolved'
  const canRate = isClosed || isResolved

  // 상태에 따른 액션 버튼 결정 (워크플로우 전환 규칙 준수)
  const statusActions: { label: string; status: string; color: string }[] = []
  if (!isClosed) {
    if (ticket.status === 'open') {
      if (isAgent) statusActions.push({ label: t('action_approve'), status: 'approved', color: 'bg-emerald-500 hover:bg-emerald-600 text-white' })
      statusActions.push({ label: t('action_start_processing'), status: 'in_progress', color: 'bg-blue-500 hover:bg-blue-600 text-white' })
      statusActions.push({ label: t('action_request_info'), status: 'waiting', color: 'bg-orange-400 hover:bg-orange-500 text-white' })
    }
    if (ticket.status === 'approved') {
      statusActions.push({ label: t('action_start_processing'), status: 'in_progress', color: 'bg-blue-500 hover:bg-blue-600 text-white' })
      statusActions.push({ label: t('action_request_info'), status: 'waiting', color: 'bg-orange-400 hover:bg-orange-500 text-white' })
    }
    if (ticket.status === 'in_progress') {
      statusActions.push({ label: t('action_mark_resolved'), status: 'resolved', color: 'bg-green-500 hover:bg-green-600 text-white' })
      statusActions.push({ label: t('action_request_info'), status: 'waiting', color: 'bg-orange-400 hover:bg-orange-500 text-white' })
    }
    if (ticket.status === 'waiting') {
      statusActions.push({ label: t('action_resume_processing'), status: 'in_progress', color: 'bg-blue-500 hover:bg-blue-600 text-white' })
    }
    if (ticket.status === 'resolved') {
      statusActions.push({ label: t('action_reopen_processing'), status: 'in_progress', color: 'bg-orange-400 hover:bg-orange-500 text-white' })
    }
    // 강제 종료는 모든 미종료 상태에서 허용
    statusActions.push({ label: t('action_close_ticket'), status: 'closed', color: 'bg-gray-500 hover:bg-gray-600 text-white' })
  } else {
    statusActions.push({ label: t('action_reopen_ticket'), status: 'reopened', color: 'bg-yellow-500 hover:bg-yellow-600 text-white' })
  }

  const rateHref = projectId
    ? `/tickets/${ticket.iid}/rate?project_id=${projectId}`
    : `/tickets/${ticket.iid}/rate`

  const sideTabs = [
    { key: 'links' as const, label: t('tab_links') },
    { key: 'time' as const, label: t('tab_time') },
    { key: 'forward' as const, label: t('tab_forward') },
    ...(isAgent ? [{ key: 'mr' as const, label: 'MR' }] : []),
    ...(isAgent ? [{ key: 'pipeline' as const, label: 'CI/CD' }] : []),
  ]

  return (
    <>
    {/* 상태 전환 이유 입력 모달 (대기/재개 공용) */}
    {waitingReasonModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fadeIn backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6 animate-scaleIn">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            {pendingReasonStatus === 'reopened' ? t('reason_modal_reopen_title') : t('reason_modal_waiting_title')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {pendingReasonStatus === 'reopened'
              ? t('reason_modal_reopen_hint')
              : t('reason_modal_waiting_hint')}
          </p>
          <textarea
            autoFocus
            value={waitingReasonInput}
            onChange={e => setWaitingReasonInput(e.target.value)}
            rows={3}
            placeholder={pendingReasonStatus === 'reopened'
              ? t('reason_modal_reopen_placeholder')
              : t('reason_modal_waiting_placeholder')}
            className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          <div className="flex gap-2 mt-4 justify-end">
            <button
              onClick={() => setWaitingReasonModal(false)}
              className="px-4 py-2 rounded-lg text-sm border dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('reason_modal_cancel')}
            </button>
            <button
              disabled={!waitingReasonInput.trim()}
              onClick={() => {
                setWaitingReasonModal(false)
                _doStatusChange(pendingReasonStatus, '', '', waitingReasonInput.trim())
              }}
              className={`px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${
                pendingReasonStatus === 'reopened'
                  ? 'bg-yellow-500 hover:bg-yellow-600'
                  : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {t('reason_modal_confirm')}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* 해결 노트 모달 */}
    {resolutionModal && (
      <ResolutionNoteModal
        ticketIid={iid}
        targetStatus={resolutionModal}
        onConfirm={(note, type, reason) => {
          setResolutionModal(null)
          _doStatusChange(resolutionModal, note, type, reason)
        }}
        onCancel={() => setResolutionModal(null)}
      />
    )}
    <div className="w-full px-4 py-5 flex flex-col lg:flex-row gap-5 items-start">

      {/* ========== LEFT COLUMN ========== */}
      <div className="flex-1 min-w-0 space-y-4 w-full lg:w-auto">

        {/* Header: breadcrumb + title + badges */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-5 sticky top-0 z-30 backdrop-blur-sm bg-white/95 dark:bg-gray-900/95 print-hidden-sticky">
          <div className="mb-3">
            <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('back_to_list')}</Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <a
              href={ticket.web_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-gray-400 dark:text-gray-500 text-sm hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              title={t('open_in_gitlab')}
            >
              #{ticket.iid}
            </a>
            <CopyButton
              value={`#${ticket.iid}`}
              successMessage={t('copied_suffix', { iid: ticket.iid })}
              iconOnly
              label={t('copy_ticket_number')}
              className="text-gray-400 dark:text-gray-500"
            />
            <StarToggle iid={ticket.iid} size="md" />
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <CategoryBadge category={ticket.category} />
            <SlaBadge
              priority={ticket.priority}
              createdAt={ticket.created_at}
              state={ticket.state}
              slaDeadline={slaRecord?.sla_deadline}
              paused={ticket.status === 'waiting'}
            />
            </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex-1">{ticket.title}</h1>
          </div>
        </div>

        {/* 차단됨 경고 배너 */}
        {links.some(l => l.link_type === 'is_blocked_by') && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
            <span className="text-red-500 text-base shrink-0 mt-0.5">🚫</span>
            <div className="text-sm text-red-700 dark:text-red-300">
              <strong>{t('blocked_warning_strong')}</strong>
              <span className="block text-xs mt-0.5 text-red-600 dark:text-red-400">
                {t('blocked_warning_detail', { list: links.filter(l => l.link_type === 'is_blocked_by').map(l => `#${l.target_iid}`).join(', ') })}
              </span>
            </div>
          </div>
        )}

        {/* 상세 내용 */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('detail_heading')}</h2>
            {canEdit && !isEditing && (
              <button data-ticket-edit-btn onClick={startEdit} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('edit_btn')} <kbd className="ml-1 text-[9px] bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-px font-mono">E</kbd></button>
            )}
          </div>

        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('field_title_label')}</label>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                required
                minLength={5}
                maxLength={200}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('field_category_label')}</label>
              <select
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {serviceTypes.map((c) => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
            </div>

            {/* 본문 에디터 */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('field_body_label')}</label>
              <RichTextEditor
                value={editForm.description}
                onChange={(v) => setEditForm((f) => ({ ...f, description: v }))}
                placeholder={t('body_placeholder')}
                minHeight="280px"
                onImageUpload={handleEditImageUpload}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('image_toolbar_hint')}</p>
            </div>

            {/* 이미지 관리 패널 — 본문 내 인라인 이미지 목록 */}
            {(() => {
              const inlineImages = extractInlineImages(editForm.description)
              if (inlineImages.length === 0) return null
              return (
                <div className="border dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {t('body_images_count', { n: inlineImages.length })}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('image_hover_hint')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inlineImages.map((img, i) => (
                      <div
                        key={img.src + i}
                        className="relative group w-24 h-24 border dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-sm"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.src}
                          alt={img.alt || t('image_alt_fallback', { n: i + 1 })}
                          className="w-full h-full object-cover"
                        />
                        {/* 하단 파일명 */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5">
                          <span className="text-[10px] text-white truncate block">
                            {img.alt || t('image_alt_fallback', { n: i + 1 })}
                          </span>
                        </div>
                        {/* 호버 오버레이: 삭제 / 변경 */}
                        <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              changingImageSrcRef.current = img.src
                              document.getElementById('edit-image-change-input')?.click()
                            }}
                            className="text-[11px] font-medium bg-white text-blue-600 hover:bg-blue-50 px-2.5 py-0.5 rounded shadow-sm w-14 text-center"
                          >
                            {t('image_change')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditForm((f) => ({
                                ...f,
                                description: deleteImageBySrc(f.description, img.src),
                              }))
                            }
                            className="text-[11px] font-medium bg-white text-red-500 hover:bg-red-50 px-2.5 py-0.5 rounded shadow-sm w-14 text-center"
                          >
                            {t('image_delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* 이미지 변경용 숨긴 파일 입력 */}
                  <input
                    id="edit-image-change-input"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.currentTarget.value = ''
                      const srcToReplace = changingImageSrcRef.current
                      changingImageSrcRef.current = null
                      if (!file || !srcToReplace) return
                      try {
                        const newSrc = await handleEditImageUpload(file)
                        setEditForm((f) => ({
                          ...f,
                          description: replaceImageSrc(f.description, srcToReplace, newSrc),
                        }))
                      } catch {
                        // upload error silently ignored
                      }
                    }}
                  />
                </div>
              )
            })()}

            {/* 첨부 파일 패널 — 본문과 별도 관리 (Jira/ServiceNow 방식) */}
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 space-y-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('attachments_label')}</p>

              {/* 기존 첨부 목록 */}
              {editAttachments.length > 0 ? (
                <ul className="space-y-1">
                  {editAttachments.map((att, i) => (
                    <li key={i} className="flex items-center gap-2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-md px-3 py-2 text-sm">
                      <span className="shrink-0">{isImageFile(att.name) ? '🖼' : getFileIcon(att.name)}</span>
                      <a
                        href={`${att.url}&download=true`}
                        download
                        className="flex-1 text-gray-700 dark:text-gray-200 truncate hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        {att.name}
                      </a>
                      <button
                        type="button"
                        title={t('attachment_delete_title')}
                        onClick={() => setEditAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors text-base leading-none"
                       aria-label={t('remove_aria')}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('no_attachments')}</p>
              )}

              {/* 새 파일 추가 영역 */}
              <label
                className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-md px-4 py-2.5 cursor-pointer transition-colors text-sm ${
                  editIsDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                }`}
                onDragOver={(e) => { e.preventDefault(); setEditIsDragging(true) }}
                onDragEnter={(e) => { e.preventDefault(); setEditIsDragging(true) }}
                onDragLeave={() => setEditIsDragging(false)}
                onDrop={handleEditFileDrop}
              >
                <span>📎</span>
                <span>{editIsDragging ? t('drop_here') : t('select_or_drop')}</span>
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.gz"
                  onChange={(e) => { addEditFiles(Array.from(e.target.files || [])); e.currentTarget.value = '' }}
                />
              </label>

              {/* 새로 추가된 파일 미리보기 */}
              {editNewFiles.length > 0 && (
                <ul className="space-y-1">
                  {editNewFiles.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 rounded-md px-3 py-1.5 text-xs">
                      <span>{isImageFile(f.name) ? '🖼' : getFileIcon(f.name)}</span>
                      <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{f.name}</span>
                      <span className="text-gray-400 dark:text-gray-500 shrink-0">{formatFileSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setEditNewFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                       aria-label={t('remove_aria')}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={editSaving}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editSaving ? t('edit_saving') : t('edit_save')}
              </button>
              <button
                type="button"
                onClick={() => { setIsEditing(false); setEditAttachments([]); setEditNewFiles([]); changingImageSrcRef.current = null }}
                className="border dark:border-gray-600 px-4 py-1.5 rounded-md text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t('edit_cancel')}
              </button>
            </div>
          </form>
        ) : (
          ticket.description
            ? <DescriptionWithAttachments description={ticket.description} projectPath={ticket.project_path} onImageClick={(url, name) => setLightbox({ url, name })} />
            : <p className="text-gray-400 dark:text-gray-500 text-sm">{t('no_content')}</p>
        )}
      </div>

      {/* IT팀 코멘트 + 타임라인 */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm mb-4">
        {/* 탭 헤더 */}
        <div className="flex border-b dark:border-gray-700 px-6 pt-4 gap-4">
          <button
            onClick={() => setCommentTab('comments')}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              commentTab === 'comments'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t('tab_comments', { n: comments.length })}
          </button>
          <button
            onClick={() => setCommentTab('timeline')}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              commentTab === 'timeline'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t('tab_timeline')}
          </button>
        </div>

        {/* 타임라인 탭 */}
        {commentTab === 'timeline' && ticket && (
          <div className="p-6">
            <TimelineView iid={ticket.iid} projectId={projectId} />
          </div>
        )}

        {/* 처리 내역 탭 */}
        {commentTab === 'comments' && (
        <div className="p-6">
        {comments.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 text-sm">{t('no_comments')}</p>
        ) : (
          <div className="relative space-y-4 mb-4">
            {/* Timeline rail — 댓글들을 연결하는 좌측 vertical line */}
            {comments.length > 1 && (
              <div className="absolute left-4 top-7 bottom-7 w-0.5 bg-gradient-to-b from-blue-200 via-gray-200 to-transparent dark:from-blue-700/50 dark:via-gray-700 pointer-events-none" aria-hidden="true" />
            )}
            {comments.map((c) => (
              <div
                key={c.id}
                data-comment-item
                className={`relative flex gap-3 rounded-lg p-3 transition-all ${c.internal ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50' : ''}`}
              >
                <Avatar name={formatName(c.author_name)} username={c.author_name} size="md" className="relative z-10 ring-2 ring-white dark:ring-gray-900" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{formatName(c.author_name)}</span>
                    {c.internal && (
                      <span className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700/50 px-1.5 py-0.5 rounded">
                        {t('internal_memo_badge')}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500" title={new Date(c.created_at).toLocaleString('ko-KR')}>{formatSmartDate(c.created_at)}</span>
                    {c.updated_at && c.updated_at !== c.created_at && (
                      <span
                        className="text-[10px] text-gray-400 dark:text-gray-500 italic"
                        title={t('edited_at_title', { date: new Date(c.updated_at).toLocaleString() })}
                      >
                        {t('edited_suffix')}
                      </span>
                    )}
                    {/* 수정/삭제 버튼 — 작성자 본인 또는 관리자 */}
                    {(c.author_name === user?.name || ['admin', 'manager', 'agent'].includes(user?.role || '')) && editingCommentId !== c.id && (
                      <span className="ml-auto flex gap-1">
                        <button
                          onClick={() => { setEditingCommentId(c.id); setEditingCommentBody(c.body) }}
                          className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors px-1"
                          title={t('comment_edit_title')}
                        >{t('edit_comment')}</button>
                        <button
                          onClick={() => handleDeleteCommentConfirm(c.id)}
                          className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1"
                          title={t('comment_delete_title')}
                        >{t('delete_comment')}</button>
                      </span>
                    )}
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden"
                        rows={4}
                        value={editingCommentBody}
                        onChange={(e) => setEditingCommentBody(e.target.value)}
                        onInput={(e) => {
                          const el = e.currentTarget
                          el.style.height = 'auto'
                          el.style.height = Math.min(el.scrollHeight, 400) + 'px'
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveCommentEdit(c.id)}
                          disabled={savingComment || !editingCommentBody.trim()}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >{savingComment ? t('saving_comment') : t('save_comment')}</button>
                        <button
                          onClick={() => setEditingCommentId(null)}
                          className="px-3 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >{t('cancel_comment')}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <DescriptionWithAttachments description={c.body} projectPath={ticket?.project_path} onImageClick={(url, name) => setLightbox({ url, name })} />
                      <div className="group">
                        <CommentReactions commentId={c.id} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 코멘트 입력 폼 */}
        <form onSubmit={handleAddComment} className="border-t dark:border-gray-700 pt-4">
          {/* 빠른 답변 템플릿 — 티켓 카테고리와 일치하는 항목 우선 정렬 */}
          <div className="mb-2">
            <select
              value=""
              onChange={(e) => {
                const tmpl = quickReplies.find((r) => r.name === e.target.value)
                if (tmpl) setNewComment(markdownToHtml(tmpl.content))
              }}
              className="text-sm border dark:border-gray-600 rounded-md px-2 py-1.5 text-gray-600 dark:text-gray-300 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            >
              <option value="">{t('quick_reply_select')}</option>
              {(() => {
                const cat = ticket?.category
                const matched = cat ? quickReplies.filter(r => r.category === cat) : []
                const others = quickReplies.filter(r => !cat || r.category !== cat)
                return (
                  <>
                    {matched.length > 0 && (
                      <optgroup label={t('quick_reply_recommended', { cat: cat ?? '' })}>
                        {matched.map(r => (
                          <option key={r.id} value={r.name}>{r.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {others.length > 0 && (
                      <optgroup label={matched.length > 0 ? t('quick_reply_other') : t('quick_reply_all')}>
                        {others.map(r => (
                          <option key={r.id} value={r.name}>{r.name}{r.category ? ` (${r.category})` : ''}</option>
                        ))}
                      </optgroup>
                    )}
                  </>
                )
              })()}
            </select>
          </div>

          <div
            data-comment-input
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                if (newComment.trim() || commentFiles.length > 0) {
                  handleAddComment(e as unknown as React.FormEvent)
                }
              }
            }}
          >
            <RichTextEditor
              value={newComment}
              onChange={(val) => {
                setNewComment(val)
                sendTyping(val.replace(/<[^>]*>/g, '').trim().length > 0)
              }}
              placeholder={t('comment_placeholder')}
              minHeight="160px"
              mentionUsers={members.map(m => ({ id: m.username, label: m.name }))}
            />
          </div>

          {/* 타이핑 인디케이터 */}
          {typingUsers.length > 0 && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 italic">
              {t('typing_indicator', { users: typingUsers.join(', ') })}
            </p>
          )}

          {/* 파일 첨부 */}
          <div className="mt-2">
            <label
              className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-md px-4 py-2.5 cursor-pointer transition-colors text-sm ${
                commentIsDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              }`}
              onDragOver={(e) => { e.preventDefault(); setCommentIsDragging(true) }}
              onDragEnter={(e) => { e.preventDefault(); setCommentIsDragging(true) }}
              onDragLeave={() => setCommentIsDragging(false)}
              onDrop={handleCommentDrop}
            >
              <span>📎</span>
              <span>{commentIsDragging ? t('file_drop_here') : t('file_drop_hint')}</span>
              <input
                type="file"
                multiple
                onChange={handleCommentFileChange}
                className="sr-only"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.log"
              />
            </label>
            {commentFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {commentFiles.map((file, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-800 rounded px-3 py-1.5">
                    <span className="shrink-0">{getFileIcon(file.name)}</span>
                    <span className="truncate text-gray-700 dark:text-gray-200 flex-1">{file.name}</span>
                    <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => setCommentFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs shrink-0"
                     aria-label={t('remove')}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {commentError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              ⚠️ {commentError}
            </p>
          )}

          <div className="flex items-center justify-between mt-2">
            {/* 내부 메모 토글 */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => setIsInternal((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  isInternal ? 'bg-yellow-400' : 'bg-gray-200 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    isInternal ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className={`text-sm ${isInternal ? 'text-yellow-700 dark:text-yellow-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                {isInternal ? t('internal_memo_toggle') : t('public_reply_toggle')}
              </span>
            </label>

            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500">
                <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px] font-mono">⌘ + Enter</kbd> {t('submit_shortcut_hint')}
              </span>
              <button
                type="submit"
                disabled={commenting || (!newComment.trim() && commentFiles.length === 0)}
                className={`text-sm font-medium px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isInternal
                    ? 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {commentUploading ? t('uploading_comment') : commenting ? t('submitting_comment') : isInternal ? t('submit_memo') : t('submit_comment')}
              </button>
            </div>
          </div>
        </form>
        </div>
        )} {/* end commentTab === 'comments' */}
      </div>

        {/* 해결 노트 */}
        {(isResolved || isClosed) && resolutionNote?.id && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('resolution_note_header')}</h2>
              {isAgent && !resolutionNote.kb_article_id && (
                <div className="flex items-center gap-2">
                  {kbConvertError && <span className="text-xs text-red-500 dark:text-red-400">{kbConvertError}</span>}
                  <button
                    onClick={handleConvertToKb}
                    disabled={convertingToKb}
                    className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {convertingToKb ? t('converting_to_kb') : t('convert_to_kb')}
                  </button>
                </div>
              )}
              {resolutionNote.kb_article_id && (
                <Link href={`/kb/${resolutionNote.kb_article_id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                  {t('view_kb')}
                </Link>
              )}
            </div>
            {resolutionNote.resolution_type && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-medium mb-2">
                {resolutionNote.resolution_type}
              </span>
            )}
            {resolutionNote.note && (
              <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                {resolutionNote.note}
              </p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {resolutionNote.created_by_name} · {resolutionNote.created_at ? new Date(resolutionNote.created_at).toLocaleString('ko-KR') : ''}
            </p>
          </div>
        )}

        {/* 관련 KB 문서 추천 */}
        {isAgent && kbSuggestions.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('related_kb_header')}</h2>
            <div className="space-y-2">
              {kbSuggestions.map(kb => (
                <Link
                  key={kb.id}
                  href={`/kb/${kb.id}`}
                  className="block p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                >
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 line-clamp-2">{kb.title}</p>
                  {kb.category && (
                    <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">{kb.category}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 만족도 평가 */}
        {(isClosed || isResolved) && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('satisfaction_header')}</h2>
            {rating ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <StarDisplay score={rating.score} />
                  <span className="text-gray-700 dark:text-gray-200 font-medium">{t('satisfaction_score_fmt', { score: rating.score })}</span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('rater_prefix', { name: rating.employee_name })}</p>
                {rating.comment && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-3 mt-1">&quot;{rating.comment}&quot;</p>
                )}
                <div className="mt-2">
                  <Link href={rateHref} className="inline-block bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium px-4 py-1.5 rounded-md text-sm transition-colors">
                    {t('edit_rating')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <p className="text-gray-600 dark:text-gray-300 text-sm">{t('satisfaction_prompt')}</p>
                {canRate && (
                  <Link href={rateHref} className="shrink-0 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold px-5 py-2 rounded-md text-sm transition-colors">
                    {t('rate_btn')}
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {/* END LEFT COLUMN */}

      {/* ========== RIGHT SIDEBAR ========== */}
      <div className="w-full lg:w-72 lg:shrink-0 lg:sticky lg:top-4 space-y-3 pb-6">

        {/* 워크플로우 + 상태 액션 — IT 개발자 이상 */}
        {isDeveloper && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t('workflow_header')}</h3>
            <WorkflowStepper status={ticket.status} state={ticket.state} />
            <div className="mt-3 flex flex-col gap-2">
              {statusActions.map((action, idx) => (
                <button
                  key={action.status}
                  data-ticket-status-select={idx === 0 ? '' : undefined}
                  onClick={() => handleStatusChange(action.status)}
                  disabled={updating}
                  className={`w-full text-sm px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${action.color}`}
                >
                  {updating ? t('updating_action') : action.label}
                  {idx === 0 && <kbd className="ml-1.5 text-[9px] opacity-60 font-mono bg-white/20 rounded px-1">S</kbd>}
                </button>
              ))}
            </div>
            {actionError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">⚠️ {actionError}</p>}
          </div>
        )}

        {/* 티켓 유형 + 문제 관리 */}
        <TicketTypePanel
          ticketIid={iid}
          projectId={ticket?.project_id || projectId || ''}
          isAgent={isAgent}
        />

        {/* 승인 요청 패널 — 에이전트에게 승인 요청 */}
        <ApprovalPanel
          ticketIid={iid}
          projectId={ticket?.project_id || projectId || ''}
          isAgent={isAgent}
          currentUsername={user?.username}
          ticketStatus={ticket?.status}
        />

        {/* 속성 패널 */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 space-y-3 text-sm">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('properties_header')}</h3>

          {/* 서비스 유형 — 수정 권한 있는 사용자 편집 가능 */}
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{t('prop_service_type')}</span>
            {canEdit ? (
              <select
                value={ticket.category || t('prop_service_other_fallback')}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={updating}
                className="text-xs border dark:border-gray-600 rounded px-1.5 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {serviceTypes.map((c) => (
                  <option key={c.value} value={c.label}>{c.emoji} {c.label}</option>
                ))}
              </select>
            ) : (
              <CategoryBadge category={ticket.category} />
            )}
          </div>

          {/* 우선순위 — IT 개발자 이상 편집 가능 */}
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400 text-xs">{t('prop_priority')}</span>
            {isDeveloper ? (
              <select
                value={ticket.priority || 'medium'}
                onChange={(e) => handlePriorityChange(e.target.value)}
                disabled={updating}
                className="text-xs border dark:border-gray-600 rounded px-1.5 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <PriorityBadge priority={ticket.priority} />
            )}
          </div>

          {/* 담당자 — IT 관리자 이상 편집 가능 */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs shrink-0">{t('prop_assignee')}</span>
            {isAgent && members.length > 0 ? (
              <div className="flex items-center gap-1.5">
                {ticket.assignee_name && (
                  <Avatar name={formatName(ticket.assignee_name)} username={ticket.assignee_name} size="xs" />
                )}
                <select
                  value={ticket.assignee_id ?? ''}
                  onChange={(e) => handleAssigneeChange(e.target.value)}
                  disabled={updating}
                  className="text-xs border dark:border-gray-600 rounded px-1.5 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed max-w-[140px]"
                >
                  <option value="">{t('prop_no_assignee')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{formatName(m.name)}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {ticket.assignee_name && (
                  <Avatar name={formatName(ticket.assignee_name)} username={ticket.assignee_name} size="xs" />
                )}
                <span className="text-gray-800 dark:text-gray-200 text-xs">{ticket.assignee_name ? formatName(ticket.assignee_name) : t('prop_unassigned')}</span>
              </div>
            )}
          </div>

          {/* 마일스톤 */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500 dark:text-gray-400 text-xs shrink-0">{t('prop_milestone')}</span>
            {isAgent && milestones.length > 0 ? (
              <select
                value={ticket.milestone_id ?? ''}
                onChange={(e) => handleMilestoneChange(e.target.value)}
                disabled={updating}
                className="text-xs border dark:border-gray-600 rounded px-1.5 py-1 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed max-w-[160px]"
              >
                <option value="">{t('prop_milestone_none')}</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            ) : (
              <span className="text-gray-800 dark:text-gray-200 text-xs">{ticket.milestone_title || t('prop_milestone_none')}</span>
            )}
          </div>

          <div className="border-t dark:border-gray-700 pt-3 space-y-2">
            <div>
              <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_requester')}</span>
              <span className="text-gray-800 dark:text-gray-200 text-xs">{ticket.employee_name || '-'}</span>
            </div>
            {ticket.department && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_department')}</span>
                <span className="text-gray-800 dark:text-gray-200 text-xs">{ticket.department}</span>
              </div>
            )}
            {ticket.location && (
              <div>
                <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_location')}</span>
                <span className="text-gray-800 dark:text-gray-200 text-xs">{ticket.location}</span>
              </div>
            )}
            <div>
              <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_email')}</span>
              <span className="text-gray-800 dark:text-gray-200 text-xs break-all">{ticket.employee_email || '-'}</span>
            </div>
            <div>
              <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_created_at')}</span>
              <span className="text-gray-800 dark:text-gray-200 text-xs">{formatDate(ticket.created_at, 'full')}</span>
            </div>
            <div>
              <span className="text-gray-400 dark:text-gray-500 text-xs block">{t('prop_updated_at')}</span>
              <span className="text-gray-800 dark:text-gray-200 text-xs">{formatDate(ticket.updated_at, 'full')}</span>
            </div>
          </div>
        </div>

        {/* 커스텀 필드 */}
        {customFields.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('custom_fields_header')}</h3>
            <div className="space-y-3">
              {customFields.map(f => (
                <div key={f.id}>
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  {f.field_type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={customFieldEdits[String(f.id)] === 'true'}
                      onChange={e => setCustomFieldEdits(prev => ({ ...prev, [String(f.id)]: e.target.checked ? 'true' : 'false' }))}
                      className="rounded border-gray-300 text-blue-600"
                    />
                  ) : f.field_type === 'select' ? (
                    <select
                      value={customFieldEdits[String(f.id)] ?? ''}
                      onChange={e => setCustomFieldEdits(prev => ({ ...prev, [String(f.id)]: e.target.value }))}
                      className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">{t('custom_field_select')}</option>
                      {f.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.field_type === 'number' ? 'number' : 'text'}
                      value={customFieldEdits[String(f.id)] ?? ''}
                      onChange={e => setCustomFieldEdits(prev => ({ ...prev, [String(f.id)]: e.target.value }))}
                      className="w-full text-xs border dark:border-gray-600 rounded px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
              <button
                onClick={handleSaveCustomFields}
                disabled={savingCustomFields}
                className="w-full text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-md font-medium transition-colors mt-1"
              >
                {savingCustomFields ? t('custom_fields_saving') : t('custom_fields_save')}
              </button>
            </div>
          </div>
        )}

        {/* SLA — IT 개발자 이상 */}
        {isDeveloper && slaRecord && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('sla_header')}</h3>

            {/* SLA 진행 바 */}
            {slaRecord.sla_deadline && ticket && (() => {
              const start = new Date(ticket.created_at).getTime()
              const deadline = new Date(slaRecord.sla_deadline).getTime()
              const now = slaRecord.resolved_at ? new Date(slaRecord.resolved_at).getTime() : Date.now()
              const total = deadline - start
              const elapsed = Math.min(now - start, total > 0 ? total * 1.5 : 1)
              const pct = total > 0 ? Math.min(Math.round((elapsed / total) * 100), 150) : 0
              const displayPct = Math.min(pct, 100)
              const isOver = pct >= 100
              const isWarning = pct >= 80 && !isOver
              const barColor = isOver
                ? 'bg-red-500'
                : isWarning
                ? 'bg-amber-400'
                : 'bg-emerald-500'
              const msLeft = deadline - Date.now()
              const hoursLeft = Math.round(msLeft / 3600000)
              const daysLeft = Math.floor(msLeft / 86400000)
              const timeLabel = slaRecord.resolved_at
                ? t('sla_resolved_badge')
                : msLeft < 0
                ? (Math.abs(daysLeft) > 0 ? t('sla_overdue_days_hours', { days: Math.abs(daysLeft) + '일 ', hours: Math.abs(hoursLeft % 24) }) : t('sla_overdue_hours_only', { hours: Math.abs(hoursLeft % 24) }))
                : daysLeft > 0
                ? t('sla_remaining_days_hours', { days: daysLeft, hours: hoursLeft % 24 })
                : t('sla_remaining_hours', { hours: hoursLeft })
              return (
                <div className="mb-3">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className={isOver ? 'text-red-500 font-semibold' : isWarning ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}>
                      {timeLabel}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500">{displayPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${barColor}`}
                      style={{ width: `${displayPct}%` }}
                    />
                  </div>
                </div>
              )
            })()}

            <div className="space-y-2 text-xs mb-3">
              <div className="flex justify-between items-start">
                <span className="text-gray-500 dark:text-gray-400">{t('sla_deadline_label')}</span>
                <span className={`font-medium text-right ${slaRecord.breached ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                  {slaRecord.sla_deadline
                    ? new Date(slaRecord.sla_deadline).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
                    : '-'}
                  {slaRecord.breached && <span className="ml-1 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-1 py-0.5 rounded text-[10px]">{t('sla_breach_badge')}</span>}
                </span>
              </div>
              {slaRecord.paused_at && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 dark:text-gray-400">{t('sla_status_label')}</span>
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {t('sla_paused_label')}
                  </span>
                </div>
              )}
              {slaRecord.total_paused_seconds > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t('sla_paused_total')}</span>
                  <span className="text-gray-600 dark:text-gray-300">
                    {t('sla_paused_duration', { hours: Math.floor(slaRecord.total_paused_seconds / 3600), minutes: Math.floor((slaRecord.total_paused_seconds % 3600) / 60) })}
                  </span>
                </div>
              )}
              {slaRecord.first_response_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t('sla_first_response')}</span>
                  <span className="text-gray-800 dark:text-gray-200">{new Date(slaRecord.first_response_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</span>
                </div>
              )}
              {slaRecord.resolved_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t('sla_resolved_label')}</span>
                  <span className="text-green-700 dark:text-green-400">{new Date(slaRecord.resolved_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</span>
                </div>
              )}
              {slaPrediction && !slaRecord.resolved_at && (
                <div className="flex justify-between items-start pt-1 border-t dark:border-gray-700">
                  <span className="text-gray-500 dark:text-gray-400">{t('sla_predicted_label')}</span>
                  <div className="text-right">
                    <span className="text-gray-700 dark:text-gray-300">
                      {new Date(slaPrediction.predicted_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                      slaPrediction.confidence === 'high'
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                        : slaPrediction.confidence === 'medium'
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
                        : slaPrediction.confidence === 'low'
                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}>
                      {slaPrediction.confidence === 'high' ? t('sla_conf_high')
                        : slaPrediction.confidence === 'medium' ? t('sla_conf_medium')
                        : slaPrediction.confidence === 'low' ? t('sla_conf_low')
                        : t('sla_conf_default')}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {isAgent && (
              <div className="space-y-2">
                {/* SLA 위반/임박 시 — 눈에 띄는 빠른 연장 칩 */}
                {slaRecord?.breached && ticket?.state !== 'closed' && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">
                    <p className="text-[10px] font-semibold text-red-700 dark:text-red-400 mb-1.5">{t('sla_quick_extend_header')}</p>
                    <div className="flex gap-1.5">
                      {[
                        { mins: 60, label: t('sla_extend_1h') },
                        { mins: 480, label: t('sla_extend_8h') },
                        { mins: 1440, label: t('sla_extend_1d') },
                      ].map(({ mins, label }) => (
                        <button
                          key={mins}
                          type="button"
                          disabled={slaExtending}
                          onClick={async () => {
                            setSlaExtending(true)
                            try {
                              const updated = await extendTicketSLA(iid, mins, ticket?.project_id)
                              setSlaRecord(updated)
                              toast.success(t('sla_extended_toast', { label }))
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : t('err_sla_extend_failed'))
                            } finally {
                              setSlaExtending(false)
                            }
                          }}
                          className="flex-1 text-[11px] px-2 py-1.5 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed font-medium active:scale-95 transition-all"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Pause / Resume */}
                {ticket?.state !== 'closed' && (
                  <div className="flex gap-2">
                    {slaRecord?.paused_at ? (
                      <button
                        onClick={handleSlaResume}
                        disabled={slaResuming}
                        className="flex-1 text-xs px-2 py-1.5 bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 rounded hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      >
                        {slaResuming ? '...' : t('sla_resume_btn')}
                      </button>
                    ) : (
                      <button
                        onClick={handleSlaPause}
                        disabled={slaPausing}
                        className="flex-1 text-xs px-2 py-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      >
                        {slaPausing ? '...' : t('sla_pause_btn')}
                      </button>
                    )}
                  </div>
                )}
                {/* Extend */}
                <form onSubmit={handleSlaExtend} className="flex gap-1.5 items-center">
                  <select
                    value={slaExtendMinutes}
                    onChange={e => setSlaExtendMinutes(e.target.value)}
                    className="border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="60">{t('sla_extend_1h_option')}</option>
                    <option value="240">{t('sla_extend_4h_option')}</option>
                    <option value="480">{t('sla_extend_8h_option')}</option>
                    <option value="1440">{t('sla_extend_1d_option')}</option>
                    <option value="4320">{t('sla_extend_3d_option')}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={slaExtending}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {slaExtending ? '...' : t('sla_extend_btn')}
                  </button>
                </form>
                {/* Manual date change */}
                <form onSubmit={handleSlaUpdate} className="flex gap-2 items-center">
                  <input
                    type="date"
                    value={slaEditDate}
                    onChange={(e) => { setSlaEditDate(e.target.value); setSlaError(null) }}
                    min={new Date().toISOString().split('T')[0]}
                    className="flex-1 border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={slaSaving || !slaEditDate}
                    className="bg-gray-600 text-white px-2 py-1 rounded text-xs hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {slaSaving ? '...' : t('sla_change_date_btn')}
                  </button>
                </form>
                {slaError && <p className="text-red-600 dark:text-red-400 text-[10px] mt-1">⚠️ {slaError}</p>}
              </div>
            )}
          </div>
        )}

        {/* AI 활동 요약 패널 */}
        {isDeveloper && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('ai_summary_header')}</h3>
              <button
                onClick={handleAISummary}
                disabled={aiSummaryLoading}
                className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {aiSummaryLoading ? t('ai_analyzing') : aiSummary ? t('ai_reanalyze') : t('ai_generate')}
              </button>
            </div>
            {aiSummaryError && (
              <p className="text-xs text-red-500 dark:text-red-400">⚠️ {aiSummaryError}</p>
            )}
            {aiSummary && (
              <div className="space-y-2 text-xs">
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{aiSummary.summary}</p>
                {aiSummary.key_points.length > 0 && (
                  <ul className="space-y-0.5 pl-2">
                    {aiSummary.key_points.map((pt, i) => (
                      <li key={i} className="text-gray-600 dark:text-gray-400 flex gap-1.5">
                        <span className="text-purple-500 shrink-0">•</span>{pt}
                      </li>
                    ))}
                  </ul>
                )}
                {aiSummary.suggested_action && (
                  <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded p-2">
                    <span className="text-purple-700 dark:text-purple-300 font-medium">{t('ai_recommendation')} </span>
                    <span className="text-purple-600 dark:text-purple-400">{aiSummary.suggested_action}</span>
                  </div>
                )}
                <p className="text-gray-400 dark:text-gray-600 text-[10px]">{t('ai_comments_analyzed', { n: aiSummary.comment_count })}</p>
              </div>
            )}
            {!aiSummary && !aiSummaryLoading && !aiSummaryError && (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('ai_prompt_empty')}</p>
            )}
          </div>
        )}

        {/* 연관 티켓 패널 — 에이전트 (개발자 탭과 중복 방지) */}
        {isAgent && !isDeveloper && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {t('related_tickets_header', { n: links.length })}
            </h3>
            {links.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {links.map((link) => (
                  <li key={link.id} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                        link.link_type === 'blocks'         ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400' :
                        link.link_type === 'is_blocked_by'  ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' :
                        link.link_type === 'duplicate_of'   ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400' :
                                                              'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {link.link_type === 'blocks' ? t('link_type_blocks') : link.link_type === 'is_blocked_by' ? t('link_type_blocked_by') : link.link_type === 'duplicate_of' ? t('link_type_duplicate_of') : t('link_type_relates_to')}
                      </span>
                      <a href={`/tickets/${link.target_iid}`} className="font-mono text-blue-600 dark:text-blue-400 hover:underline truncate">
                        #{link.target_iid}
                      </a>
                    </div>
                    <button onClick={() => handleDeleteLink(link.id)} className="shrink-0 text-gray-400 dark:text-gray-500 hover:text-red-500 ml-1" aria-label={t('link_delete_aria')}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleAddLink} className="space-y-2">
              <select
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="w-full border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="relates_to">{t('link_type_relates_opt')}</option>
                <option value="blocks">{t('link_type_blocks_opt')}</option>
                <option value="duplicate_of">{t('link_type_duplicate_opt')}</option>
              </select>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  value={linkTargetIid}
                  onChange={(e) => setLinkTargetIid(e.target.value)}
                  placeholder={t('link_num_placeholder')}
                  className="flex-1 border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={addingLink || !linkTargetIid}
                  className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingLink ? t('link_adding') : t('link_add_btn')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* IT 도구 탭 패널 — IT 개발자 이상 */}
        {isDeveloper && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm overflow-hidden">
            {/* 탭 헤더 */}
            <div className="flex border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              {sideTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSideTab(tab.key)}
                  className={`flex-1 text-xs py-2 font-medium transition-colors border-b-2 ${
                    sideTab === tab.key
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-3">
              {/* 탭: 연관 티켓 */}
              {sideTab === 'links' && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('related_tickets_label_n', { n: links.length })}</p>
                  {links.length > 0 && (
                    <ul className="space-y-1.5 mb-3">
                      {links.map((link) => (
                        <li key={link.id} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-medium ${
                              link.link_type === 'blocks'          ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400' :
                              link.link_type === 'is_blocked_by'   ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400' :
                              link.link_type === 'duplicate_of'    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400' :
                                                                     'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                            }`}>
                              {link.link_type === 'blocks' ? t('link_type_blocks') : link.link_type === 'is_blocked_by' ? t('link_type_blocked_by') : link.link_type === 'duplicate_of' ? t('link_type_duplicate_of') : t('link_type_relates_to')}
                            </span>
                            <Link
                              href={`/tickets/${link.target_iid}`}
                              className="font-mono text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline truncate"
                            >
                              #{link.target_iid}
                            </Link>
                          </div>
                          <button onClick={() => handleDeleteLink(link.id)} className="shrink-0 text-gray-400 dark:text-gray-500 hover:text-red-500 ml-1" aria-label={t('link_delete_aria')}>✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form onSubmit={handleAddLink} className="space-y-2">
                    <select
                      value={linkType}
                      onChange={(e) => setLinkType(e.target.value)}
                      className="w-full border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="relates_to">{t('link_type_relates_opt')}</option>
                      <option value="blocks">{t('link_type_blocks_opt')}</option>
                      <option value="duplicate_of">{t('link_type_duplicate_opt')}</option>
                    </select>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min={1}
                        value={linkTargetIid}
                        onChange={(e) => setLinkTargetIid(e.target.value)}
                        placeholder={t('link_num_placeholder')}
                        className="flex-1 border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={addingLink || !linkTargetIid}
                        className="bg-blue-600 text-white px-2 py-1 rounded text-xs hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingLink ? t('link_adding') : t('link_add_btn')}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* 탭: 시간 기록 */}
              {sideTab === 'time' && ticket?.project_id && (
                <TimeTracker
                  iid={iid}
                  projectId={ticket.project_id}
                  canLog={isAgent}
                  currentUserId={user?.sub ? String(user.sub) : undefined}
                  isAdmin={isAdmin || isAgent}
                />
              )}

              {/* 탭: 개발 프로젝트 전달 */}
              {sideTab === 'forward' && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('forward_header')}</p>

                  {/* 모든 전달 이슈가 완료됐을 때 안내 배지 */}
                  {forwardsAllClosed && forwards.length > 0 && (
                    <div className="mb-2 px-2 py-1.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                      <span>✓</span>
                      <span>{t('forward_all_done')}</span>
                    </div>
                  )}

                  {forwards.length > 0 && (
                    <ul className="space-y-1.5 mb-3">
                      {forwards.map((fwd) => {
                        const isClosed = fwd.target_state === 'closed'
                        const statusLabel = fwd.target_status
                          ? ({ open: t('forward_status_open'), in_progress: t('forward_status_in_progress'), resolved: t('forward_status_resolved'), closed: t('forward_status_closed') }[fwd.target_status as 'open' | 'in_progress' | 'resolved' | 'closed']) ?? fwd.target_status
                          : null
                        return (
                          <li key={fwd.id} className={`text-xs border rounded px-2 py-1.5 ${isClosed ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-700/50' : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-700/50'}`}>
                            <div className="flex items-start justify-between gap-1">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{fwd.target_project_name}</span>
                                  {fwd.target_web_url ? (
                                    <a href={fwd.target_web_url} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 hover:underline">#{fwd.target_iid}</a>
                                  ) : (
                                    <span className="font-mono text-gray-600">#{fwd.target_iid}</span>
                                  )}
                                  {/* 전달 이슈 현재 상태 배지 */}
                                  {fwd.target_state === null ? (
                                    <span className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 text-[10px]">{t('forward_fetch_failed')}</span>
                                  ) : statusLabel ? (
                                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${isClosed ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'}`}>
                                      {statusLabel}
                                    </span>
                                  ) : null}
                                </div>
                                {fwd.target_assignee && (
                                  <p className="text-gray-500 dark:text-gray-400 mt-0.5">{t('forward_assignee_prefix', { name: fwd.target_assignee })}</p>
                                )}
                                {fwd.note && <p className="text-gray-500 dark:text-gray-400 truncate mt-0.5">{fwd.note}</p>}
                                <p className="text-gray-400 dark:text-gray-500 mt-0.5">{formatName(fwd.created_by_name)} · {new Date(fwd.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</p>
                              </div>
                              {isAdmin && (
                                <button onClick={() => handleDeleteForward(fwd.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0" aria-label={t('link_delete_aria')}>✕</button>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {isAgent && (
                    <form onSubmit={handleForward} className="space-y-2">
                      <select
                        value={selectedDevProject}
                        onChange={(e) => setSelectedDevProject(e.target.value)}
                        required
                        className="w-full border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">{t('forward_project_select')}</option>
                        {devProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        value={forwardNote}
                        onChange={(e) => setForwardNote(e.target.value)}
                        placeholder={t('forward_note_placeholder')}
                        className="w-full border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <button
                        type="submit"
                        disabled={forwarding || !selectedDevProject}
                        className="w-full bg-indigo-600 text-white py-1 rounded text-xs hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {forwarding ? t('forwarding') : t('forward_btn')}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* 탭: 연결된 MR — IT 관리자 이상 */}
              {isAgent && sideTab === 'mr' && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('linked_mrs_header', { n: linkedMRs.length })}</p>
                  {linkedMRs.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">{t('no_linked_mrs')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {linkedMRs.map((mr) => (
                        <li key={mr.iid} className="text-xs bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${mr.state === 'merged' ? 'bg-purple-500' : mr.state === 'opened' ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <a href={mr.web_url} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline shrink-0">!{mr.iid}</a>
                            <span className="text-gray-700 dark:text-gray-300 truncate flex-1">{mr.title}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 pl-3.5">
                            <span className="text-gray-400 dark:text-gray-500 capitalize">{mr.state}</span>
                            {mr.author_name && <span className="text-gray-400 dark:text-gray-500">{mr.author_name}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 탭: CI/CD 파이프라인 트리거 */}
              {isAgent && sideTab === 'pipeline' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('pipeline_intro_prefix')}<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ITSM_TICKET_IID</code>{t('pipeline_intro_suffix')}</p>

                  {pipelineError && <p className="text-xs text-red-600 dark:text-red-400">⚠️ {pipelineError}</p>}
                  {pipelineResult && (
                    <div className="text-xs bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg p-2">
                      {t('pipeline_success_prefix')}<a href={pipelineResult.web_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline font-mono">#{pipelineResult.id}</a>{t('pipeline_success_suffix', { status: pipelineResult.status })}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={t('pipeline_branch_placeholder')}
                      value={pipelineRef}
                      onChange={e => setPipelineRef(e.target.value)}
                      className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-md px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <button
                      onClick={async () => {
                        setTriggeringPipeline(true)
                        setPipelineError(null)
                        setPipelineResult(null)
                        try {
                          const params = new URLSearchParams({ ref: pipelineRef })
                          if (projectId) params.set('project_id', projectId)
                          const r = await fetch(`${API_BASE}/tickets/${iid}/pipeline?${params}`, {
                            method: 'POST', credentials: 'include',
                          })
                          if (!r.ok) {
                            const d = await r.json().catch(() => ({}))
                            setPipelineError(d.detail ?? t('pipeline_trigger_failed'))
                          } else {
                            const d = await r.json()
                            setPipelineResult(d)
                            // Refresh pipeline list
                            const listParams = new URLSearchParams()
                            if (projectId) listParams.set('project_id', projectId)
                            const lr = await fetch(`${API_BASE}/tickets/${iid}/pipelines?${listParams}`, { credentials: 'include' })
                            if (lr.ok) setPipelines(await lr.json())
                          }
                        } catch {
                          setPipelineError(t('pipeline_trigger_network'))
                        } finally {
                          setTriggeringPipeline(false)
                        }
                      }}
                      disabled={triggeringPipeline || !pipelineRef}
                      className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap font-medium"
                    >
                      {triggeringPipeline ? t('pipeline_running') : t('pipeline_run_btn')}
                    </button>
                  </div>

                  {/* 최근 파이프라인 목록 */}
                  {pipelines.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('pipeline_recent_header')}</p>
                      <ul className="space-y-1">
                        {pipelines.slice(0, 5).map(p => (
                          <li key={p.id} className="flex items-center gap-2 text-xs">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              p.status === 'success' ? 'bg-green-500' :
                              p.status === 'failed' ? 'bg-red-500' :
                              p.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'
                            }`} />
                            <a href={p.web_url} target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline">#{p.id}</a>
                            <span className="text-gray-500 dark:text-gray-400 font-mono">{p.ref}</span>
                            <span className="text-gray-400 dark:text-gray-500 capitalize ml-auto">{p.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 구독 버튼 */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
          <button
            onClick={handleToggleWatch}
            disabled={watchLoading}
            className={`w-full text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isWatching
                ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {watchLoading ? t('watching_loading') : isWatching ? t('watching_cancel') : t('watching_start')}
          </button>
        </div>

        {/* 인쇄 / PDF 출력 */}
        {ticket && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4 print-hidden">
            <button
              onClick={() => window.print()}
              className="w-full text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors font-medium"
            >
              {t('print_pdf')}
            </button>
          </div>
        )}

        {/* 티켓 복제 — IT 개발자 이상 */}
        {isDeveloper && ticket && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('clone_desc')}</p>
            {cloneError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">⚠️ {cloneError}</p>
            )}
            <button
              onClick={handleClone}
              disabled={cloning}
              className="w-full text-xs px-3 py-1.5 border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {cloning ? t('cloning') : t('clone_btn')}
            </button>
          </div>
        )}

        {/* 티켓 병합 — 에이전트 이상 */}
        {isAgent && ticket && ticket.status !== 'closed' && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('merge_desc')}</p>
            {mergeError && <p className="text-xs text-red-600 dark:text-red-400 mb-2">⚠️ {mergeError}</p>}
            {mergeSuccess && <p className="text-xs text-green-600 dark:text-green-400 mb-2">{t('merge_success')}</p>}
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                placeholder={t('merge_target_placeholder')}
                value={mergeTargetIid}
                onChange={e => setMergeTargetIid(e.target.value)}
                className="flex-1 text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={handleMerge}
                disabled={merging || !mergeTargetIid || mergeSuccess}
                className="text-xs px-3 py-1.5 border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap"
              >
                {merging ? t('merging') : t('merge_btn')}
              </button>
            </div>
          </div>
        )}

        {/* 삭제 버튼 — admin 또는 접수 상태 본인 */}
        {canDelete && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            {actionError && !isDeveloper && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">⚠️ {actionError}</p>
            )}
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{t('delete_confirm_prompt')}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleting ? t('deleting') : t('delete_confirm_btn')}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 text-xs px-3 py-1.5 border dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {t('delete_cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-xs px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
              >
                {t('delete_btn')}
              </button>
            )}
          </div>
        )}

        {/* 현재 접속자 */}
        {viewers.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {t('active_viewers')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {viewers.map((v) => (
                <div
                  key={v.id}
                  title={v.name}
                  className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-semibold uppercase shrink-0"
                >
                  {v.name.charAt(0)}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
              {viewers.map((v) => v.name).join(', ')}
            </p>
          </div>
        )}

      </div>
      {/* END RIGHT SIDEBAR */}
    </div>

    {lightbox && (
      <Lightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />
    )}
    </>
  )
}

function TicketLoadingFallback() {
  const t = useTranslations('ticket_detail')
  return <div className="text-center py-16 text-gray-500">{t('loading_fallback')}</div>
}

export default function TicketDetailPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<TicketLoadingFallback />}>
        <TicketDetailContent />
      </Suspense>
    </RequireAuth>
  )
}
