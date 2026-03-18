'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fetchKBArticle, updateKBArticle } from '@/lib/api'
import type { KBArticle } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import RichTextEditor from '@/components/RichTextEditor'
import KBFileUpload, { type KBUploadedFile } from '@/components/KBFileUpload'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'

function EditKBContent() {
  const params = useParams()
  const router = useRouter()
  const { isAgent } = useAuth()
  const { serviceTypes } = useServiceTypes()
  const idOrSlug = params?.id as string

  const [article, setArticle] = useState<KBArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', slug: '', content: '', category: '', published: false })
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<KBUploadedFile[]>([])
  const editorInsertRef = useRef<((md: string) => void) | null>(null)

  useEffect(() => {
    if (!idOrSlug) return
    fetchKBArticle(idOrSlug)
      .then((a) => {
        setArticle(a)
        setForm({ title: a.title, slug: a.slug, content: a.content ?? '', category: a.category || '', published: a.published })
        setTags(a.tags ?? [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [idOrSlug])

  if (!isAgent) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500 dark:text-gray-400">에이전트 이상 권한이 필요합니다.</p>
      </div>
    )
  }

  if (loading) return <div className="text-center py-16 text-gray-400 dark:text-gray-500">불러오는 중...</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg p-4">⚠️ {error}</div>
  if (!article) return null

  function addTag() {
    const t = tagInput.trim().replace(/^#/, '')
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!article) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const updated = await updateKBArticle(article.id, {
        title: form.title,
        slug: form.slug,
        content: form.content,
        category: form.category || undefined,
        published: form.published,
        tags,
      })
      router.push(`/kb/${updated.slug}`)
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : '저장에 실패했습니다.')
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <Link href={`/kb/${article.slug}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">← 아티클로 돌아가기</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">아티클 수정</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            제목 <span className="text-red-500 normal-case">*</span>
          </label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            maxLength={300}
            className="w-full text-xl font-semibold text-gray-900 dark:text-gray-100 bg-transparent focus:outline-none border-0 p-0"
          />
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>/kb/</span>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              maxLength={300}
              className="flex-1 font-mono bg-transparent focus:outline-none text-gray-600 dark:text-gray-400"
            />
          </div>
        </div>

        {/* Category */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">카테고리</label>
          <div className="grid grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, category: '' }))}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                form.category === ''
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <span className="text-xl">—</span>
              <span>없음</span>
            </button>
            {serviceTypes.filter(t => t.enabled).map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                  form.category === c.value
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <span className="text-xl">{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">본문</label>
          <RichTextEditor
            value={form.content}
            onChange={(html) => setForm((f) => ({ ...f, content: html }))}
            onInsertRef={(fn) => { editorInsertRef.current = fn }}
            placeholder={'개요, 해결 방법, 참고 내용 등을 작성하세요.'}
            minHeight="320px"
          />
        </div>

        {/* 파일 첨부 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            파일 첨부
          </label>
          <KBFileUpload
            files={attachments}
            onFilesChange={setAttachments}
            onInsert={(md) => {
              if (editorInsertRef.current) {
                editorInsertRef.current(md)
              } else {
                setForm((f) => ({ ...f, content: f.content + '\n' + md }))
              }
            }}
          />
        </div>

        {/* Tags */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">태그</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
              placeholder="태그 입력 후 Enter 또는 쉼표"
              className="flex-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={addTag}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              추가
            </button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-full px-2.5 py-1">
                  #{t}
                  <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="hover:text-red-500 ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, published: !f.published }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.published ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${form.published ? 'left-6' : 'left-1'}`} />
            </button>
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{form.published ? '공개' : '초안 (비공개)'}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {form.published ? '모든 사용자에게 공개됩니다' : '나중에 공개할 수 있습니다'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {submitError && <span className="text-sm text-red-600 dark:text-red-400">⚠️ {submitError}</span>}
            <Link
              href={`/kb/${article.slug}`}
              className="border border-gray-300 dark:border-gray-600 px-5 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function EditKBPage() {
  return (
    <RequireAuth>
      <EditKBContent />
    </RequireAuth>
  )
}
