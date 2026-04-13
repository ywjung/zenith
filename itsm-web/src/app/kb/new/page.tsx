'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createKBArticle } from '@/lib/api'
import dynamic from 'next/dynamic'
import RequireAuth from '@/components/RequireAuth'
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false })
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
  const t = useTranslations('kb')

  // KB 작성 템플릿
  const KB_TEMPLATES = [
    { id: 'blank', label: '빈 문서', icon: '📄', content: '' },
    { id: 'troubleshoot', label: '문제 해결', icon: '🔧', content: '<h2>증상</h2>\n<p>어떤 문제가 발생하는지 설명해주세요.</p>\n\n<h2>원인</h2>\n<p>문제의 근본 원인을 기술합니다.</p>\n\n<h2>해결 방법</h2>\n<ol><li>첫 번째 단계</li><li>두 번째 단계</li></ol>\n\n<h2>관련 문서</h2>\n<p>참고할 수 있는 다른 KB 문서나 외부 링크</p>' },
    { id: 'faq', label: 'FAQ', icon: '❓', content: '<h2>질문</h2>\n<p>자주 묻는 질문을 작성합니다.</p>\n\n<h2>답변</h2>\n<p>명확하고 간결한 답변을 작성합니다.</p>\n\n<h2>추가 참고</h2>\n<p>더 자세한 내용이 필요하면 이곳에 작성합니다.</p>' },
    { id: 'howto', label: '절차 가이드', icon: '📝', content: '<h2>개요</h2>\n<p>이 절차의 목적과 대상을 설명합니다.</p>\n\n<h2>사전 조건</h2>\n<ul><li>필요한 권한 또는 도구</li></ul>\n\n<h2>절차</h2>\n<ol><li><strong>1단계:</strong> 설명</li><li><strong>2단계:</strong> 설명</li><li><strong>3단계:</strong> 설명</li></ol>\n\n<h2>확인 사항</h2>\n<p>절차 완료 후 확인할 사항을 기술합니다.</p>' },
  ]
  const [showTemplates, setShowTemplates] = useState(true)
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
        <p className="text-gray-500 dark:text-gray-400">{t('permission_denied')}</p>
      </div>
    )
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const title = e.target.value
    setForm((f) => ({ ...f, title, slug: slugEdited ? f.slug : slugify(title) }))
  }

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) setTags((prev) => [...prev, tag])
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
      setError(err instanceof Error ? err.message : t('create_failed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <Link href="/kb" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('back_to_kb')}</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('new_article_title')}</h1>

      {/* 템플릿 선택 */}
      {showTemplates && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 mb-5">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">📄 템플릿으로 시작하기</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {KB_TEMPLATES.map(tmpl => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => {
                  setForm(f => ({ ...f, content: tmpl.content }))
                  setShowTemplates(false)
                }}
                className="flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all active:scale-95 text-center"
              >
                <span className="text-2xl">{tmpl.icon}</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{tmpl.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            {t('title_label')} <span className="text-red-500 normal-case">*</span>
          </label>
          <input
            value={form.title}
            onChange={handleTitleChange}
            required
            maxLength={300}
            placeholder={t('title_placeholder')}
            className="w-full text-xl font-semibold text-gray-900 dark:text-gray-100 bg-transparent focus:outline-none placeholder-gray-300 dark:placeholder-gray-600 border-0 p-0"
          />
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>/kb/</span>
            <input
              value={form.slug}
              onChange={(e) => { setSlugEdited(true); setForm((f) => ({ ...f, slug: e.target.value })) }}
              maxLength={300}
              placeholder="url-slug"
              className="flex-1 font-mono bg-transparent focus:outline-none text-gray-600 dark:text-gray-400 placeholder-gray-300 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {/* Category */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('category_label')}</label>
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
              <span>{t('none_category')}</span>
            </button>
            {serviceTypes.filter(st => st.enabled).map((c) => (
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
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t('content_label')} <span className="text-red-500 normal-case">*</span>
          </label>
          <RichTextEditor
            value={form.content}
            onChange={(html) => setForm((f) => ({ ...f, content: html }))}
            onInsertRef={(fn) => { editorInsertRef.current = fn }}
            placeholder={t('content_placeholder')}
            minHeight="320px"
          />
        </div>

        {/* Attachments */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t('attachment_label')}
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
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('tags_label')}</label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
              placeholder={t('tags_placeholder')}
              className="flex-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={addTag}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('tag_add_btn')}
            </button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-full px-2.5 py-1">
                  #{tag}
                  <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== tag))} className="hover:text-red-500 ml-0.5" aria-label="제거">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer: publish + actions */}
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
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{form.published ? t('publish_now') : t('save_as_draft')}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {form.published ? t('visible_to_all') : t('visible_later')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {error && <span className="text-sm text-red-600 dark:text-red-400">⚠️ {error}</span>}
            <Link
              href="/kb"
              className="border border-gray-300 dark:border-gray-600 px-5 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('cancel_btn')}
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t('saving_btn') : (form.published ? t('publish_btn_submit') : t('draft_save_btn'))}
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
