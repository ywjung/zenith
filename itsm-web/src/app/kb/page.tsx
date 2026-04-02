'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('kb')

  const [articles, setArticles] = useState<KBArticle[]>([])
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

  useEffect(() => {
    setLoading(true)
    fetchKBArticles({ q: q || undefined, category: category || undefined, tags: selectedTag || undefined, page, per_page: perPage })
      .then((data) => {
        setArticles(data.articles)
        setTotal(data.total)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [q, category, selectedTag, page])

  useEffect(() => {
    if (q || category || selectedTag) return
    fetchKBArticles({ per_page: 100 })
      .then((data) => setAllArticles(data.articles))
      .catch(() => {/* 태그 통계 실패 시 무시 */})
  }, [q, category, selectedTag])

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const tagCounts: Record<string, number> = {}
  for (const tag of allArticles.flatMap((a) => a.tags ?? [])) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  const popularTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12)

  const hasFilter = !!(q || category || selectedTag)

  function clearAll() {
    setQ(''); setQInput(''); setCategory(''); setSelectedTag(''); setPage(1)
  }

  return (
    <div className="w-full">
      {/* 페이지 제목 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          {t('hero_title')}
        </h1>
      </div>

      {/* Hero */}
      <div className="mb-8">
        <p className="text-gray-500 dark:text-gray-400 mb-5 text-sm">{t('hero_desc')}</p>
        <form
          onSubmit={(e) => { e.preventDefault(); setQ(qInput); setCategory(''); setSelectedTag(''); setPage(1) }}
          className="flex gap-2 w-full"
        >
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">🔍</span>
            <input
              ref={searchRef}
              type="text"
              placeholder={t('search_placeholder')}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl pl-10 pr-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm whitespace-nowrap"
          >
            {t('search_btn')}
          </button>
        </form>
      </div>

      {/* Category cards */}
      {!hasFilter && (
        <div className="grid grid-cols-5 gap-3 mb-7">
          {serviceTypes.filter(st => st.enabled).map((c) => {
            const count = allArticles.filter((a) => a.category === c.label || a.category === c.value || a.category === c.description).length
            const active = category === c.label || category === c.value || category === c.description
            return (
              <button
                key={c.value}
                onClick={() => { setCategory(active ? '' : c.label); setPage(1) }}
                className={`rounded-xl border p-4 text-center transition-all hover:shadow-md ${
                  active
                    ? 'border-blue-400 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 shadow-md'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="text-2xl mb-1">{c.emoji}</div>
                <div className={`text-xs font-semibold ${active ? '' : 'text-gray-700 dark:text-gray-300'}`}>{c.label}</div>
                <div className={`text-xs mt-0.5 ${active ? '' : 'text-gray-400 dark:text-gray-500'}`}>{t('article_count', { count })}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Active filters */}
      {hasFilter && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('filter_label')}</span>
          {q && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-full px-2.5 py-1">
              {t('filter_search')} &ldquo;{q}&rdquo;
              <button onClick={() => { setQ(''); setQInput(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          {category && (
            <span className="inline-flex items-center gap-1 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 rounded-full px-2.5 py-1">
              {getEmoji(category)} {getLabel(category)}
              <button onClick={() => { setCategory(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          {selectedTag && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700 rounded-full px-2.5 py-1">
              #{selectedTag}
              <button onClick={() => { setSelectedTag(''); setPage(1) }} className="hover:text-red-500 ml-0.5">✕</button>
            </span>
          )}
          <button onClick={clearAll} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 ml-1">{t('filter_reset')}</button>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{t('result_count', { total })}</span>
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* Article list */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            {!hasFilter && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {t('total_articles', { total })}
              </div>
            )}
            {isAgent && (
              <Link
                href="/kb/new"
                className="ml-auto bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-blue-700 font-medium"
              >
                {t('new_article')}
              </Link>
            )}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4 mb-4">⚠️ {error}</div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-gray-700 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/3" />
                      <div className="flex gap-1">
                        <div className="h-5 bg-gray-100 dark:bg-gray-600 rounded-full w-12" />
                        <div className="h-5 bg-gray-100 dark:bg-gray-600 rounded-full w-16" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500">
              <div className="text-4xl mb-3">📭</div>
              <p>{t('no_articles')}</p>
              {hasFilter && (
                <button onClick={clearAll} className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  {t('reset_filters')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {articles.map((a) => {
                const meta = a.category ? { icon: getEmoji(a.category), label: getLabel(a.category), color: 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300' } : null
                const mins = readingMinutes(a.content)
                return (
                  <Link
                    key={a.id}
                    href={`/kb/${a.slug}`}
                    className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-md transition-all rounded-xl p-4 group"
                  >
                    <div className="flex items-start gap-3">
                      {meta && (
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 mt-0.5 border ${meta.color}`}>
                          {meta.icon}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors truncate">
                            {a.title}
                          </span>
                          {!a.published && (
                            <span className="flex-shrink-0 text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-700 px-1.5 py-0.5 rounded">{t('draft_badge')}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 mb-1.5">
                          {a.author_name && <span>{formatName(a.author_name)}</span>}
                          <span>👁 {a.view_count}</span>
                          {mins && <span>📖 {t('reading_time', { mins })}</span>}
                          <span className="ml-auto flex-shrink-0">{formatDate(a.updated_at, 'short')}</span>
                        </div>
                        {a.tags && a.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {a.tags.slice(0, 4).map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={(e) => { e.preventDefault(); setSelectedTag(tag); setPage(1) }}
                                className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-400 text-gray-500 dark:text-gray-400 rounded-full px-2 py-0.5 transition-colors"
                              >
                                #{tag}
                              </button>
                            ))}
                            {a.tags.length > 4 && (
                              <span className="text-xs text-gray-400 dark:text-gray-500">+{a.tags.length - 4}</span>
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
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                {t('prev_page')}
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
              >
                {t('next_page')}
              </button>
            </div>
          )}
        </div>

        {/* Popular tags sidebar */}
        {popularTags.length > 0 && (
          <div className="w-44 flex-shrink-0">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('popular_tags')}</div>
              <div className="flex flex-col gap-0.5">
                {popularTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => { setSelectedTag(selectedTag === tag ? '' : tag); setPage(1) }}
                    className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 transition-colors text-left w-full ${
                      selectedTag === tag
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className="truncate">#{tag}</span>
                    <span className={`flex-shrink-0 rounded-full px-1.5 text-[10px] ml-1 ${
                      selectedTag === tag
                        ? 'bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                    }`}>
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
