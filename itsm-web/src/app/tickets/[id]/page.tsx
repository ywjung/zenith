'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fetchTicket, fetchComments, fetchRating } from '@/lib/api'
import type { Ticket, Comment, Rating } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge } from '@/components/StatusBadge'

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

export default function TicketDetailPage() {
  const params = useParams()
  const iid = Number(params.id)

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [rating, setRating] = useState<Rating | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!iid) return
    Promise.all([
      fetchTicket(iid),
      fetchComments(iid),
      fetchRating(iid),
    ])
      .then(([t, c, r]) => {
        setTicket(t)
        setComments(c)
        setRating(r)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [iid])

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
          <div className="space-y-4">
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
                  "{rating.comment}"
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="text-gray-600 text-sm">
                처리가 완료된 티켓입니다. 서비스에 만족하셨나요?
              </p>
              <Link
                href={`/tickets/${ticket.iid}/rate`}
                className="shrink-0 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold px-5 py-2 rounded-md text-sm transition-colors"
              >
                ⭐ 만족도 평가하기
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
