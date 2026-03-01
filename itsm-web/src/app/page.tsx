'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { fetchTickets } from '@/lib/api'
import type { Ticket } from '@/types'
import { StatusBadge, PriorityBadge, CategoryBadge } from '@/components/StatusBadge'

const CATEGORIES = [
  { value: '', label: '전체 카테고리' },
  { value: 'hardware', label: '🖥️ 하드웨어' },
  { value: 'software', label: '💻 소프트웨어' },
  { value: 'network', label: '🌐 네트워크' },
  { value: 'account', label: '👤 계정/권한' },
  { value: 'other', label: '📋 기타' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function HomePage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState('all')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTickets({
        state: state || undefined,
        category: category || undefined,
        search: search || undefined,
      })
      setTickets(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '티켓을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [state, category, search])

  useEffect(() => {
    load()
  }, [load])

  const stats = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    in_progress: tickets.filter((t) => t.status === 'in_progress').length,
    closed: tickets.filter((t) => t.state === 'closed').length,
  }

  return (
    <div>
      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: '전체', count: stats.all, color: 'text-gray-700', bg: 'bg-white' },
          { label: '접수됨', count: stats.open, color: 'text-yellow-700', bg: 'bg-yellow-50' },
          { label: '처리중', count: stats.in_progress, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: '종료', count: stats.closed, color: 'text-green-700', bg: 'bg-green-50' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-lg border p-4 text-center shadow-sm`}>
            <div className={`text-3xl font-bold ${s.color}`}>{s.count}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-lg border p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          {/* 상태 탭 */}
          <div className="flex gap-1 rounded-md border overflow-hidden">
            {[
              { value: 'all', label: '전체' },
              { value: 'open', label: '진행중' },
              { value: 'closed', label: '종료' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setState(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  state === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 카테고리 선택 */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          {/* 검색 */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(searchInput)
            }}
            className="flex gap-2 ml-auto"
          >
            <input
              type="text"
              placeholder="제목 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
            <button
              type="submit"
              className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700"
            >
              검색
            </button>
          </form>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">
          ⚠️ {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">⏳</div>
          <p>불러오는 중...</p>
        </div>
      )}

      {/* 티켓 목록 */}
      {!loading && !error && (
        <>
          {tickets.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-lg">등록된 티켓이 없습니다.</p>
              <Link
                href="/tickets/new"
                className="mt-4 inline-block bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 text-sm"
              >
                첫 티켓 등록하기
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <Link
                  key={ticket.iid}
                  href={`/tickets/${ticket.iid}`}
                  className="block bg-white rounded-lg border hover:border-blue-300 hover:shadow-md transition-all p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-gray-400 text-sm font-mono">#{ticket.iid}</span>
                        <StatusBadge status={ticket.status} />
                        <PriorityBadge priority={ticket.priority} />
                        <CategoryBadge category={ticket.category} />
                      </div>
                      <p className="font-medium text-gray-900 truncate">{ticket.title}</p>
                      {ticket.employee_name && (
                        <p className="text-sm text-gray-500 mt-1">신청자: {ticket.employee_name}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                      {formatDate(ticket.created_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <p className="text-center text-sm text-gray-400 mt-4">총 {tickets.length}건</p>
        </>
      )}
    </div>
  )
}
