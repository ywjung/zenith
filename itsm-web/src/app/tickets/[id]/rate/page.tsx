'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createRating, updateRating, getMyRating } from '@/lib/api'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import { errorMessage } from '@/lib/utils'

function RateContent() {
  const t = useTranslations('rating')
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

  useEffect(() => {
    getMyRating(iid)
      .then((existing) => {
        if (existing) {
          setScore(existing.score)
          setComment(existing.comment ?? '')
          setIsEdit(true)
        }
      })
      .catch(() => {/* no existing rating */})
      .finally(() => setLoading(false))
  }, [iid])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (score === 0) {
      setError(t('score_required'))
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
      setError(errorMessage(err, t('submit_failed')))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400 dark:text-gray-500">{t('loading')}</div>
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/tickets/${iid}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
          {t('back')}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
          {isEdit ? t('title_edit') : t('title_new')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {isEdit ? t('subtitle_edit') : t('subtitle_new')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
            {t('score_label')} <span className="text-red-500">*</span>
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
              {t('score_summary', { score, label: t(`score_${score}` as 'score_1') })}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('comment_label')} <span className="text-gray-400 dark:text-gray-500 font-normal">{t('comment_optional')}</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder={t('comment_placeholder')}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <hr className="border-gray-200 dark:border-gray-700" />

        <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-300">{t('rater')}</span>{' '}
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
            className="flex-1 bg-yellow-400 hover:bg-yellow-500 dark:bg-yellow-500 dark:hover:bg-yellow-400 text-yellow-900 font-semibold py-2.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t('submitting') : isEdit ? t('submit_edit') : t('submit_new')}
          </button>
          <Link
            href={`/tickets/${iid}`}
            className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-center"
          >
            {t('cancel')}
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
