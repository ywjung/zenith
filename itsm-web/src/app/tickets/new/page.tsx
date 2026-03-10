'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  createTicket, fetchProjects, fetchProjectMembers,
  uploadFile, fetchTemplates, fetchKBArticles,
} from '@/lib/api'
import type { GitLabProject, ProjectMember, TicketTemplate, KBArticle } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import RichTextEditor from '@/components/RichTextEditor'
import { useAuth } from '@/context/AuthContext'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { formatName, formatFileSize, getFileIcon } from '@/lib/utils'


const PRIORITIES = [
  {
    value: 'low',      label: '낮음', desc: '일상 업무에 영향 없음',    sla: '5일',
    icon: '⚪', active: 'border-gray-400 bg-gray-50',   inact: 'border-gray-200',
    labelColor: 'text-gray-700',
  },
  {
    value: 'medium',   label: '보통', desc: '불편하지만 업무 가능',      sla: '3일',
    icon: '🟡', active: 'border-yellow-500 bg-yellow-50', inact: 'border-gray-200',
    labelColor: 'text-yellow-800',
  },
  {
    value: 'high',     label: '높음', desc: '업무에 지장 있음',          sla: '24시간',
    icon: '🟠', active: 'border-orange-500 bg-orange-50', inact: 'border-gray-200',
    labelColor: 'text-orange-800',
  },
  {
    value: 'critical', label: '긴급', desc: '업무 불가 · 즉시 조치 필요', sla: '4시간',
    icon: '🔴', active: 'border-red-500 bg-red-50',      inact: 'border-gray-200',
    labelColor: 'text-red-700',
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

  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [members, setMembers] = useState<ProjectMember[]>([])
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
  })
  const [confidential, setConfidential] = useState(false)
  const [categoryContext, setCategoryContext] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [form.project_id])

  // KB 자동 추천 — /kb/suggest 전용 API 사용 (300ms 디바운스)
  useEffect(() => {
    if (kbTimer.current) clearTimeout(kbTimer.current)
    if (form.title.length < 6) { setKbSuggestions([]); return }
    kbTimer.current = setTimeout(async () => {
      setKbLoading(true)
      try {
        const res = await fetch(
          `/api/kb/suggest?q=${encodeURIComponent(form.title)}&limit=3`,
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
  }, [form.title])

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
        confidential,
      }
      const ticket = await createTicket(payload)
      const qs = ticket.project_id ? `?project_id=${ticket.project_id}` : ''
      router.push(`/tickets/${ticket.iid}${qs}`)
    } catch (err: unknown) {
      setUploadingFiles(false)
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.')
      setSubmitting(false)
    }
  }

  const selectedPriority = PRIORITIES.find((p) => p.value === form.priority)
  const selectedCategory = serviceTypes.find((c) => c.value === form.category)
  const canSubmit = !submitting && !projectsLoading && projects.length > 0

  return (
    <div className="w-full">
      {/* 브레드크럼 */}
      <div className="mb-5">
        <a href="/" className="text-sm text-blue-600 hover:underline">← 목록으로</a>
        <h1 className="text-xl font-bold text-gray-900 mt-1">IT 지원 요청</h1>
        <p className="text-sm text-gray-500 mt-0.5">문제를 자세히 설명해주시면 빠르게 처리해 드립니다.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-5 items-start">

        {/* ══ 왼쪽: 폼 섹션 ══ */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* 템플릿 */}
          {templates.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">📋 템플릿으로 빠르게 시작</p>
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
                    className="text-xs px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ① 서비스 유형 */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
              <SectionNum n={1} />서비스 유형
            </p>

            <div className="grid grid-cols-5 gap-2">
              {serviceTypes.filter(t => t.enabled).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, category: c.value }))
                    setCategoryContext('')
                  }}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 transition-all text-center ${
                    form.category === c.value
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-2xl leading-none">{c.emoji}</span>
                  <span className={`text-xs font-semibold leading-tight mt-0.5 ${form.category === c.value ? 'text-blue-700' : 'text-gray-700'}`}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>

            {/* 카테고리별 세부 선택 */}
            {selectedCategory?.context_label && (selectedCategory?.context_options?.length ?? 0) > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-600 mb-1.5">
                  {selectedCategory.context_label} <span className="text-gray-400 font-normal">(선택)</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCategory.context_options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setCategoryContext(categoryContext === opt ? '' : opt)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        categoryContext === opt
                          ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
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
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
            <p className="text-sm font-semibold text-gray-700 flex items-center">
              <SectionNum n={2} />요청 내용
            </p>

            {/* 제목 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">
                  제목 <span className="text-red-500">*</span>
                </label>
                <span className={`text-xs tabular-nums ${form.title.length > 180 ? 'text-red-500' : 'text-gray-400'}`}>
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
                placeholder="예: 컴퓨터가 켜지지 않습니다"
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 상세 내용 — 리치 텍스트 에디터 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                상세 내용 <span className="text-red-500">*</span>
              </label>
              <RichTextEditor
                value={form.description}
                onChange={(html) => setForm((prev) => ({ ...prev, description: html }))}
                placeholder={'언제부터 발생했는지, 어떤 증상인지,\n이미 시도해본 방법 등을 적어주세요.'}
                minHeight="180px"
                onImageUpload={handleDescriptionImageUpload}
              />
            </div>

            {/* 파일 첨부 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                파일 첨부{' '}
                <span className="text-xs font-normal text-gray-400">(선택, 최대 10MB)</span>
              </label>
              <label
                className={`flex items-center justify-center gap-2 w-full border-2 border-dashed rounded-md px-4 py-3 cursor-pointer transition-colors text-sm ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 text-blue-600'
                    : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:bg-blue-50'
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <span>📎</span>
                <span>{isDragging ? '여기에 놓으세요' : '파일 선택 또는 드래그 앤 드롭'}</span>
                <input
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
                    <li key={idx} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-3 py-1.5">
                      <span className="shrink-0">{getFileIcon(file.name)}</span>
                      <span className="truncate text-gray-700 flex-1">{file.name}</span>
                      <span className="text-gray-400 text-xs shrink-0">{formatFileSize(file.size)}</span>
                      <button type="button" onClick={() => removeFile(idx)} className="text-gray-400 hover:text-red-500 text-xs shrink-0">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ③ 긴급도 */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
              <SectionNum n={3} />긴급도
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORITIES.map((p) => (
                <label
                  key={p.value}
                  className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                    form.priority === p.value ? p.active + ' shadow-sm' : p.inact + ' hover:border-gray-300'
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
                    <span className={`text-sm font-semibold ${form.priority === p.value ? p.labelColor : 'text-gray-700'}`}>
                      {p.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">{p.desc}</p>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    처리 목표:{' '}
                    <span className={`font-semibold ${form.priority === p.value ? p.labelColor : 'text-gray-600'}`}>
                      {p.sla}
                    </span>
                  </p>
                </label>
              ))}
            </div>
          </div>

          {/* ④ 신청자 정보 */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700 flex items-center">
                <SectionNum n={4} />신청자 정보
              </p>
              <span className="text-xs text-gray-400">GitLab 계정에서 자동 입력</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">이름</label>
                <input
                  name="employee_name"
                  value={form.employee_name}
                  readOnly
                  className="w-full border rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">이메일</label>
                <input
                  name="employee_email"
                  type="email"
                  value={form.employee_email}
                  readOnly
                  className="w-full border rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  부서 <span className="text-gray-400">(선택)</span>
                </label>
                <input
                  name="department"
                  value={form.department}
                  onChange={handleChange}
                  placeholder="예: 개발팀, 영업부"
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  위치 <span className="text-gray-400">(선택)</span>
                </label>
                <input
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  placeholder="예: 3층 A동, 본사 2층"
                  className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* ⑤ 관리자 설정 (에이전트 이상) */}
          {isAgent && (
            <div className="bg-white rounded-lg border shadow-sm p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <SectionNum n={5} />관리자 설정
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-normal">에이전트 이상</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {/* 프로젝트 (복수인 경우만) */}
                {projects.length > 1 && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">프로젝트</label>
                    {projectsLoading ? (
                      <div className="w-full border rounded-md px-3 py-2 text-sm text-gray-400 bg-gray-50">불러오는 중...</div>
                    ) : (
                      <select
                        name="project_id"
                        value={form.project_id}
                        onChange={handleChange}
                        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    <label className="text-xs text-gray-500 block mb-1">
                      담당자 <span className="text-gray-400">(선택)</span>
                    </label>
                    <select
                      name="assignee_id"
                      value={form.assignee_id}
                      onChange={handleChange}
                      className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">담당자 없음</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{formatName(m.name)} (@{m.username})</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* SLA */}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    처리 기한 <span className="text-gray-400">(비워두면 자동)</span>
                  </label>
                  <input
                    type="date"
                    name="sla_due_date"
                    value={form.sla_due_date}
                    onChange={handleChange}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 기밀 티켓 */}
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confidential}
                onChange={(e) => setConfidential(e.target.checked)}
                className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">🔒 기밀 티켓</span>
                <p className="text-xs text-gray-500 mt-0.5">담당자와 관리자만 내용을 확인할 수 있습니다.</p>
              </div>
            </label>
          </div>

          {/* 오류 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
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
            <a
              href="/"
              className="px-6 py-2.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 text-center transition-colors"
            >
              취소
            </a>
          </div>
        </div>

        {/* ══ 오른쪽: 사이드바 ══ */}
        <div className="w-60 shrink-0 sticky top-4 space-y-3 pb-6">

          {/* 요청 요약 */}
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">요청 요약</p>
            <div className="space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0 mt-0.5">{selectedCategory?.emoji ?? '📋'}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">유형</p>
                  <p className="text-sm font-medium text-gray-800">{selectedCategory?.label ?? '-'}</p>
                  {categoryContext && (
                    <p className="text-xs text-gray-500 mt-0.5">· {categoryContext}</p>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0 mt-0.5">{selectedPriority?.icon ?? '🟡'}</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">긴급도</p>
                  <p className="text-sm font-medium text-gray-800">{selectedPriority?.label ?? '-'}</p>
                  <p className="text-[11px] text-gray-500">처리 목표: <span className="font-semibold">{selectedPriority?.sla}</span></p>
                </div>
              </div>
              {form.title && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 mb-0.5">제목</p>
                  <p className="text-xs text-gray-700 line-clamp-3 leading-relaxed">{form.title}</p>
                </div>
              )}
              {form.employee_name && (
                <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {form.employee_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-700 font-medium truncate">{form.employee_name}</p>
                    {form.department && <p className="text-[11px] text-gray-400 truncate">{form.department}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* KB 문서 제안 */}
          {(kbLoading || kbSuggestions.length > 0) && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">💡 관련 문서</p>
              {kbLoading ? (
                <p className="text-xs text-gray-400 animate-pulse">검색 중...</p>
              ) : (
                <ul className="space-y-2">
                  {kbSuggestions.map((a) => (
                    <li key={a.id} className="flex items-start gap-1">
                      <span className="text-blue-400 text-xs mt-0.5 shrink-0">▶</span>
                      <a
                        href={`/kb/${a.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline leading-snug"
                      >
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-gray-400 mt-2 border-t pt-2 border-gray-100">
                문서에서 해결 방법을 먼저 확인해보세요.
              </p>
            </div>
          )}

          {/* 작성 팁 */}
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
            <p className="text-xs font-semibold text-amber-800 mb-2">✏️ 작성 팁</p>
            <ul className="text-[11px] text-amber-700 space-y-1.5">
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>언제부터 문제가 발생했는지</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>어떤 오류 메시지가 나오는지</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>이미 시도해본 방법</span></li>
              <li className="flex gap-1.5"><span className="shrink-0">•</span><span>스크린샷이 있다면 첨부</span></li>
            </ul>
          </div>

          {/* 처리 예상 */}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <p className="text-xs font-semibold text-blue-800 mb-1">⏱ 처리 예상</p>
            <p className="text-[11px] text-blue-700 leading-relaxed">
              <span className="font-semibold">{selectedPriority?.label}</span> 우선순위의 경우{' '}
              <span className="font-semibold">{selectedPriority?.sla}</span> 내 처리를 목표로 합니다.
            </p>
            <p className="text-[10px] text-blue-500 mt-1">* 업무 시간 기준 / 상황에 따라 변동</p>
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
