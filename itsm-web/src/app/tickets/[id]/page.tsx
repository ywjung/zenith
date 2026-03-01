'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fetchTicket, fetchComments, fetchRating, updateTicket, addComment, deleteTicket } from '@/lib/api'
import type { Ticket, Comment, Rating } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge } from '@/components/StatusBadge'
import RequireAuth from '@/components/RequireAuth'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StarDisplay({ score }: { score: number }) {
  return (
    <span className="text-yellow-400 text-lg">
      {'★'.repeat(score)}
      {'☆'.repeat(5 - score)}
    </span>
  )
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
  { value: 'critical', label: '긴급' },
]

function TicketDetailContent() {
  const params = useParams()
  const router = useRouter()
  const iid = Number(params.id)

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [rating, setRating] = useState<Rating | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!iid) return
    Promise.all([fetchTicket(iid), fetchComments(iid), fetchRating(iid)])
      .then(([t, c, r]) => {
        setTicket(t)
        setComments(c)
        setRating(r)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [iid])

  async function handleStatusChange(newStatus: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      const updated = await updateTicket(iid, { status: newStatus })
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '상태 변경 실패')
    } finally {
      setUpdating(false)
    }
  }

  async function handlePriorityChange(newPriority: string) {
    if (!ticket) return
    setUpdating(true)
    setActionError(null)
    try {
      const updated = await updateTicket(iid, { priority: newPriority })
      setTicket(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '우선순위 변경 실패')
    } finally {
      setUpdating(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setActionError(null)
    try {
      await deleteTicket(iid)
      router.push('/')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '티켓 삭제 실패')
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault()
    if (!newComment.trim()) return
    setCommenting(true)
    setActionError(null)
    try {
      const comment = await addComment(iid, newComment.trim())
      setComments((prev) => [...prev, comment])
      setNewComment('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '코멘트 추가 실패')
    } finally {
      setCommenting(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-4xl mb-3">⏳</div>
        <p>불러오는 중...</p>
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-red-600">{error || '티켓을 찾을 수 없습니다.'}</p>
        <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline">
          목록으로
        </Link>
      </div>
    )
  }

  const isClosed = ticket.state === 'closed'
  const canRate = isClosed && !rating

  // 상태에 따른 액션 버튼 결정
  const statusActions: { label: string; status: string; color: string }[] = []
  if (!isClosed) {
    if (ticket.status === 'open') {
      statusActions.push({ label: '처리 시작', status: 'in_progress', color: 'bg-blue-500 hover:bg-blue-600 text-white' })
    }
    if (ticket.status === 'in_progress') {
      statusActions.push({ label: '처리 완료', status: 'resolved', color: 'bg-green-500 hover:bg-green-600 text-white' })
    }
    if (ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'resolved') {
      statusActions.push({ label: '티켓 종료', status: 'closed', color: 'bg-gray-500 hover:bg-gray-600 text-white' })
    }
  } else {
    statusActions.push({ label: '티켓 재개', status: 'reopened', color: 'bg-yellow-500 hover:bg-yellow-600 text-white' })
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-blue-600 hover:underline text-sm">
          ← 목록으로
        </Link>
      </div>

      {/* 티켓 헤더 */}
      <div className="bg-white rounded-lg border shadow-sm p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-gray-400 text-sm font-mono">#{ticket.iid}</span>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <CategoryBadge category={ticket.category} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">{ticket.title}</h1>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-gray-600 border-t pt-4">
          <div>
            <span className="font-medium text-gray-500">신청자</span>
            <p className="mt-0.5">{ticket.employee_name || '-'}</p>
          </div>
          <div>
            <span className="font-medium text-gray-500">이메일</span>
            <p className="mt-0.5">{ticket.employee_email || '-'}</p>
          </div>
          <div>
            <span className="font-medium text-gray-500">등록일시</span>
            <p className="mt-0.5">{formatDate(ticket.created_at)}</p>
          </div>
          <div>
            <span className="font-medium text-gray-500">최종수정</span>
            <p className="mt-0.5">{formatDate(ticket.updated_at)}</p>
          </div>
        </div>

        {/* 관리 컨트롤 */}
        <div className="mt-4 border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-600 w-16 shrink-0">우선순위</span>
            <select
              value={ticket.priority || 'medium'}
              onChange={(e) => handlePriorityChange(e.target.value)}
              disabled={updating}
              className="text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-600 w-16 shrink-0">상태 변경</span>
            <div className="flex flex-wrap gap-2">
              {statusActions.map((action) => (
                <button
                  key={action.status}
                  onClick={() => handleStatusChange(action.status)}
                  disabled={updating}
                  className={`text-sm px-3 py-1 rounded-md font-medium transition-colors disabled:opacity-50 ${action.color}`}
                >
                  {updating ? '처리 중...' : action.label}
                </button>
              ))}
            </div>
          </div>

          {actionError && (
            <p className="text-sm text-red-600">⚠️ {actionError}</p>
          )}

          <div className="flex justify-end pt-1">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-600">정말 삭제하시겠습니까?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-sm px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  {deleting ? '삭제 중...' : '삭제 확인'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-sm px-3 py-1 border rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-sm px-3 py-1 border border-red-300 text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                🗑️ 티켓 삭제
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 상세 내용 */}
      {ticket.description && (
        <div className="bg-white rounded-lg border shadow-sm p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            상세 내용
          </h2>
          <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
            {ticket.description}
          </p>
        </div>
      )}

      {/* IT팀 코멘트 */}
      <div className="bg-white rounded-lg border shadow-sm p-6 mb-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          처리 내역 ({comments.length})
        </h2>
        {comments.length === 0 ? (
          <p className="text-gray-400 text-sm">아직 처리 내역이 없습니다.</p>
        ) : (
          <div className="space-y-4 mb-4">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                  {c.author_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800">{c.author_name}</span>
                    <span className="text-xs text-gray-400">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 코멘트 입력 폼 */}
        <form onSubmit={handleAddComment} className="border-t pt-4">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            placeholder="처리 내용을 입력하세요..."
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex justify-end mt-2">
            <button
              type="submit"
              disabled={commenting || !newComment.trim()}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors disabled:opacity-50"
            >
              {commenting ? '등록 중...' : '코멘트 등록'}
            </button>
          </div>
        </form>
      </div>

      {/* 만족도 평가 영역 */}
      {isClosed && (
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            만족도 평가
          </h2>
          {rating ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <StarDisplay score={rating.score} />
                <span className="text-gray-700 font-medium">{rating.score}점 / 5점</span>
              </div>
              <p className="text-sm text-gray-500">평가자: {rating.employee_name}</p>
              {rating.comment && (
                <p className="text-sm text-gray-700 bg-gray-50 rounded p-3 mt-1">
                  &quot;{rating.comment}&quot;
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="text-gray-600 text-sm">
                처리가 완료된 티켓입니다. 서비스에 만족하셨나요?
              </p>
              {canRate && (
                <Link
                  href={`/tickets/${ticket.iid}/rate`}
                  className="shrink-0 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold px-5 py-2 rounded-md text-sm transition-colors"
                >
                  ⭐ 만족도 평가하기
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TicketDetailPage() {
  return (
    <RequireAuth>
      <TicketDetailContent />
    </RequireAuth>
  )
}
