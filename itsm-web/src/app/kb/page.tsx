'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { fetchKBArticles } from '@/lib/api'
import type { KBArticle } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName, formatDate } from '@/lib/utils'

function readingMinutes(content?: string) {
  if (!content) return null
  return Math.max(1, Math.round(content.trim().split(/\s+/).length / 200))
}

function KBListContent() {
  const { isAgent } = useAuth()
  const { serviceTypes, getEmoji, getLabel } = useServiceTypes()
  const searchParams = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)

  const [articles, setArticles] = useState<KBArticle[]>([])
  // allArticles는 첫 로드(필터 없음)의 결과를 재사용 → 별도 fetch 제거
  const [allArticles, setAllArticles] = useState<KBArticle[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [selectedTag, setSelectedTag] = useState(searchParams.get('tag') ?? '')
  const perPage = 20

  // 필터 없는 첫 로드: per_page=100으로 한 번만 fetch → articles + allArticles 동시 세팅
  // 필터 있을 때: 일반 per_page=20 fetch (allArticles는 유지)
  useEffect(() => {
    setLoading(true)
    const noFilter = !q && !category && !selectedTag
    const pp = noFilter ? 100 : perPage
    fetchKBArticles({ q: q || undefined, category: category || undefined, tags: selectedTag || undefined, page: noFilter ? 1 : page, per_page: pp })
      .then((data) => {
        setArticles(noFilter ? data.articles.slice(0, perPage) : data.articles)
        setTotal(data.total)
        if (noFilter) setAllArticles(data.articles)  // 태그 카운트·카테고리 카운트용 재사용
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [q, category, selectedTag, page])

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const tagCounts: Record<string, number> = {}
  for (const t of allArticles.flatMap((a) => a.tags ?? [])) tagCounts[t] = (tagCounts[t] ?? 0) + 1
  const popularTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12)

  const hasFilter = !!(q || category || selectedTag)

  function clearAll() {
    setQ(''); setQInput(''); setCategory(''); setSelectedTag(''); setPage(1)
  }

  return (
    <div className="w-full">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">📚 지식베이스</h1>
        <p className="text-gray-500 mb-5 text-sm">IT 문제 해결 가이드와 팁을 검색하세요</p>
        <form
          onSubmit={(e) => { e.preventDefault(); setQ(qInput); setCategory(''); setSelectedTag(''); setPage(1) }}
          className="flex gap-2 w-full"
        >
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              ref={searchRef}
              type="text"
              placeholder="무엇을 도와드릴까요? (예: VPN 연결, 비밀번호 재설정)"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm whitespace-nowrap"
          >
            검색
          </button>
        </form>
      </div>

      {/* Category cards */}
      {!hasFilter && (
        <div className="grid grid-cols-5 gap-3 mb-7">
          {serviceTypes.filter(t => t.enabled).map((c) => {
            // DB는 한국어 레이블 또는 숫자 value 혼재 → 둘 다 매칭
            const count = allArticles.filter((a) => a.category === c.label || a.category === c.value).length
            const active = category === c.label || category === c.value
            return (
              <button
                key={c.value}
                onClick={() => { setCategory(active ? '' : c.label); setPage(1) }}
                className={`rounded-xl border p-4 text-center transition-all hover:shadow-md ${active ? 'border-blue-400 bg-blue-100 text-blue-800 shadow-md' : 'bg-white border-gray-200 hover:border-gray-300'}`}
              >
                <div className="text-2xl mb-1">{c.emoji}</div>
                <div className={`text-xs font-semibold ${active ? '' : 'text-gray-700'}`}>{c.label}</div>
                <div className={`text-xs mt-0.5 ${active ? '' : 'text-gray-400'}`}>{count}개</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Active filters */}
      {hasFilter && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500">필터:</span>
          {q && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
              검색: &ldquo;{q}&rdquo;
              <button onClick={() => { setQ(''); setQInput(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          {category && (
            <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2.5 py-1">
              {getEmoji(category)} {getLabel(category)}
              <button onClick={() => { setCategory(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          {selectedTag && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-1">
              #{selectedTag}
              <button onClick={() => { setSelectedTag(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-700 ml-1">초기화</button>
          <span className="text-xs text-gray-400 ml-auto">{total}건</span>
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* Article list */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            {!hasFilter && (
              <div className="text-sm text-gray-500">
                전체 <span className="font-semibold text-gray-900">{total}</span>개 아티클
              </div>
            )}
            {isAgent && (
              <Link
                href="/kb/new"
                className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700 font-medium"
              >
                + 아티클 작성
              </Link>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4">⚠️ {error}</div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gray-200 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/3" />
                      <div className="flex gap-1">
                        <div className="h-5 bg-gray-100 rounded-full w-12" />
                        <div className="h-5 bg-gray-100 rounded-full w-16" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
              <div className="text-4xl mb-3">📭</div>
              <p>아티클이 없습니다.</p>
              {hasFilter && (
                <button onClick={clearAll} className="mt-3 text-sm text-blue-600 hover:underline">
                  필터 초기화
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {articles.map((a) => {
                const meta = a.category ? { icon: getEmoji(a.category), label: getLabel(a.category), color: 'border-gray-200 bg-gray-50 text-gray-600' } : null
                const mins = readingMinutes(a.content)
                return (
                  <Link
                    key={a.id}
                    href={`/kb/${a.slug}`}
                    className="block bg-white border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all rounded-xl p-4 group"
                  >
                    <div className="flex items-start gap-3">
                      {meta && (
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 mt-0.5 border ${meta.color}`}>
                          {meta.icon}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
                            {a.title}
                          </span>
                          {!a.published && (
                            <span className="flex-shrink-0 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded">초안</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 mb-1.5">
                          {a.author_name && <span>{formatName(a.author_name)}</span>}
                          <span>👁 {a.view_count}</span>
                          {mins && <span>📖 {mins}분</span>}
                          <span className="ml-auto flex-shrink-0">{formatDate(a.updated_at, 'short')}</span>
                        </div>
                        {a.tags && a.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {a.tags.slice(0, 4).map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={(e) => { e.preventDefault(); setSelectedTag(tag); setPage(1) }}
                                className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-500 rounded-full px-2 py-0.5 transition-colors"
                              >
                                #{tag}
                              </button>
                            ))}
                            {a.tags.length > 4 && (
                              <span className="text-xs text-gray-400">+{a.tags.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                ← 이전
              </button>
              <span className="text-sm text-gray-600">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                다음 →
              </button>
            </div>
          )}
        </div>

        {/* Popular tags sidebar */}
        {popularTags.length > 0 && (
          <div className="w-44 flex-shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">인기 태그</div>
              <div className="flex flex-col gap-0.5">
                {popularTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => { setSelectedTag(selectedTag === tag ? '' : tag); setPage(1) }}
                    className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 transition-colors text-left w-full ${
                      selectedTag === tag
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate">#{tag}</span>
                    <span className={`flex-shrink-0 rounded-full px-1.5 text-[10px] ml-1 ${selectedTag === tag ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function KBPage() {
  return (
    <RequireAuth>
      <KBListContent />
    </RequireAuth>
  )
}
