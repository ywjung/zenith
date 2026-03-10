'use client'

import { useState } from 'react'
import { useServiceTypes } from '@/context/ServiceTypesContext'
import { API_BASE } from '@/lib/constants'

const PRIORITIES = [
  { value: 'low', label: '낮음', color: 'text-gray-600' },
  { value: 'medium', label: '보통', color: 'text-blue-600' },
  { value: 'high', label: '높음', color: 'text-orange-600' },
  { value: 'critical', label: '긴급', color: 'text-red-600' },
]

export default function PortalPage() {
  const { serviceTypes } = useServiceTypes()
  const [form, setForm] = useState({
    name: '',
    email: '',
    title: '',
    content: '',
    category: '',
    priority: 'medium',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ticket_iid: number; track_url: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/portal/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          title: form.title,
          content: form.content,
          category: form.category || undefined,
          priority: form.priority,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '제출에 실패했습니다.')
      }
      const data = await res.json()
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">접수 완료</h1>
        <p className="text-gray-600 mb-2">
          티켓 <strong>#{result.ticket_iid}</strong>이 생성되었습니다.
        </p>
        <p className="text-gray-500 text-sm mb-6">
          이메일로 발송된 링크 또는 아래 링크에서 진행 상황을 확인하실 수 있습니다.
        </p>
        <a
          href={result.track_url}
          className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          진행 상황 확인하기
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">IT 지원 요청</h1>
        <p className="text-gray-500 text-sm mt-1">
          GitLab 계정 없이도 IT 지원을 요청하실 수 있습니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Contact Info */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">신청자 정보</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">이름 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder="홍길동"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">이메일 *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                placeholder="hong@company.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Request Details */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">요청 내용</h2>
          <div>
            <label className="block text-xs text-gray-500 mb-1">제목 *</label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              maxLength={200}
              placeholder="문제를 간략히 설명해 주세요"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">상세 내용 *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              required
              rows={6}
              placeholder="문제 상황, 발생 시점, 영향 범위 등을 자세히 작성해 주세요"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Category */}
        {serviceTypes.filter((t) => t.enabled).length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">분류 (선택)</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: '' }))}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                  form.category === ''
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                미분류
              </button>
              {serviceTypes
                .filter((t) => t.enabled)
                .map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                      form.category === c.value
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Priority */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">긴급도</h2>
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, priority: p.value }))}
                className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                  form.priority === p.value
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={p.color}>{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between gap-4">
          {error && <span className="text-sm text-red-600">⚠️ {error}</span>}
          <div className="ml-auto">
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? '제출 중...' : '지원 요청 제출'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
