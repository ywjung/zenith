'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fetchKBArticle, deleteKBArticle, publishKBArticle, fetchKBArticles } from '@/lib/api'
import type { KBArticle } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { formatName } from '@/lib/utils'

const CAT_META: Record<string, { label: string; icon: string; color: string }> = {
  hardware: { label: '하드웨어',  icon: '🖥️', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  software: { label: '소프트웨어', icon: '💻', color: 'bg-purple-50 border-purple-200 text-purple-700' },
  network:  { label: '네트워크',  icon: '🌐', color: 'bg-green-50 border-green-200 text-green-700' },
  account:  { label: '계정/권한', icon: '👤', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
  other:    { label: '기타',      icon: '📋', color: 'bg-gray-50 border-gray-200 text-gray-600' },
}

type Heading = { level: number; text: string; id: string }

function toHeadingId(text: string) {
  return text.toLowerCase().replace(/[^\w가-힣]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function extractHeadings(content: string): Heading[] {
  // HTML (TipTap)
  if (/^\s*<[a-zA-Z]/.test(content)) {
    const matches = Array.from(content.matchAll(/<(h[1-3])[^>]*>(.*?)<\/h[1-3]>/gi))
    return matches.map((m) => {
      const text = m[2].replace(/<[^>]+>/g, '').trim()
      return { level: parseInt(m[1][1]), text, id: toHeadingId(text) }
    })
  }
  // Markdown
  return content
    .split('\n')
    .map((line) => {
      const m = line.match(/^(#{1,3})\s+(.+)$/)
      if (!m) return null
      const text = m[2].trim()
      return { level: m[1].length, text, id: toHeadingId(text) }
    })
    .filter((h): h is Heading => !!h)
}

function readingMinutes(content: string) {
  const plain = /^\s*<[a-zA-Z]/.test(content) ? content.replace(/<[^>]+>/g, ' ') : content
  return Math.max(1, Math.round(plain.trim().split(/\s+/).length / 200))
}

function ArticleContent() {
  const params = useParams()
  const router = useRouter()
  const { isAgent, isAdmin } = useAuth()
  const [article, setArticle] = useState<KBArticle | null>(null)
  const [related, setRelated] = useState<KBArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const idOrSlug = params?.id as string

  useEffect(() => {
    if (!idOrSlug) return
    fetchKBArticle(idOrSlug)
      .then((a) => {
        setArticle(a)
        if (a.category) {
          fetchKBArticles({ category: a.category, per_page: 6 })
            .then((data) => setRelated(data.articles.filter((x) => x.id !== a.id).slice(0, 5)))
            .catch(() => {})
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [idOrSlug])

  const handleDelete = async () => {
    if (!article || !confirm('이 아티클을 삭제하시겠습니까?')) return
    try {
      await deleteKBArticle(article.id)
      router.push('/kb')
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  const handleTogglePublish = async () => {
    if (!article) return
    try {
      const result = await publishKBArticle(article.id, !article.published)
      setArticle((a) => a ? { ...a, published: result.published } : a)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '변경에 실패했습니다.')
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">불러오는 중...</div>
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">⚠️ {error}</div>
  if (!article) return null

  const cat = article.category ? CAT_META[article.category] : null
  const headings = extractHeadings(article.content ?? '')
  const mins = readingMinutes(article.content ?? '')

  return (
    <div className="w-full">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-5 flex-wrap">
        <Link href="/kb" className="hover:text-blue-600 transition-colors">지식베이스</Link>
        {cat && (
          <>
            <span>›</span>
            <Link href={`/kb?category=${article.category}`} className="hover:text-blue-600 transition-colors">
              {cat.icon} {cat.label}
            </Link>
          </>
        )}
        <span>›</span>
        <span className="text-gray-700 truncate">{article.title}</span>
      </nav>

      <div className="flex gap-6 items-start">
        {/* Main article */}
        <article className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Article header */}
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              {cat && (
                <span className={`text-xs border px-2.5 py-0.5 rounded-full font-medium ${cat.color}`}>
                  {cat.icon} {cat.label}
                </span>
              )}
              {!article.published && (
                <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-2.5 py-0.5 rounded-full">
                  초안 (비공개)
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-3 leading-tight">{article.title}</h1>

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 text-sm text-gray-500">
                {article.author_name && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {(article.author_name[0] ?? '?').toUpperCase()}
                    </div>
                    <span>{formatName(article.author_name)}</span>
                  </div>
                )}
                <span className="flex items-center gap-1">👁 {article.view_count}</span>
                <span className="flex items-center gap-1">📖 {mins}분</span>
                <span>{new Date(article.updated_at).toLocaleDateString('ko-KR')} 업데이트</span>
              </div>

              {isAgent && (
                <div className="flex gap-2 flex-shrink-0">
                  <Link
                    href={`/kb/${article.id}/edit`}
                    className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    ✏️ 수정
                  </Link>
                  <button
                    onClick={handleTogglePublish}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      article.published
                        ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {article.published ? '비공개 전환' : '공개하기'}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={handleDelete}
                      className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      삭제
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tags */}
            {article.tags && article.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">
                {article.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/kb?tag=${tag}`}
                    className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 rounded-full px-2.5 py-1 transition-colors"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Article content */}
          <div className="p-6">
            <MarkdownRenderer content={article.content ?? ''} />
          </div>
        </article>

        {/* Sidebar */}
        <aside className="w-52 flex-shrink-0 space-y-4">
          {/* Table of Contents */}
          {headings.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">목차</div>
              <nav className="space-y-0.5">
                {headings.map((h, i) => (
                  <a
                    key={i}
                    href={`#${h.id}`}
                    className={`block text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded px-2 py-1 transition-colors leading-snug ${
                      h.level === 1 ? 'font-medium' : h.level === 2 ? 'pl-4 text-gray-500' : 'pl-7 text-gray-400'
                    }`}
                  >
                    {h.text}
                  </a>
                ))}
              </nav>
            </div>
          )}

          {/* Related articles */}
          {related.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">관련 아티클</div>
              <div className="space-y-1">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/kb/${r.slug}`}
                    className="block text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg px-2 py-1.5 transition-colors leading-snug"
                  >
                    {r.title}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Article info */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">정보</div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>작성일</span>
              <span>{new Date(article.created_at).toLocaleDateString('ko-KR')}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>최종 수정</span>
              <span>{new Date(article.updated_at).toLocaleDateString('ko-KR')}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>조회</span>
              <span>{article.view_count}회</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>읽기 시간</span>
              <span>약 {mins}분</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default function ArticlePage() {
  return (
    <RequireAuth>
      <ArticleContent />
    </RequireAuth>
  )
}
