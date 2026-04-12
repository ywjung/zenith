'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'

interface SearchResult {
  iid: number
  title: string
  status: string
  priority: string
  category: string
  _type?: 'ticket' | 'kb' | 'change'
  _id?: number  // KB article id
  _slug?: string // KB slug
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-500 dark:text-red-400',
  high: 'text-orange-500 dark:text-orange-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-gray-500 dark:text-gray-400',
}

const HISTORY_KEY = 'itsm_search_history'
const MAX_HISTORY = 6

function loadHistory(): string[] {
  try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(q: string) {
  try {
    const prev = loadHistory().filter(h => h !== q)
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)))
  } catch { /* ignore */ }
}
function clearHistory() {
  try { sessionStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
}

export default function GlobalSearch() {
  const t = useTranslations()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const resultsListRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const abortRef = useRef<AbortController>()

  // 선택된 항목이 viewport 밖으로 나가면 자동 스크롤
  useEffect(() => {
    if (selectedIndex < 0 || !resultsListRef.current) return
    const list = resultsListRef.current
    const item = list.querySelector<HTMLElement>(`[data-search-index="${selectedIndex}"]`)
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => { setHistory(loadHistory()) }, [])
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setSearchError(false); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setSearchError(false)
    try {
      const signal = abortRef.current.signal
      const opts = { credentials: 'include' as const, cache: 'no-store' as const, signal }
      // 병렬 검색 — 티켓 + KB + 변경
      const [ticketRes, kbRes, changeRes] = await Promise.allSettled([
        fetch(`${API_BASE}/tickets/search?q=${encodeURIComponent(q)}&per_page=5`, opts),
        fetch(`${API_BASE}/kb?q=${encodeURIComponent(q)}&per_page=3`, opts),
        fetch(`${API_BASE}/changes?q=${encodeURIComponent(q)}&per_page=3`, opts),
      ])
      const all: SearchResult[] = []
      // 티켓 결과
      if (ticketRes.status === 'fulfilled' && ticketRes.value.ok) {
        const tickets = await ticketRes.value.json()
        const arr = Array.isArray(tickets) ? tickets : (tickets.tickets ?? tickets.items ?? [])
        arr.forEach((t: SearchResult) => all.push({ ...t, _type: 'ticket' }))
      }
      // KB 결과
      if (kbRes.status === 'fulfilled' && kbRes.value.ok) {
        const kb = await kbRes.value.json()
        const articles = Array.isArray(kb) ? kb : (kb.articles ?? [])
        articles.forEach((a: { id: number; title: string; slug?: string; category?: string }) => {
          all.push({ iid: a.id, title: a.title, status: '', priority: '', category: a.category ?? '', _type: 'kb', _id: a.id, _slug: a.slug })
        })
      }
      // 변경 결과
      if (changeRes.status === 'fulfilled' && changeRes.value.ok) {
        const changes = await changeRes.value.json()
        const items = Array.isArray(changes) ? changes : (changes.items ?? [])
        items.forEach((c: { id: number; title: string; status?: string }) => {
          all.push({ iid: c.id, title: c.title, status: c.status ?? '', priority: '', category: '', _type: 'change' })
        })
      }
      setResults(all)
      setSelectedIndex(-1)
      if (all.length === 0 && ticketRes.status === 'rejected') setSearchError(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { setResults([]); setSearchError(true) }
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => search(q), 300)
  }

  const navigateToResult = (r: SearchResult) => {
    if (query.trim().length >= 2) {
      saveHistory(query.trim())
      setHistory(loadHistory())
    }
    setOpen(false); setQuery(''); setResults([])
    if (r._type === 'kb') router.push(`/kb/${r._slug || r._id}`)
    else if (r._type === 'change') router.push(`/changes/${r.iid}`)
    else router.push(`/tickets/${r.iid}`)
  }

  // backwards compat
  const navigateToTicket = (iid: number, _title: string) => {
    const match = results.find(r => r.iid === iid)
    if (match) navigateToResult(match)
    else { setOpen(false); setQuery(''); setResults([]); router.push(`/tickets/${iid}`) }
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
    <div ref={containerRef} className="relative hidden md:block" data-tour="global-search">
      {/* 입력창 — 헤더가 파란색이라 입력창도 파란색 계열 유지 */}
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          data-global-search
          autoComplete="off"
          aria-label={t('search.placeholder')}
          placeholder={t('search.placeholder')}
          role="combobox"
          aria-expanded={showHistory || showResults}
          aria-controls="global-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            selectedIndex >= 0 ? `global-search-option-${selectedIndex}` : undefined
          }
          className="bg-blue-600 dark:bg-blue-900/60 text-white placeholder-blue-300 dark:placeholder-blue-400 text-sm px-3 py-1.5 pl-8 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-white/40 focus:w-72 transition-all border-0"
        />
        <svg className="absolute left-2 top-2 w-4 h-4 text-blue-300 dark:text-blue-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
        <div
          ref={resultsListRef}
          id="global-search-listbox"
          role="listbox"
          className="absolute top-full mt-1 left-0 w-96 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden max-h-[70vh] overflow-y-auto">

          {/* 최근 검색 히스토리 */}
          {showHistory && (
            <>
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('search.recent')}</span>
                <button
                  onClick={() => { clearHistory(); setHistory([]) }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  {t('search.clear_all')}
                </button>
              </div>
              {history.map((h, i) => (
                <button
                  key={h}
                  id={`global-search-option-${i}`}
                  role="option"
                  aria-selected={i === selectedIndex}
                  data-search-index={i}
                  onClick={() => applyHistory(h)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700/50 last:border-0 transition-colors ${
                    i === selectedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 text-left">{h}</span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      const next = history.filter(x => x !== h)
                      try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
                      setHistory(next)
                    }}
                    className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 text-sm px-1"
                   aria-label="제거">
                    ×
                  </button>
                </button>
              ))}
            </>
          )}

          {/* 검색 결과 */}
          {showResults && results.length > 0 && (
            <>
              {results.map((r, i) => {
                const typeBadge = r._type === 'kb'
                  ? { icon: '📚', label: 'KB', cls: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' }
                  : r._type === 'change'
                    ? { icon: '🔄', label: '변경', cls: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' }
                    : { icon: '📋', label: '', cls: '' }
                return (
                <button
                  key={`${r._type}-${r.iid}`}
                  id={`global-search-option-${i}`}
                  role="option"
                  aria-selected={i === selectedIndex}
                  data-search-index={i}
                  onClick={() => navigateToResult(r)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-100 dark:border-gray-700/50 last:border-0 transition-colors ${
                    i === selectedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <div className="shrink-0 flex flex-col items-center gap-0.5">
                    {r._type !== 'ticket' && (
                      <span className={`text-[9px] font-bold px-1 py-px rounded ${typeBadge.cls}`}>{typeBadge.label}</span>
                    )}
                    <span className="text-gray-400 dark:text-gray-500 text-sm font-mono">
                      {r._type === 'ticket' ? `#${r.iid}` : r._type === 'kb' ? '📚' : `#${r.iid}`}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{r.title}</div>
                    <div className="flex gap-2 mt-0.5">
                      {r.status && <span className="text-xs text-gray-500 dark:text-gray-400">{((): string => { try { return t(`ticket.status.${r.status}`) } catch { return r.status } })()}</span>}
                      {r.priority && <span className={`text-xs ${PRIORITY_COLORS[r.priority] ?? 'text-gray-500 dark:text-gray-400'}`}>{r.priority}</span>}
                      {r._type === 'kb' && r.category && <span className="text-xs text-gray-400">{r.category}</span>}
                    </div>
                  </div>
                </button>
                )
              })}
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs text-gray-400 dark:text-gray-500 flex justify-between">
                <span>{t('search.hint')}</span>
                <span>{t('search.results', { count: results.length })}</span>
              </div>
            </>
          )}

          {/* 검색 오류 */}
          {showResults && searchError && !loading && (
            <div className="px-4 py-4 text-sm text-red-500 dark:text-red-400 text-center">
              {t('search.error')}
            </div>
          )}

          {/* 결과 없음 */}
          {showResults && results.length === 0 && !loading && !searchError && (
            <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
              <span className="text-2xl block mb-1">🔍</span>
              {t('search.no_results', { query })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
