'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'

interface SearchResult {
  iid: number
  title: string
  status: string
  priority: string
  category: string
}

const STATUS_LABELS: Record<string, string> = {
  open: '접수', in_progress: '처리중', waiting: '대기', resolved: '해결', closed: '완료',
}
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600', high: 'text-orange-500', medium: 'text-yellow-600', low: 'text-gray-500',
}

const HISTORY_KEY = 'itsm_search_history'
const MAX_HISTORY = 6

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(q: string) {
  try {
    const prev = loadHistory().filter(h => h !== q)
    localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}
function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // 히스토리 로드 (클라이언트 전용)
  useEffect(() => { setHistory(loadHistory()) }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/tickets/search?q=${encodeURIComponent(q)}&per_page=8`,
        { credentials: 'include', cache: 'no-store' },
      )
      if (res.ok) { setResults(await res.json()); setSelectedIndex(-1) }
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => search(q), 300)
  }

  const navigateToTicket = (iid: number, title: string) => {
    if (query.trim().length >= 2) {
      saveHistory(query.trim())
      setHistory(loadHistory())
    }
    setOpen(false); setQuery(''); setResults([])
    router.push(`/tickets/${iid}`)
  }

  const applyHistory = (h: string) => {
    setQuery(h)
    setOpen(true)
    search(h)
    inputRef.current?.focus()
  }

  // ⌘K 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 키보드 네비게이션 (히스토리 + 결과 통합)
  const allItems = query.length < 2
    ? history.map((h, i) => ({ type: 'history' as const, value: h, index: i }))
    : results.map((r, i) => ({ type: 'result' as const, value: r, index: i }))
  const totalItems = allItems.length

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, totalItems - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      const item = allItems[selectedIndex]
      if (item.type === 'history') applyHistory(item.value)
      else navigateToTicket(item.value.iid, item.value.title)
    }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showHistory = open && query.length < 2 && history.length > 0
  const showResults = open && query.length >= 2

  return (
    <div ref={containerRef} className="relative hidden md:block">
      {/* 입력창 */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="티켓 검색… (⌘K)"
          className="bg-blue-600 text-white placeholder-blue-300 text-sm px-3 py-1.5 pl-8 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-white/40 focus:w-72 transition-all"
        />
        <svg className="absolute left-2 top-2 w-4 h-4 text-blue-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {loading && (
          <svg className="absolute right-2 top-2 w-4 h-4 text-blue-300 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>

      {/* 드롭다운 */}
      {(showHistory || showResults) && (
        <div className="absolute top-full mt-1 left-0 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">

          {/* 최근 검색 히스토리 */}
          {showHistory && (
            <>
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500">최근 검색</span>
                <button
                  onClick={() => { clearHistory(); setHistory([]) }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  전체 삭제
                </button>
              </div>
              {history.map((h, i) => (
                <button
                  key={h}
                  onClick={() => applyHistory(h)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors ${i === selectedIndex ? 'bg-blue-50' : ''}`}
                >
                  <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-gray-700 flex-1 text-left">{h}</span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      const next = history.filter(x => x !== h)
                      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
                      setHistory(next)
                    }}
                    className="text-gray-300 hover:text-gray-500 text-sm px-1"
                  >
                    ×
                  </button>
                </button>
              ))}
            </>
          )}

          {/* 검색 결과 */}
          {showResults && results.length > 0 && (
            <>
              {results.map((r, i) => (
                <button
                  key={r.iid}
                  onClick={() => navigateToTicket(r.iid, r.title)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors ${i === selectedIndex ? 'bg-blue-50' : ''}`}
                >
                  <span className="text-gray-400 text-sm font-mono shrink-0">#{r.iid}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{r.title}</div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{STATUS_LABELS[r.status] ?? r.status}</span>
                      <span className={`text-xs ${PRIORITY_COLORS[r.priority] ?? 'text-gray-500'}`}>{r.priority}</span>
                    </div>
                  </div>
                </button>
              ))}
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-400 flex justify-between">
                <span>↑↓ 이동 · Enter 선택 · Esc 닫기</span>
                <span>{results.length}개 결과</span>
              </div>
            </>
          )}

          {/* 결과 없음 */}
          {showResults && results.length === 0 && !loading && (
            <div className="px-4 py-4 text-sm text-gray-500 text-center">
              <span className="text-2xl block mb-1">🔍</span>
              "{query}"에 대한 결과가 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
