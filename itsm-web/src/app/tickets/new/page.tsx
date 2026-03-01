'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createTicket, fetchProjects } from '@/lib/api'
import type { GitLabProject } from '@/types'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'

const CATEGORIES = [
  { value: 'hardware', label: '🖥️ 하드웨어 (PC, 프린터, 모니터 등)' },
  { value: 'software', label: '💻 소프트웨어 (프로그램 오류, 설치 등)' },
  { value: 'network', label: '🌐 네트워크 (인터넷, VPN, 공유폴더 등)' },
  { value: 'account', label: '👤 계정/권한 (비밀번호, 접근권한 등)' },
  { value: 'other', label: '📋 기타' },
]

const PRIORITIES = [
  { value: 'low', label: '낮음', desc: '일상 업무에 영향 없음' },
  { value: 'medium', label: '보통', desc: '불편하지만 업무 가능' },
  { value: 'high', label: '높음', desc: '업무에 지장 있음' },
  { value: 'critical', label: '긴급', desc: '업무 불가 / 즉시 조치 필요' },
]

function NewTicketContent() {
  const router = useRouter()
  const { user } = useAuth()
  const [projects, setProjects] = useState<GitLabProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'software',
    priority: 'medium',
    employee_name: '',
    employee_email: '',
    project_id: '',
  })

  // 로그인한 사용자 정보로 이름/이메일 자동 채우기
  useEffect(() => {
    if (user) {
      setForm((prev) => ({
        ...prev,
        employee_name: prev.employee_name || user.name,
        employee_email: prev.employee_email || user.email,
      }))
    }
  }, [user])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list)
        if (list.length > 0) {
          setForm((prev) => ({ ...prev, project_id: list[0].id }))
        }
      })
      .catch(() => {/* 프로젝트 목록 로드 실패 시 무시 */})
      .finally(() => setProjectsLoading(false))
  }, [])

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        ...form,
        project_id: form.project_id || undefined,
      }
      const ticket = await createTicket(payload)
      const qs = ticket.project_id ? `?project_id=${ticket.project_id}` : ''
      router.push(`/tickets/${ticket.iid}${qs}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '등록에 실패했습니다.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <a href="/" className="text-blue-600 hover:underline text-sm">
          ← 목록으로
        </a>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">IT 지원 요청</h1>
        <p className="text-gray-500 text-sm mt-1">
          문제를 자세히 설명해주시면 빠르게 처리해 드립니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border shadow-sm p-6 space-y-5">
        {/* 프로젝트 선택 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            프로젝트 <span className="text-red-500">*</span>
          </label>
          {projectsLoading ? (
            <div className="w-full border rounded-md px-3 py-2 text-sm text-gray-400 bg-gray-50">
              프로젝트 목록 불러오는 중...
            </div>
          ) : projects.length === 0 ? (
            <div className="w-full border rounded-md px-3 py-2 text-sm text-red-500 bg-red-50">
              접근 가능한 프로젝트가 없습니다.
            </div>
          ) : (
            <select
              name="project_id"
              value={form.project_id}
              onChange={handleChange}
              required
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_with_namespace}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 제목 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            제목 <span className="text-red-500">*</span>
          </label>
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

        {/* 카테고리 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            카테고리 <span className="text-red-500">*</span>
          </label>
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
            required
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* 우선순위 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            긴급도 <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRIORITIES.map((p) => (
              <label
                key={p.value}
                className={`cursor-pointer rounded-md border p-2 text-center transition-colors ${
                  form.priority === p.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
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
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
              </label>
            ))}
          </div>
        </div>

        {/* 상세 내용 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            상세 내용 <span className="text-red-500">*</span>
          </label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            required
            minLength={10}
            rows={5}
            placeholder="언제부터 발생했는지, 어떤 증상인지, 이미 시도해본 방법 등을 적어주세요."
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <hr />

        {/* 신청자 정보 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">신청자 정보</span>
            <span className="text-xs text-gray-400">GitLab 계정 정보로 자동 입력됩니다</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름</label>
              <input
                name="employee_name"
                value={form.employee_name}
                readOnly
                className="w-full border rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">이메일</label>
              <input
                name="employee_email"
                type="email"
                value={form.employee_email}
                readOnly
                className="w-full border rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || projectsLoading || projects.length === 0}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '등록 중...' : '티켓 등록'}
          </button>
          <a
            href="/"
            className="px-6 py-2.5 border rounded-md text-sm text-gray-600 hover:bg-gray-50 text-center"
          >
            취소
          </a>
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
