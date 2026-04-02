'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  createTicket, fetchProjects, fetchProjectMembers, fetchMilestones,
  uploadFile, fetchTemplates, fetchKBArticles,
  fetchCustomFieldDefs, setTicketCustomFields,
} from '@/lib/api'
import type { GitLabProject, ProjectMember, Milestone, TicketTemplate, KBArticle, CustomFieldDef } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import RichTextEditor from '@/components/RichTextEditor'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName, formatFileSize, getFileIcon } from '@/lib/utils'


const PRIORITIES = [
  {
    value: 'low',
    icon: '⚪',
    active: 'border-gray-400 bg-gray-50 dark:bg-gray-700/50',
    inact:  'border-gray-200 dark:border-gray-600',
    labelColor: 'text-gray-700 dark:text-gray-300',
  },
  {
    value: 'medium',
    icon: '🟡',
    active: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20',
    inact:  'border-gray-200 dark:border-gray-600',
    labelColor: 'text-yellow-800 dark:text-yellow-300',
  },
  {
    value: 'high',
    icon: '🟠',
    active: 'border-orange-500 bg-orange-50 dark:bg-orange-900/20',
    inact:  'border-gray-200 dark:border-gray-600',
    labelColor: 'text-orange-800 dark:text-orange-300',
  },
  {
    value: 'critical',
    icon: '🔴',
    active: 'border-red-500 bg-red-50 dark:bg-red-900/20',
    inact:  'border-gray-200 dark:border-gray-600',
    labelColor: 'text-red-700 dark:text-red-400',
  },
]

function SectionNum({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold mr-2 shrink-0">
      {n}
    </span>
  )
}

