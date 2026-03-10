'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { API_BASE, STATUS_INFO } from '@/lib/constants'

interface TicketStatus {
  ticket_iid: number
  title: string
  status: string
  created_at: string
  updated_at: string | null
}

export default function TrackPage() {
  const params = useParams()
  const token = params?.token as string

  const [ticket, setTicket] = useState<TicketStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/portal/track/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || '조회에 실패했습니다.')
        }
        return res.json()
      })
      .then(setTicket)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">⏳</div>
        <p>티켓 정보를 불러오는 중...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">조회 실패</h1>
        <p className="text-gray-500 text-sm mb-6">{error}</p>
        <Link href="/portal" className="text-blue-600 text-sm hover:underline">
          새 요청 제출하기 →
        </Link>
      </div>
    )
  }

  if (!ticket) return null

  const statusInfo = STATUS_INFO[ticket.status] ?? {
    label: ticket.status,
    color: 'text-gray-600 bg-gray-50 border-gray-200',
    icon: '📋',
  }

  return (
    <div className="max-w-lg mx-auto py-8">
      <div className="mb-6">
        <Link href="/portal" className="text-sm text-blue-600 hover:underline">
          ← 새 요청 제출
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="text-xs text-gray-400 mb-1">티켓 #{ticket.ticket_iid}</div>
            <h1 className="text-lg font-semibold text-gray-900">{ticket.title}</h1>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full border ${statusInfo.color}`}
          >
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-2 text-sm text-gray-500">
          <div className="flex justify-between">
            <span>접수 일시</span>
            <span className="text-gray-700">
              {new Date(ticket.created_at).toLocaleString('ko-KR')}
            </span>
          </div>
          {ticket.updated_at && (
            <div className="flex justify-between">
              <span>최근 업데이트</span>
              <span className="text-gray-700">
                {new Date(ticket.updated_at).toLocaleString('ko-KR')}
              </span>
            </div>
          )}
        </div>

        {(ticket.status === 'resolved' || ticket.status === 'closed') && (
          <div className="mt-5 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            ✅ 요청이 처리 완료되었습니다. 추가 문의가 있으시면 새 요청을 제출해 주세요.
          </div>
        )}
      </div>
    </div>
  )
}
