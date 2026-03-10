'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createKBArticle } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import RichTextEditor from '@/components/RichTextEditor'
import KBFileUpload, { type KBUploadedFile } from '@/components/KBFileUpload'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 100)
}

function NewKBContent() {
  const router = useRouter()
  const { isAgent } = useAuth()
  const { serviceTypes } = useServiceTypes()

  const [form, setForm] = useState({ title: '', slug: '', content: '', category: '', published: false })
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [slugEdited, setSlugEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<KBUploadedFile[]>([])
  const editorInsertRef = useRef<((md: string) => void) | null>(null)

  if (!isAgent) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500">에이전트 이상 권한이 필요합니다.</p>
      </div>
    )
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const title = e.target.value
    setForm((f) => ({ ...f, title, slug: slugEdited ? f.slug : slugify(title) }))
  }

  function addTag() {
    const t = tagInput.trim().replace(/^#/, '')
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const article = await createKBArticle({
        title: form.title,
        slug: form.slug || slugify(form.title),
        content: form.content,
        category: form.category || undefined,
        published: form.published,
        tags: tags.length > 0 ? tags : undefined,
      })
      router.push(`/kb/${article.slug}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '아티클 생성에 실패했습니다.')
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <Link href="/kb" className="text-sm text-blue-600 hover:underline">← 지식베이스</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">새 아티클 작성</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            제목 <span className="text-red-500 normal-case">*</span>
          </label>
          <input
            value={form.title}
            onChange={handleTitleChange}
            required
            maxLength={300}
            placeholder="아티클 제목을 입력하세요"
            className="w-full text-xl font-semibold text-gray-900 focus:outline-none placeholder-gray-300 border-0 p-0"
          />
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
            <span>/kb/</span>
            <input
              value={form.slug}
              onChange={(e) => { setSlugEdited(true); setForm((f) => ({ ...f, slug: e.target.value })) }}
              maxLength={300}
              placeholder="url-slug"
              className="flex-1 font-mono focus:outline-none text-gray-600 placeholder-gray-300"
            />
          </div>
        </div>

        {/* Category */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">카테고리</label>
          <div className="grid grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, category: '' }))}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                form.category === ''
                  ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
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
                    ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            본문 <span className="text-red-500 normal-case">*</span>
          </label>
          <RichTextEditor
            value={form.content}
            onChange={(html) => setForm((f) => ({ ...f, content: html }))}
            onInsertRef={(fn) => { editorInsertRef.current = fn }}
            placeholder={'개요, 해결 방법, 참고 내용 등을 작성하세요.'}
            minHeight="320px"
          />
        </div>

        {/* 파일 첨부 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            파일 첨부
          </label>
          <KBFileUpload
            files={attachments}
            onFilesChange={setAttachments}
            onInsert={(md) => {
              // 에디터에 마크다운 삽입 (이미지는 인라인, 파일은 링크)
              if (editorInsertRef.current) {
                editorInsertRef.current(md)
              } else {
                // 폴백: 본문 끝에 append
                setForm((f) => ({ ...f, content: f.content + '\n' + md }))
              }
            }}
          />
        </div>

        {/* Tags */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">태그</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
              placeholder="태그 입력 후 Enter 또는 쉼표"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="button" onClick={addTag} className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">추가</button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
                  #{t}
                  <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} className="hover:text-red-500 ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer: publish + actions */}
        <div className="flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, published: !f.published }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.published ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${form.published ? 'left-6' : 'left-1'}`} />
            </button>
            <div>
              <div className="text-sm font-medium text-gray-700">{form.published ? '즉시 공개' : '초안으로 저장'}</div>
              <div className="text-xs text-gray-400">
                {form.published ? '모든 사용자에게 공개됩니다' : '나중에 공개할 수 있습니다'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-red-600">⚠️ {error}</span>}
            <Link href="/kb" className="border border-gray-300 px-5 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              취소
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '저장 중...' : (form.published ? '게시하기' : '초안 저장')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function NewKBPage() {
  return (
    <RequireAuth>
      <NewKBContent />
    </RequireAuth>
  )
}
