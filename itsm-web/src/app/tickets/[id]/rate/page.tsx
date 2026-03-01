'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createRating } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'

const SCORE_LABELS = ['', '매우 불만족', '불만족', '보통', '만족', '매우 만족']

function RateContent() {
  const params = useParams()
  const router = useRouter()
  const iid = Number(params.id)

  const [form, setForm] = useState({
    employee_name: '',
    employee_email: '',
    score: 0,
    comment: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.score === 0) {
      setError('별점을 선택해주세요.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createRating(iid, {
        employee_name: form.employee_name,
        employee_email: form.employee_email || undefined,
        score: form.score,
        comment: form.comment || undefined,
      })
      router.push(`/tickets/${iid}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '평가 제출에 실패했습니다.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <Link href={`/tickets/${iid}`} className="text-blue-600 hover:underline text-sm">
          ← 티켓으로 돌아가기
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">만족도 평가</h1>
        <p className="text-gray-500 text-sm mt-1">
          IT 서비스 개선을 위해 솔직한 의견을 남겨주세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border shadow-sm p-6 space-y-6">
        {/* 별점 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
            서비스 만족도를 선택해주세요 <span className="text-red-500">*</span>
          </label>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, score: n }))}
                className={`text-4xl transition-transform hover:scale-110 focus:outline-none ${
                  form.score >= n ? 'text-yellow-400' : 'text-gray-200'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          {form.score > 0 && (
            <p className="text-center text-sm text-gray-600 mt-2">
              {form.score}점 · {SCORE_LABELS[form.score]}
            </p>
          )}
        </div>

        {/* 의견 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            추가 의견 <span className="text-gray-400 font-normal">(선택)</span>
          </label>
          <textarea
            value={form.comment}
            onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))}
            rows={4}
            placeholder="서비스에 대한 의견을 자유롭게 작성해주세요."
            className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <hr />

        {/* 신청자 정보 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이름 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.employee_name}
              onChange={(e) => setForm((prev) => ({ ...prev, employee_name: e.target.value }))}
              required
              placeholder="홍길동"
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이메일 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              type="email"
              value={form.employee_email}
              onChange={(e) => setForm((prev) => ({ ...prev, employee_email: e.target.value }))}
              placeholder="hong@company.com"
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold py-2.5 rounded-md transition-colors disabled:opacity-50"
          >
            {submitting ? '제출 중...' : '⭐ 평가 제출'}
          </button>
          <Link
            href={`/tickets/${iid}`}
            className="px-6 py-2.5 border rounded-md text-sm text-gray-600 hover:bg-gray-50 text-center"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  )
}

export default function RatePage() {
  return (
    <RequireAuth>
      <RateContent />
    </RequireAuth>
  )
}
