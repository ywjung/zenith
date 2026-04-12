'use client'

import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import { getChange, transitionChange, type ChangeRequest } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { formatDate, errorMessage } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false })

// 상태 레이블은 changes 네임스페이스의 status_* 키를 통해 i18n 처리됨

const STATUS_COLORS: Record<string, string> = {
  draft:        'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  submitted:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  reviewing:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  approved:     'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  rejected:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  implementing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  implemented:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed:       'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  cancelled:    'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const STATUS_BORDER: Record<string, string> = {
  draft:        'border-l-gray-400',
  submitted:    'border-l-blue-500',
  reviewing:    'border-l-yellow-500',
  approved:     'border-l-teal-500',
  rejected:     'border-l-red-500',
  implementing: 'border-l-purple-500',
  implemented:  'border-l-green-500',
  failed:       'border-l-red-600',
  cancelled:    'border-l-gray-400',
}

const RISK_BADGE: Record<string, string> = {
  low:      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800',
  medium:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-200 dark:border-orange-800',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800 font-bold',
}

const RISK_KEY: Record<string, string> = { low: 'risk_low', medium: 'risk_medium', high: 'risk_high', critical: 'risk_critical' }
const TYPE_KEY: Record<string, string> = { standard: 'type_standard', normal: 'type_normal', emergency: 'type_emergency' }

const NEXT_TRANSITIONS: Record<string, Array<{ status: string; labelKey: string; color: string; needsComment: boolean }>> = {
  draft: [
    { status: 'submitted',    labelKey: 'action_submit',           color: 'bg-blue-600 hover:bg-blue-700 text-white',     needsComment: false },
    { status: 'cancelled',    labelKey: 'action_cancel',           color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  submitted: [
    { status: 'reviewing',    labelKey: 'action_start_review',     color: 'bg-yellow-500 hover:bg-yellow-600 text-white', needsComment: false },
    { status: 'cancelled',    labelKey: 'action_cancel',           color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  reviewing: [
    { status: 'approved',     labelKey: 'action_approve',          color: 'bg-teal-600 hover:bg-teal-700 text-white',     needsComment: true  },
    { status: 'rejected',     labelKey: 'action_reject',           color: 'bg-red-600 hover:bg-red-700 text-white',       needsComment: true  },
    { status: 'cancelled',    labelKey: 'action_cancel',           color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  approved: [
    { status: 'implementing', labelKey: 'action_start_implement',  color: 'bg-purple-600 hover:bg-purple-700 text-white', needsComment: false },
    { status: 'cancelled',    labelKey: 'action_cancel',           color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  implementing: [
    { status: 'implemented',  labelKey: 'action_implemented',      color: 'bg-green-600 hover:bg-green-700 text-white',   needsComment: true  },
    { status: 'failed',       labelKey: 'action_failed',           color: 'bg-red-600 hover:bg-red-700 text-white',       needsComment: true  },
    { status: 'cancelled',    labelKey: 'action_cancel',           color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
}

const STATUS_STEPS = ['draft', 'submitted', 'reviewing', 'approved', 'implementing', 'implemented']

const TERMINAL_STYLE: Record<string, { bg: string; icon: string; labelKey: string }> = {
  rejected:  { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',   icon: '🚫', labelKey: 'terminal_rejected' },
  failed:    { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',   icon: '❌', labelKey: 'terminal_failed' },
  cancelled: { bg: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700', icon: '⛔', labelKey: 'terminal_cancelled' },
}

function InfoRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-base mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
        <div className="text-sm text-gray-900 dark:text-white mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function ContentBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3.5">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
        {typeof children === 'string' ? <MarkdownRenderer content={children} /> : children}
      </div>
    </div>
  )
}

function ChangeDetailContent() {
  const t = useTranslations('changes_detail')
  const tc = useTranslations('changes')
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAgent = user?.role === 'admin' || user?.role === 'agent'
  const isOwner = (cr: ChangeRequest) => cr.requester_username === user?.username

  const [cr, setCr] = useState<ChangeRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [comment, setComment] = useState('')
  const [showCommentFor, setShowCommentFor] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    getChange(parseInt(id))
      .then(setCr)
      .catch(e => setError(errorMessage(e, t('load_failed'))))
      .finally(() => setLoading(false))
  }, [id])

  const handleTransition = async (newStatus: string, needsComment: boolean) => {
    if (needsComment && !comment.trim() && !showCommentFor) {
      setShowCommentFor(newStatus)
      return
    }
    setTransitioning(true)
    try {
      setCr(await transitionChange(parseInt(id), newStatus, comment || undefined))
      setComment('')
      setShowCommentFor(null)
    } catch (e: unknown) {
      toast.error(errorMessage(e, t('transition_failed')))
    } finally {
      setTransitioning(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <span className="animate-spin mr-2">⏳</span> {t('loading')}
    </div>
  )
  if (error || !cr) return (
    <div className="flex items-center justify-center py-32 text-red-400">⚠️ {error || t('not_found')}</div>
  )

  const transitions = NEXT_TRANSITIONS[cr.status] ?? []
  const canTransition = (tr: typeof transitions[0]) =>
    tr.status === 'cancelled' ? (isAgent || isOwner(cr)) : isAgent

  const currentStep = STATUS_STEPS.indexOf(cr.status)
  const isTerminal = ['rejected', 'failed', 'cancelled'].includes(cr.status)
  const terminalStyle = TERMINAL_STYLE[cr.status]

  return (
    <div className="space-y-5">

      {/* ── 헤더 ── */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm">
          <Link href="/changes" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            {t('breadcrumb_changes')}
          </Link>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="text-gray-500 dark:text-gray-400">#{cr.id}</span>
        </div>

        <div className={`bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 border-l-4 ${STATUS_BORDER[cr.status]} p-5`}>
          <div className="flex flex-wrap items-start gap-3 justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">
                {cr.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[cr.status]}`}>
                  {tc(`status_${cr.status}` as 'status_draft') || cr.status}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {TYPE_KEY[cr.change_type] ? t(TYPE_KEY[cr.change_type] as 'type_standard') : cr.change_type}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs ${RISK_BADGE[cr.risk_level]}`}>
                  {t('risk_suffix', { level: RISK_KEY[cr.risk_level] ? t(RISK_KEY[cr.risk_level] as 'risk_low') : cr.risk_level })}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">#{cr.id}</span>
              </div>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 text-right shrink-0">
              <p>{t('requester_label_inline')} <span className="text-gray-700 dark:text-gray-300 font-medium">{cr.requester_name ?? cr.requester_username}</span></p>
              <p className="mt-0.5">{formatDate(cr.created_at ?? '')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 터미널 상태 배너 ── */}
      {isTerminal && terminalStyle && (
        <div className={`rounded-2xl border p-4 flex items-center gap-3 ${terminalStyle.bg}`}>
          <span className="text-2xl">{terminalStyle.icon}</span>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200" dangerouslySetInnerHTML={{ __html: t('terminal_banner', { label: `<strong>${t(terminalStyle.labelKey as 'terminal_rejected')}</strong>` }) }} />
            {cr.approval_comment && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cr.approval_comment}</p>
            )}
          </div>
        </div>
      )}

      {/* ── 진행 흐름 ── */}
      {!isTerminal && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 px-5 py-4">
          <div className="flex items-start">
            {STATUS_STEPS.map((s, i) => (
              <div key={s} className="flex flex-col items-start flex-1">
                <div className="flex items-center w-full">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    i < currentStep  ? 'bg-teal-500 text-white shadow-sm shadow-teal-200 dark:shadow-teal-900' :
                    i === currentStep ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/60' :
                    'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  }`}>
                    {i < currentStep ? '✓' : i + 1}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`flex-1 h-1 mx-1 rounded-full transition-all ${
                      i < currentStep ? 'bg-teal-500' : 'bg-gray-100 dark:bg-gray-800'
                    }`} />
                  )}
                </div>
                <div className={`text-xs w-8 text-center mt-1.5 leading-tight font-medium ${
                  i === currentStep ? 'text-blue-600 dark:text-blue-400' :
                  i < currentStep   ? 'text-teal-600 dark:text-teal-400' :
                  'text-gray-400 dark:text-gray-500'
                }`}>
                  {tc(`status_${s}` as 'status_draft')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 상태 전이 ── */}
      {transitions.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            {t('status_change')}
          </p>
          {showCommentFor && (
            <div className="mb-3">
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                placeholder={
                  showCommentFor === 'approved'    ? t('approval_comment') :
                  showCommentFor === 'rejected'    ? t('rejection_comment') :
                  t('result_comment')
                }
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {showCommentFor ? (
              <>
                {transitions.filter(tr => tr.status === showCommentFor && canTransition(tr)).map(tr => (
                  <button
                    key={tr.status}
                    onClick={() => handleTransition(tr.status, false)}
                    disabled={transitioning}
                    className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tr.color}`}
                  >
                    {transitioning ? t('processing') : t('confirm')}
                  </button>
                ))}
                <button
                  onClick={() => { setShowCommentFor(null); setComment('') }}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  {t('cancel')}
                </button>
              </>
            ) : (
              transitions.map(tr => canTransition(tr) && (
                <button
                  key={tr.status}
                  onClick={() => handleTransition(tr.status, tr.needsComment)}
                  disabled={transitioning}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tr.color}`}
                >
                  {transitioning ? t('processing') : t(tr.labelKey as 'action_submit')}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── 본문 + 사이드 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* 메인 */}
        <div className="lg:col-span-2 space-y-5">

          {/* 변경 내용 */}
          {(cr.description || cr.impact || cr.rollback_plan || cr.result_note) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                {t('content_header')}
              </h2>
              {cr.description    && <ContentBlock label={t('content_description')}>{cr.description}</ContentBlock>}
              {cr.impact         && <ContentBlock label={t('content_impact')}>{cr.impact}</ContentBlock>}
              {cr.rollback_plan  && <ContentBlock label={t('content_rollback')}>{cr.rollback_plan}</ContentBlock>}
              {cr.result_note    && (
                <ContentBlock label={t('content_result')}>
                  <span className="text-green-700 dark:text-green-300">{cr.result_note}</span>
                </ContentBlock>
              )}
            </div>
          )}
        </div>

        {/* 사이드바 */}
        <div className="space-y-4">

          {/* 요청 정보 */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{t('request_info')}</h3>
            <InfoRow icon="👤" label={t('label_requester')}>{cr.requester_name ?? cr.requester_username}</InfoRow>
            <InfoRow icon="📅" label={t('label_created')}>{formatDate(cr.created_at ?? '')}</InfoRow>
            <InfoRow icon="🔄" label={t('label_updated')}>{formatDate(cr.updated_at ?? '')}</InfoRow>
            {cr.related_ticket_iid && (
              <InfoRow icon="🔗" label={t('label_related')}>
                <Link href={`/tickets/${cr.related_ticket_iid}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  #{cr.related_ticket_iid}
                </Link>
              </InfoRow>
            )}
          </div>

          {/* 구현 일정 */}
          {(cr.scheduled_start_at || cr.scheduled_end_at || cr.actual_start_at || cr.actual_end_at) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{t('schedule_info')}</h3>
              {cr.scheduled_start_at && <InfoRow icon="▶️" label={t('label_scheduled_start')}>{formatDate(cr.scheduled_start_at)}</InfoRow>}
              {cr.scheduled_end_at   && <InfoRow icon="⏹️" label={t('label_scheduled_end')}>{formatDate(cr.scheduled_end_at)}</InfoRow>}
              {cr.actual_start_at    && <InfoRow icon="🟢" label={t('label_actual_start')}>{formatDate(cr.actual_start_at)}</InfoRow>}
              {cr.actual_end_at      && <InfoRow icon="🏁" label={t('label_actual_end')}>{formatDate(cr.actual_end_at)}</InfoRow>}
            </div>
          )}

          {/* 승인 정보 */}
          {(cr.approver_username || cr.approval_comment) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                {cr.status === 'rejected' ? t('rejection_info') : t('approval_info')}
              </h3>
              {cr.approver_username && <InfoRow icon="👨‍⚖️" label={t('label_approver')}>{cr.approver_name ?? cr.approver_username}</InfoRow>}
              {cr.approved_at       && <InfoRow icon="📅" label={t('label_approved_at')}>{formatDate(cr.approved_at)}</InfoRow>}
              {cr.approval_comment  && <InfoRow icon="💬" label={t('label_comment')}>{cr.approval_comment}</InfoRow>}
            </div>
          )}

          {/* 구현 담당 */}
          {cr.implementer_username && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{t('implementer_info')}</h3>
              <InfoRow icon="🛠️" label={t('label_implementer')}>{cr.implementer_username}</InfoRow>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

export default function ChangeDetailPage() {
  return (
    <RequireAuth>
      <ChangeDetailContent />
    </RequireAuth>
  )
}
