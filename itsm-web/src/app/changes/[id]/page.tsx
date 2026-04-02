'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import { getChange, transitionChange, type ChangeRequest } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { formatDate } from '@/lib/utils'

const STATUS_LABELS: Record<string, string> = {
  draft: '초안', submitted: '제출됨', reviewing: '심의 중',
  approved: '승인됨', rejected: '반려됨', implementing: '구현 중',
  implemented: '구현 완료', failed: '구현 실패', cancelled: '취소됨',
}

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

const RISK_LABELS: Record<string, string> = { low: '낮음', medium: '중간', high: '높음', critical: '치명적' }
const TYPE_LABELS: Record<string, string> = { standard: '✅ 정형', normal: '📋 일반', emergency: '🚨 긴급' }

const NEXT_TRANSITIONS: Record<string, Array<{ status: string; label: string; color: string; needsComment: boolean }>> = {
  draft: [
    { status: 'submitted',  label: '제출',    color: 'bg-blue-600 hover:bg-blue-700 text-white',     needsComment: false },
    { status: 'cancelled',  label: '취소',    color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  submitted: [
    { status: 'reviewing',  label: '심의 시작', color: 'bg-yellow-500 hover:bg-yellow-600 text-white', needsComment: false },
    { status: 'cancelled',  label: '취소',    color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  reviewing: [
    { status: 'approved',   label: '승인',    color: 'bg-teal-600 hover:bg-teal-700 text-white',     needsComment: true  },
    { status: 'rejected',   label: '반려',    color: 'bg-red-600 hover:bg-red-700 text-white',       needsComment: true  },
    { status: 'cancelled',  label: '취소',    color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  approved: [
    { status: 'implementing', label: '구현 시작', color: 'bg-purple-600 hover:bg-purple-700 text-white', needsComment: false },
    { status: 'cancelled',    label: '취소',    color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
  implementing: [
    { status: 'implemented', label: '구현 완료', color: 'bg-green-600 hover:bg-green-700 text-white', needsComment: true  },
    { status: 'failed',      label: '구현 실패', color: 'bg-red-600 hover:bg-red-700 text-white',    needsComment: true  },
    { status: 'cancelled',   label: '취소',    color: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200', needsComment: false },
  ],
}

const STATUS_STEPS = ['draft', 'submitted', 'reviewing', 'approved', 'implementing', 'implemented']

const TERMINAL_STYLE: Record<string, { bg: string; icon: string; label: string }> = {
  rejected:  { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',   icon: '🚫', label: '반려됨' },
  failed:    { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',   icon: '❌', label: '구현 실패' },
  cancelled: { bg: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700', icon: '⛔', label: '취소됨' },
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
      <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  )
}

function ChangeDetailContent() {
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
      .catch(e => setError(e instanceof Error ? e.message : '로드 실패'))
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
      alert(e instanceof Error ? e.message : '상태 변경 실패')
    } finally {
      setTransitioning(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <span className="animate-spin mr-2">⏳</span> 로딩 중...
    </div>
  )
  if (error || !cr) return (
    <div className="flex items-center justify-center py-32 text-red-400">⚠️ {error || '찾을 수 없습니다'}</div>
  )

  const transitions = NEXT_TRANSITIONS[cr.status] ?? []
  const canTransition = (t: typeof transitions[0]) =>
    t.status === 'cancelled' ? (isAgent || isOwner(cr)) : isAgent

  const currentStep = STATUS_STEPS.indexOf(cr.status)
  const isTerminal = ['rejected', 'failed', 'cancelled'].includes(cr.status)
  const terminalStyle = TERMINAL_STYLE[cr.status]

  return (
    <div className="space-y-5">

      {/* ── 헤더 ── */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm">
          <Link href="/changes" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            변경관리
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
                  {STATUS_LABELS[cr.status] ?? cr.status}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {TYPE_LABELS[cr.change_type] ?? cr.change_type}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs ${RISK_BADGE[cr.risk_level]}`}>
                  ⚡ {RISK_LABELS[cr.risk_level] ?? cr.risk_level} 위험
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">#{cr.id}</span>
              </div>
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 text-right shrink-0">
              <p>요청자 <span className="text-gray-700 dark:text-gray-300 font-medium">{cr.requester_name ?? cr.requester_username}</span></p>
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
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">이 변경 요청은 <span className="font-bold">{terminalStyle.label}</span> 상태입니다.</p>
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
                  {STATUS_LABELS[s]}
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
            <span>🔀</span> 상태 변경
          </p>
          {showCommentFor && (
            <div className="mb-3">
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={2}
                placeholder={
                  showCommentFor === 'approved'    ? '승인 코멘트 (선택)' :
                  showCommentFor === 'rejected'    ? '반려 사유를 입력하세요' :
                  '처리 결과를 입력하세요'
                }
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {showCommentFor ? (
              <>
                {transitions.filter(t => t.status === showCommentFor && canTransition(t)).map(t => (
                  <button
                    key={t.status}
                    onClick={() => handleTransition(t.status, false)}
                    disabled={transitioning}
                    className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${t.color}`}
                  >
                    {transitioning ? '처리 중...' : '확인'}
                  </button>
                ))}
                <button
                  onClick={() => { setShowCommentFor(null); setComment('') }}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  취소
                </button>
              </>
            ) : (
              transitions.map(t => canTransition(t) && (
                <button
                  key={t.status}
                  onClick={() => handleTransition(t.status, t.needsComment)}
                  disabled={transitioning}
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${t.color}`}
                >
                  {transitioning ? '처리 중...' : t.label}
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
                <span>📝</span> 변경 내용
              </h2>
              {cr.description    && <ContentBlock label="상세 설명">{cr.description}</ContentBlock>}
              {cr.impact         && <ContentBlock label="영향 범위">{cr.impact}</ContentBlock>}
              {cr.rollback_plan  && <ContentBlock label="롤백 계획">{cr.rollback_plan}</ContentBlock>}
              {cr.result_note    && (
                <ContentBlock label="처리 결과">
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
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">요청 정보</h3>
            <InfoRow icon="👤" label="요청자">{cr.requester_name ?? cr.requester_username}</InfoRow>
            <InfoRow icon="📅" label="생성일">{formatDate(cr.created_at ?? '')}</InfoRow>
            <InfoRow icon="🔄" label="수정일">{formatDate(cr.updated_at ?? '')}</InfoRow>
            {cr.related_ticket_iid && (
              <InfoRow icon="🔗" label="관련 티켓">
                <Link href={`/tickets/${cr.related_ticket_iid}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  #{cr.related_ticket_iid}
                </Link>
              </InfoRow>
            )}
          </div>

          {/* 구현 일정 */}
          {(cr.scheduled_start_at || cr.scheduled_end_at || cr.actual_start_at || cr.actual_end_at) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">구현 일정</h3>
              {cr.scheduled_start_at && <InfoRow icon="▶️" label="예정 시작">{formatDate(cr.scheduled_start_at)}</InfoRow>}
              {cr.scheduled_end_at   && <InfoRow icon="⏹️" label="예정 종료">{formatDate(cr.scheduled_end_at)}</InfoRow>}
              {cr.actual_start_at    && <InfoRow icon="🟢" label="실제 시작">{formatDate(cr.actual_start_at)}</InfoRow>}
              {cr.actual_end_at      && <InfoRow icon="🏁" label="실제 종료">{formatDate(cr.actual_end_at)}</InfoRow>}
            </div>
          )}

          {/* 승인 정보 */}
          {(cr.approver_username || cr.approval_comment) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                {cr.status === 'rejected' ? '반려 정보' : '승인 정보'}
              </h3>
              {cr.approver_username && <InfoRow icon="👨‍⚖️" label="처리자">{cr.approver_name ?? cr.approver_username}</InfoRow>}
              {cr.approved_at       && <InfoRow icon="📅" label="처리일">{formatDate(cr.approved_at)}</InfoRow>}
              {cr.approval_comment  && <InfoRow icon="💬" label="코멘트">{cr.approval_comment}</InfoRow>}
            </div>
          )}

          {/* 구현 담당 */}
          {cr.implementer_username && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">구현 담당</h3>
              <InfoRow icon="🛠️" label="담당자">{cr.implementer_username}</InfoRow>
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