function NewTicketContent() {
  const router = useRouter()
  const { user, isAgent } = useAuth()
  const { serviceTypes } = useServiceTypes()
  const t = useTranslations('ticket_new')
  const tp = useTranslations('ticket.priority')
  const tf = useTranslations('ticket.fields')
  const tportal = useTranslations('portal')
  const tc = useTranslations('common')

  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [templates, setTemplates] = useState<TicketTemplate[]>([])
  const [kbSuggestions, setKbSuggestions] = useState<KBArticle[]>([])
  const [kbLoading, setKbLoading] = useState(false)
  const kbTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'software',
    priority: 'medium',
    employee_name: '',
    employee_email: '',
    project_id: '',
    department: '',
    location: '',
    assignee_id: '',
    sla_due_date: '',
    milestone_id: '',
  })
  const [confidential, setConfidential] = useState(false)
  const [categoryContext, setCategoryContext] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({})

  // ── 임시저장 ───────────────────────────────────────────────
  const DRAFT_KEY = 'ticket_new_draft'
  const isDirtyRef = useRef(false)
  const submittedRef = useRef(false)
  // 이탈 확인 모달 상태
  const [leaveModal, setLeaveModal] = useState<{ show: boolean; dest: string }>({ show: false, dest: '' })
  // 임시저장 복원 배너 상태
  const [hasDraft, setHasDraft] = useState(false)
  // 임시저장 완료 토스트
  const [draftSaved, setDraftSaved] = useState(false)
  const draftToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 폼 변경 감지
  useEffect(() => {
    isDirtyRef.current = !!(form.title || form.description || form.employee_name)
  }, [form.title, form.description, form.employee_name])

  // 페이지 진입 시 임시저장 데이터 확인
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) setHasDraft(true)
    } catch {}
  }, [])

  // 임시저장 실행
  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, confidential, categoryContext, savedAt: Date.now() }))
      if (draftToastTimer.current) clearTimeout(draftToastTimer.current)
      setDraftSaved(true)
      draftToastTimer.current = setTimeout(() => setDraftSaved(false), 2500)
    } catch {}
  }, [form, confidential, categoryContext])

  // 임시저장 삭제
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setHasDraft(false)
  }, [])

  // 임시저장 복원
  function restoreDraft() {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (!saved) return
      const { form: savedForm, confidential: savedConfidential, categoryContext: savedCtx } = JSON.parse(saved)
      setForm((prev) => ({ ...prev, ...savedForm }))
      if (savedConfidential !== undefined) setConfidential(savedConfidential)
      if (savedCtx !== undefined) setCategoryContext(savedCtx)
    } catch {}
    setHasDraft(false)
    clearDraft()
  }

  // 브라우저 탭 닫기 / 새로고침 경고
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current && !submittedRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Next.js 링크 클릭 이탈 감지 (a 태그 href 클릭 가로채기)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (submittedRef.current || !isDirtyRef.current) return
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') || ''
      // 외부 링크, 앵커, javascript: 제외
      if (!href || href.startsWith('#') || href.startsWith('javascript') || href.startsWith('http')) return
      e.preventDefault()
      e.stopPropagation()
      setLeaveModal({ show: true, dest: href })
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  // ─────────────────────────────────────────────────────────

  // 커스텀 필드 정의 로딩
  useEffect(() => {
    fetchCustomFieldDefs(false).then(setCustomFieldDefs).catch(() => {})
  }, [])

  // 로그인 사용자 정보 자동 채우기
  useEffect(() => {
    if (user) {
      setForm((prev) => ({
        ...prev,
        employee_name: prev.employee_name || formatName(user.name),
        employee_email: prev.employee_email || user.email,
        department: prev.department || user.organization || '',
      }))
    }
  }, [user])

  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list)
        if (list.length > 0) setForm((prev) => ({ ...prev, project_id: list[0].id }))
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
    fetchTemplates()
      .then((list) => setTemplates(list.filter((t) => t.enabled)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!form.project_id) return
    fetchProjectMembers(form.project_id).then(setMembers).catch(() => setMembers([]))
    fetchMilestones(form.project_id).then(setMilestones).catch(() => setMilestones([]))
  }, [form.project_id])

  // KB 자동 추천 — 제목+카테고리+설명 발췌로 관련성 향상 (300ms 디바운스)
  useEffect(() => {
    if (kbTimer.current) clearTimeout(kbTimer.current)
    if (form.title.length < 6) { setKbSuggestions([]); return }
    kbTimer.current = setTimeout(async () => {
      setKbLoading(true)
      try {
        const params = new URLSearchParams({ q: form.title, limit: '3' })
        if (form.category) params.set('category', form.category)
        const descExcerpt = (form.description || '').replace(/[#*`>\[\]()\-_~|!<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
        if (descExcerpt) params.set('desc', descExcerpt)
        const res = await fetch(
          `/api/kb/suggest?${params}`,
          { credentials: 'include', cache: 'no-store' }
        )
        if (res.ok) setKbSuggestions(await res.json())
        else setKbSuggestions([])
      } catch {
        setKbSuggestions([])
      } finally {
        setKbLoading(false)
      }
    }, 300)
    return () => { if (kbTimer.current) clearTimeout(kbTimer.current) }
  }, [form.title, form.category, form.description])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleDescriptionImageUpload(file: File): Promise<string> {
    const result = await uploadFile(file, form.project_id || undefined)
    return `/api/tickets/uploads/proxy?path=${encodeURIComponent(result.proxy_path || result.full_path)}`
  }

  function addFiles(selected: File[]) {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...selected.filter((f) => !existing.has(f.name + f.size))]
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 마크다운 툴바
  function insertMarkdown(prefix: string, suffix = '', placeholder = '텍스트') {
    const ta = document.getElementById('desc-ta') as HTMLTextAreaElement | null
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = form.description.substring(start, end) || placeholder
    const newText =
      form.description.substring(0, start) +
      prefix + selected + suffix +
      form.description.substring(end)
    setForm((prev) => ({ ...prev, description: newText }))
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
    }, 0)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      let description = form.description
      // 카테고리 컨텍스트를 설명 앞에 추가
      const ctxLabel = selectedCategory?.context_label
      if (categoryContext && ctxLabel) {
        description = `**${ctxLabel}**: ${categoryContext}\n\n${description}`
      }
      if (files.length > 0) {
        setUploadingFiles(true)
        const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'])
        const markdowns: string[] = []
        for (const file of files) {
          const result = await uploadFile(file, form.project_id || undefined)
          const ext = (file.name.split('.').pop() || '').toLowerCase()
          const proxyUrl = `/api/tickets/uploads/proxy?path=${encodeURIComponent(result.proxy_path || result.full_path)}`
          markdowns.push(
            IMAGE_EXTS.has(ext)
              ? `![${result.name}](${proxyUrl})`
              : `[📎 ${result.name}](${proxyUrl}&download=true)`
          )
        }
        setUploadingFiles(false)
        description = description + '\n\n' + markdowns.join('\n')
      }
      const payload = {
        ...form,
        description,
        project_id: form.project_id || undefined,
        assignee_id: form.assignee_id ? Number(form.assignee_id) : undefined,
        department: form.department || undefined,
        location: form.location || undefined,
        sla_due_date: form.sla_due_date || undefined,
        milestone_id: form.milestone_id ? Number(form.milestone_id) : undefined,
        confidential,
      }
      const ticket = await createTicket(payload)
      // 커스텀 필드 값 저장
      if (Object.keys(customFieldValues).length > 0) {
        try {
          await setTicketCustomFields(ticket.iid, customFieldValues, ticket.project_id || undefined)
        } catch {
          // 커스텀 필드 저장 실패는 티켓 생성을 막지 않음
        }
      }
      const qs = ticket.project_id ? `?project_id=${ticket.project_id}` : ''
      submittedRef.current = true
      clearDraft()
      router.push(`/tickets/${ticket.iid}${qs}`)
    } catch (err: unknown) {
      setUploadingFiles(false)
      setError(err instanceof Error ? err.message : t('submit_failed'))
      setSubmitting(false)
    }
  }

  const selectedPriority = PRIORITIES.find((p) => p.value === form.priority)
  const selectedCategory = serviceTypes.find((c) => (c.description || c.value) === form.category)
  const canSubmit = !submitting && !projectsLoading && projects.length > 0 && form.title.trim().length > 0

  return (
    <div className="w-full">

      {/* ── 이탈 확인 모달 ── */}
      {leaveModal.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4 overflow-hidden">
            {/* 상단 강조 바 */}
            <div className="h-1 w-full bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400" />
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">작성 중인 내용이 있습니다</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">페이지를 이동하면 작성한 내용이 사라집니다.<br />임시저장 후 이동하시겠습니까?</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    saveDraft()
                    setHasDraft(true)
                    setLeaveModal({ show: false, dest: '' })
                    submittedRef.current = true
                    window.location.href = leaveModal.dest
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                >
                  💾 임시저장 후 이동
                </button>
                <button
                  onClick={() => {
                    clearDraft()
                    setLeaveModal({ show: false, dest: '' })
                    submittedRef.current = true
                    window.location.href = leaveModal.dest
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-semibold transition-colors"
                >
                  저장하지 않고 이동
                </button>
                <button
                  onClick={() => setLeaveModal({ show: false, dest: '' })}
                  className="w-full py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  계속 작성하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 임시저장 완료 토스트 ── */}
      {draftSaved && (
        <div className="fixed bottom-6 right-6 z-[9998] flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-900 dark:bg-gray-700 text-white text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          임시저장 완료
        </div>
      )}

      {/* ── 임시저장 복원 배너 ── */}
      {hasDraft && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-amber-800 dark:text-amber-300 flex-1">
            임시저장된 작성 내용이 있습니다.
          </p>
          <button
            type="button"
            onClick={restoreDraft}
            className="text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline shrink-0"
          >
            불러오기
          </button>
          <button
            type="button"
            onClick={clearDraft}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0"
          >
            삭제
          </button>
        </div>
      )}

      {/* 브레드크럼 */}
      <div className="mb-5">
        <a href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('back')}</a>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('desc')}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-5 items-start">

        {/* ══ 왼쪽: 폼 섹션 ══ */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* 템플릿 */}
          {templates.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{t('template_section')}</p>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        description: t.description,
                        category: t.category || prev.category,
                      }))
                    }
                    className="text-xs px-3 py-1.5 rounded-full border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ① 서비스 유형 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
              <SectionNum n={1} />{t('service_type')}
            </p>

            <div className="grid grid-cols-5 gap-2">
              {serviceTypes.filter(t => t.enabled).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, category: c.description || c.value }))
                    setCategoryContext('')
                  }}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 transition-all text-center ${
                    form.category === (c.description || c.value)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-sm'
                      : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="text-2xl leading-none">{c.emoji}</span>
                  <span className={`text-xs font-semibold leading-tight mt-0.5 ${form.category === c.value ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>

            {/* 카테고리별 세부 선택 */}
            {selectedCategory?.context_label && (selectedCategory?.context_options?.length ?? 0) > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                  {selectedCategory.context_label} <span className="text-gray-400 dark:text-gray-500 font-normal">{t('optional')}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCategory.context_options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setCategoryContext(categoryContext === opt ? '' : opt)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        categoryContext === opt
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ② 요청 내용 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-5 space-y-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center">
              <SectionNum n={2} />{t('request_content')}
            </p>

            {/* 제목 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {tf('subject')} <span className="text-red-500">*</span>
                </label>
                <span className={`text-xs tabular-nums ${form.title.length > 180 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                  {form.title.length}/200
                </span>
              </div>
              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                required
                minLength={5}
                maxLength={200}
                placeholder={t('subject_placeholder')}
                className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 상세 내용 — 리치 텍스트 에디터 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {tf('description')} <span className="text-red-500">*</span>
              </label>
              <RichTextEditor
                value={form.description}
                onChange={(html) => setForm((prev) => ({ ...prev, description: html }))}
                placeholder={t('content_placeholder')}
                minHeight="180px"
                onImageUpload={handleDescriptionImageUpload}
              />
            </div>

            {/* 파일 첨부 */}
            <div>
              <label htmlFor="ticket-new-file-upload" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('attachment_label')}{' '}
                <span className="text-xs font-normal text-gray-400 dark:text-gray-500">{t('attachment_optional')}</span>
              </label>
              <label
                htmlFor="ticket-new-file-upload"
                className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-md px-4 py-3 cursor-pointer transition-colors text-sm ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10'
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <span>📎</span>
                <span>{isDragging ? t('drop_here') : t('file_select')}</span>
                <input
                  id="ticket-new-file-upload"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="sr-only"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.log"
                />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((file, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-700 rounded px-3 py-1.5">
                      <span className="shrink-0">{getFileIcon(file.name)}</span>
                      <span className="truncate text-gray-700 dark:text-gray-200 flex-1">{file.name}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">{formatFileSize(file.size)}</span>
                      <button type="button" onClick={() => removeFile(idx)} className="text-gray-400 hover:text-red-500 text-xs shrink-0">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ③ 긴급도 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center">
              <SectionNum n={3} />{t('urgency')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORITIES.map((p) => (
                <label
                  key={p.value}
                  className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                    form.priority === p.value ? p.active + ' shadow-sm' : p.inact + ' hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={p.value}
                    checked={form.priority === p.value}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base leading-none">{p.icon}</span>
                    <span className={`text-sm font-semibold ${form.priority === p.value ? p.labelColor : 'text-gray-700 dark:text-gray-300'}`}>
                      {tp(p.value as Parameters<typeof tp>[0])}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{t(('priority_' + p.value + '_desc') as Parameters<typeof t>[0])}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                    {t('processing_target')}{' '}
                    <span className={`font-semibold ${form.priority === p.value ? p.labelColor : 'text-gray-600 dark:text-gray-300'}`}>
                      {t(('priority_' + p.value + '_sla') as Parameters<typeof t>[0])}
                    </span>
                  </p>
                </label>
              ))}
            </div>
          </div>

          {/* ④ 신청자 정보 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center">
                <SectionNum n={4} />{t('requester_info')}
              </p>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('auto_filled')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{tportal('name_label')}</label>
                <input
                  name="employee_name"
                  aria-label={tportal('name_label')}
                  value={form.employee_name}
                  readOnly
                  className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{tportal('email_label')}</label>
                <input
                  name="employee_email"
                  type="email"
                  aria-label={tportal('email_label')}
                  value={form.employee_email}
                  readOnly
                  className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                  {t('department')} <span className="text-gray-400 dark:text-gray-500">{t('optional')}</span>
                </label>
                <input
                  name="department"
                  value={form.department}
                  onChange={handleChange}
                  placeholder={t('department_placeholder')}
                  className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                  {t('location_label')} <span className="text-gray-400 dark:text-gray-500">{t('optional')}</span>
                </label>
                <input
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  placeholder={t('location_placeholder')}
                  className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* ⑤ 관리자 설정 (에이전트 이상) */}
          {isAgent && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-5">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <SectionNum n={5} />{t('admin_settings')}
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full font-normal">{t('agent_only')}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* 프로젝트 (복수인 경우만) */}
                {projects.length > 1 && (
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('project_label')}</label>
                    {projectsLoading ? (
                      <div className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700/50">{tc('loading')}</div>
                    ) : (
                      <select
                        name="project_id"
                        aria-label={t('project_label')}
                        value={form.project_id}
                        onChange={handleChange}
                        className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name_with_namespace}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                {/* 담당자 */}
                {members.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                      {tf('assignee')} <span className="text-gray-400 dark:text-gray-500">{t('optional')}</span>
                    </label>
                    <select
                      name="assignee_id"
                      aria-label={tf('assignee')}
                      value={form.assignee_id}
                      onChange={handleChange}
                      className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{t('assignee_none')}</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{formatName(m.name)} (@{m.username})</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* SLA */}
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                    {t('deadline_label')} <span className="text-gray-400 dark:text-gray-500">{t('deadline_optional')}</span>
                  </label>
                  <input
                    type="date"
                    name="sla_due_date"
                    aria-label={t('deadline_label')}
                    value={form.sla_due_date}
                    onChange={handleChange}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {/* 마일스톤 */}
                {milestones.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                    {t('milestone_label')} <span className="text-gray-400 dark:text-gray-500">{t('optional')}</span>
                  </label>
                  <select
                    name="milestone_id"
                    aria-label={t('milestone_label')}
                    value={form.milestone_id}
                    onChange={handleChange}
                    className="w-full border dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('milestone_none')}</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}{m.due_date ? ` (${m.due_date})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                )}
              </div>
            </div>
          )}

          {/* 커스텀 필드 */}
          {customFieldDefs.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('extra_info')}</h3>
              <div className="space-y-3">
                {customFieldDefs.map(f => (
                  <div key={f.id}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    {f.field_type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={customFieldValues[f.name] === 'true'}
                        onChange={e => setCustomFieldValues(prev => ({ ...prev, [f.name]: e.target.checked ? 'true' : 'false' }))}
                        className="rounded border-gray-300 text-blue-600"
                      />
                    ) : f.field_type === 'select' ? (
                      <select
                        aria-label={f.label}
                        value={customFieldValues[f.name] ?? ''}
                        onChange={e => setCustomFieldValues(prev => ({ ...prev, [f.name]: e.target.value }))}
                        className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">선택...</option>
                        {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.field_type === 'number' ? 'number' : 'text'}
                        value={customFieldValues[f.name] ?? ''}
                        onChange={e => setCustomFieldValues(prev => ({ ...prev, [f.name]: e.target.value }))}
                        className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 기밀 티켓 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confidential}
                onChange={(e) => setConfidential(e.target.checked)}
                className="w-4 h-4 text-red-600 border-gray-300 dark:border-gray-600 rounded focus:ring-red-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">🔒 기밀 티켓</span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">담당자와 관리자만 내용을 확인할 수 있습니다.</p>
              </div>
            </label>
          </div>

          {/* 오류 */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md p-3 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* 제출 버튼 */}
          <div className="flex gap-3 pb-6">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {uploadingFiles ? '📤 파일 업로드 중...' : submitting ? '등록 중...' : '✓ 티켓 등록'}
            </button>
            <button
              type="button"
              onClick={() => { saveDraft(); setHasDraft(true) }}
              className="px-4 py-2.5 border border-amber-300 dark:border-amber-600 rounded-lg text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors font-medium"
              title="현재 내용을 임시저장합니다"
            >
              💾 임시저장
            </button>
            <a
              href="/"
              className="px-6 py-2.5 border dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-center transition-colors"
            >
              취소
            </a>
          </div>
        </div>

        {/* ══ 오른쪽: 사이드바 ══ */}
        <div className="w-60 shrink-0 sticky top-4 space-y-3 pb-6">

          {/* 요청 요약 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">요청 요약</p>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0 mt-0.5">{selectedCategory?.emoji ?? '📋'}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-none mb-0.5">유형</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedCategory?.label ?? '-'}</p>
                  {categoryContext && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">· {categoryContext}</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0 mt-0.5">{selectedPriority?.icon ?? '🟡'}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-none mb-0.5">{t('urgency')}</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{selectedPriority ? tp(selectedPriority.value as Parameters<typeof tp>[0]) : '-'}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('processing_target')} <span className="font-semibold">{selectedPriority ? t(('priority_' + selectedPriority.value + '_sla') as Parameters<typeof t>[0]) : '-'}</span></p>
                </div>
              </div>
              {form.title && (
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">{tf('subject')}</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-3 leading-relaxed">{form.title}</p>
                </div>
              )}
              {form.employee_name && (
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {form.employee_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate">{form.employee_name}</p>
                    {form.department && <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{form.department}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* KB 문서 제안 */}
          {(kbLoading || kbSuggestions.length > 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">💡 관련 문서</p>
              {kbLoading ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">검색 중...</p>
              ) : (
                <ul className="space-y-2">
                  {kbSuggestions.map((a) => (
                    <li key={a.id} className="flex items-start gap-1">
                      <span className="text-blue-400 dark:text-blue-500 text-xs mt-0.5 shrink-0">▶</span>
                      <a
                        href={`/kb/${a.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline leading-snug"
                      >
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 border-t dark:border-gray-700 pt-2 border-gray-100">
                문서에서 해결 방법을 먼저 확인해보세요.
              </p>
            </div>
          )}

          {/* 작성 팁 */}
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700/50 p-4">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">✏️ 작성 팁</p>
            <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-1.5">
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>언제부터 문제가 발생했는지</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>어떤 오류 메시지가 나오는지</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>이미 시도해본 방법</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>스크린샷이 있다면 첨부</span></li>
            </ul>
          </div>

          {/* 처리 예상 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700/50 p-4">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1">⏱ 처리 예상</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-400 leading-relaxed">
              <span className="font-semibold">{selectedPriority ? tp(selectedPriority.value as Parameters<typeof tp>[0]) : '-'}</span> 우선순위의 경우{' '}
              <span className="font-semibold">{selectedPriority ? t(('priority_' + selectedPriority.value + '_sla') as Parameters<typeof t>[0]) : '-'}</span> 내 처리를 목표로 합니다.
            </p>
            <p className="text-[10px] text-blue-500 dark:text-blue-500 mt-1">* 업무 시간 기준 / 상황에 따라 변동</p>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function NewTicketPage() {
  return (
    <RequireAuth>
      <NewTicketContent />
    </RequireAuth>
  )
}
