'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createRating, updateRating, getMyRating } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'

const SCORE_LABELS = ['', '매우 불만족', '불만족', '보통', '만족', '매우 만족']

function RateContent() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const iid = Number(params.id)

  const [score, setScore] = useState(0)
  const [comment, setComment] = useState('')
  const [isEdit, setIsEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 기존 평가 로드
  useEffect(() => {
    getMyRating(iid)
      .then((existing) => {
        if (existing) {
          setScore(existing.score)
          setComment(existing.comment ?? '')
          setIsEdit(true)
        }
      })
      .catch(() => {/* 평가 없음 — 무시 */})
      .finally(() => setLoading(false))
  }, [iid])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (score === 0) {
      setError('별점을 선택해주세요.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        await updateRating(iid, { score, comment: comment || undefined })
      } else {
        await createRating(iid, { score, comment: comment || undefined })
      }
      router.push(`/tickets/${iid}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '평가 제출에 실패했습니다.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400 dark:text-gray-500">로딩 중...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/tickets/${iid}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
          ← 티켓으로 돌아가기
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
          {isEdit ? '만족도 평가 수정' : '만족도 평가'}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {isEdit
            ? '이전에 남긴 평가를 수정할 수 있습니다.'
            : 'IT 서비스 개선을 위해 솔직한 의견을 남겨주세요.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-6">
        {/* 별점 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
            서비스 만족도를 선택해주세요 <span className="text-red-500">*</span>
          </label>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`text-4xl transition-transform hover:scale-110 focus:outline-none ${
                  score >= n ? 'text-yellow-400' : 'text-gray-200 dark:text-gray-600'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          {score > 0 && (
            <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-2">
              {score}점 · {SCORE_LABELS[score]}
            </p>
          )}
        </div>

        {/* 의견 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            추가 의견 <span className="text-gray-400 dark:text-gray-500 font-normal">(선택)</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="서비스에 대한 의견을 자유롭게 작성해주세요."
            className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* 평가자 정보 */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">평가자:</span>{' '}
          {user?.name || user?.username}
          {user?.email && (
            <span className="text-gray-400 dark:text-gray-500 ml-2">({user.email})</span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md p-3 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-yellow-400 hover:bg-yellow-500 dark:bg-yellow-500 dark:hover:bg-yellow-400 text-yellow-900 font-semibold py-2.5 rounded-md transition-colors disabled:opacity-50"
          >
            {submitting ? '제출 중...' : isEdit ? '✏️ 평가 수정' : '⭐ 평가 제출'}
          </button>
          <Link
            href={`/tickets/${iid}`}
            className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-center"
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
