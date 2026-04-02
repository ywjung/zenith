'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fetchKBArticle, deleteKBArticle, publishKBArticle, fetchKBArticles, fetchKBRevisions, fetchKBRevisionDetail, restoreKBRevision } from '@/lib/api'
import type { KBRevision } from '@/lib/api'
import type { KBArticle } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { formatName } from '@/lib/utils'

const CAT_META: Record<string, { icon: string; color: string }> = {
  hardware: { icon: '🖥️', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300' },
  software: { icon: '💻', color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-700 dark:text-purple-300' },
  network:  { icon: '🌐', color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300' },
  account:  { icon: '👤', color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300' },
  other:    { icon: '📋', color: 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300' },
}

type Heading = { level: number; text: string; id: string }

function toHeadingId(text: string) {
  return text.toLowerCase().replace(/[^\w가-힣]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function extractHeadings(content: string): Heading[] {
  if (/^\s*<[a-zA-Z]/.test(content)) {
    const matches = Array.from(content.matchAll(/<(h[1-3])[^>]*>(.*?)<\/h[1-3]>/gi))
    return matches.map((m) => {
      const text = m[2].replace(/<[^>]+>/g, '').trim()
      return { level: parseInt(m[1][1]), text, id: toHeadingId(text) }
    })
  }
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
  const t = useTranslations('kb')
  const tc = useTranslations('ticket.category')
  const [article, setArticle] = useState<KBArticle | null>(null)
  const [related, setRelated] = useState<KBArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<KBRevision[]>([])
  const [showRevisions, setShowRevisions] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [previewRev, setPreviewRev] = useState<(KBRevision & { content: string; tags: string[] }) | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const idOrSlug = params?.id as string

  const KNOWN_CATEGORIES = ['hardware', 'software', 'network', 'account', 'other',
    '하드웨어', '소프트웨어', '네트워크', '계정', '기타']
  const getCatLabel = (key: string) => {
    if (!key || !KNOWN_CATEGORIES.includes(key)) return key
    try { return tc(key as Parameters<typeof tc>[0]) } catch { return key }
  }

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
    if (!article || !confirm(t('delete_confirm'))) return
    try {
      await deleteKBArticle(article.id)
      router.push('/kb')
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('delete_failed'))
    }
  }

  const handleShowRevisions = async () => {
    if (!article) return
    if (!showRevisions && revisions.length === 0) {
      try {
        const list = await fetchKBRevisions(article.id)
        setRevisions(list)
      } catch { /* ignore */ }
    }
    setShowRevisions(v => !v)
  }

  const handlePreview = async (rev: KBRevision) => {
    if (!article) return
    setPreviewLoading(true)
    try {
      const detail = await fetchKBRevisionDetail(article.id, rev.id)
      setPreviewRev(detail)
    } catch { /* ignore */ }
    finally { setPreviewLoading(false) }
  }

  const handleRestore = async (rev: KBRevision) => {
    if (!article || !confirm(t('restore_confirm', { n: rev.revision_number }))) return
    setRestoringId(rev.id)
    try {
      await restoreKBRevision(article.id, rev.id)
      const updated = await fetchKBArticle(String(article.id))
      setArticle(updated)
      setRevisions([])
      setShowRevisions(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('restore_failed'))
    } finally {
      setRestoringId(null)
    }
  }

  const handleTogglePublish = async () => {
    if (!article) return
    try {
      const result = await publishKBArticle(article.id, !article.published)
      setArticle((a) => a ? { ...a, published: result.published } : a)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('toggle_failed'))
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400 dark:text-gray-500">{t('loading')}</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4">⚠️ {error}</div>
  if (!article) return null

  const catMeta = article.category ? CAT_META[article.category] : null
  const catLabel = article.category ? getCatLabel(article.category) : null
  const headings = extractHeadings(article.content ?? '')
  const mins = readingMinutes(article.content ?? '')

  return (
    <div className="w-full">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 mb-5 flex-wrap">
        <Link href="/kb" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('breadcrumb')}</Link>
        {catMeta && catLabel && (
          <>
            <span>›</span>
            <Link href={`/kb?category=${article.category}`} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              {catMeta.icon} {catLabel}
            </Link>
          </>
        )}
        <span>›</span>
        <span className="text-gray-700 dark:text-gray-300 truncate">{article.title}</span>
      </nav>

      <div className="flex gap-6 items-start">
        {/* Main article */}
        <article className="flex-1 min-w-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Article header */}
          <div className="p-6 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              {catMeta && catLabel && (
                <span className={`text-xs border px-2.5 py-0.5 rounded-full font-medium ${catMeta.color}`}>
                  {catMeta.icon} {catLabel}
                </span>
              )}
              {!article.published && (
                <span className="text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-700 px-2.5 py-0.5 rounded-full">
                  {t('draft_private')}
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3 leading-tight">{article.title}</h1>

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                {article.author_name && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {(article.author_name[0] ?? '?').toUpperCase()}
                    </div>
                    <span>{formatName(article.author_name)}</span>
                  </div>
                )}
                <span className="flex items-center gap-1">👁 {article.view_count}</span>
                <span className="flex items-center gap-1">📖 {t('reading_time', { mins })}</span>
                <span>{new Date(article.updated_at).toLocaleDateString()} {t('updated_label')}</span>
              </div>

              {isAgent && (
                <div className="flex gap-2 flex-shrink-0">
                  <Link
                    href={`/kb/${article.id}/edit`}
                    className="text-xs border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {t('edit_btn')}
                  </Link>
                  <button
                    onClick={handleTogglePublish}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      article.published
                        ? 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {article.published ? t('unpublish_btn') : t('publish_btn')}
                  </button>
                  <button
                    onClick={handleShowRevisions}
                    className="text-xs border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {showRevisions ? t('history_close') : t('history_btn')}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={handleDelete}
                      className="text-xs text-red-500 border border-red-200 dark:border-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      {t('delete_btn')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Tags */}
            {article.tags && article.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                {article.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/kb?tag=${tag}`}
                    className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-400 text-gray-600 dark:text-gray-400 rounded-full px-2.5 py-1 transition-colors"
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
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('toc')}</div>
              <nav className="space-y-0.5">
                {headings.map((h, i) => (
                  <a
                    key={i}
                    href={`#${h.id}`}
                    className={`block text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded px-2 py-1 transition-colors leading-snug ${
                      h.level === 1 ? 'font-medium' : h.level === 2 ? 'pl-4 text-gray-500 dark:text-gray-500' : 'pl-7 text-gray-400 dark:text-gray-600'
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
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('related_articles')}</div>
              <div className="space-y-1">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/kb/${r.slug}`}
                    className="block text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg px-2 py-1.5 transition-colors leading-snug"
                  >
                    {r.title}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Version history */}
          {showRevisions && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('version_history')}</div>
              {revisions.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('no_history')}</p>
              ) : (
                <div className="space-y-1.5">
                  {revisions.map((rev) => (
                    <div key={rev.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-gray-700 dark:text-gray-300">v{rev.revision_number}</span>
                        <span className="ml-1.5 text-gray-400 dark:text-gray-500">{new Date(rev.created_at).toLocaleDateString()}</span>
                        {rev.editor_name && <p className="text-gray-500 dark:text-gray-400 truncate">{rev.editor_name}</p>}
                        {rev.change_summary && <p className="text-gray-400 dark:text-gray-500 truncate italic">{rev.change_summary}</p>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          onClick={() => handlePreview(rev)}
                          disabled={previewLoading}
                          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline disabled:opacity-50"
                        >
                          {t('view_btn')}
                        </button>
                        <button
                          onClick={() => handleRestore(rev)}
                          disabled={restoringId === rev.id}
                          className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                        >
                          {restoringId === rev.id ? '...' : t('restore_btn')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Article info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{t('info_section')}</div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t('created_date')}</span>
              <span>{new Date(article.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t('last_modified')}</span>
              <span>{new Date(article.updated_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t('views')}</span>
              <span>{t('views_count', { count: article.view_count })}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t('reading_time_label')}</span>
              <span>{t('approx_minutes', { mins })}</span>
            </div>
          </div>
        </aside>
      </div>
      {previewRev && (
        <RevisionPreviewModal
          rev={previewRev}
          onClose={() => setPreviewRev(null)}
          onRestore={handleRestore}
        />
      )}
    </div>
  )
}

function RevisionPreviewModal({ rev, onClose, onRestore }: {
  rev: KBRevision & { content: string; tags: string[] }
  onClose: () => void
  onRestore: (rev: KBRevision) => void
}) {
  const t = useTranslations('kb')
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('preview_title', { n: rev.revision_number })}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {new Date(rev.created_at).toLocaleString()}
              {rev.editor_name && ` · ${rev.editor_name}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { onRestore(rev); onClose() }}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
            >
              {t('restore_this')}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{rev.title}</h2>
          {rev.tags && rev.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {rev.tags.map(tag => (
                <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full px-2.5 py-1">#{tag}</span>
              ))}
            </div>
          )}
          <MarkdownRenderer content={rev.content} />
        </div>
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
