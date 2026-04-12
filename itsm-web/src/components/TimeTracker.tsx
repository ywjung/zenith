'use client'

import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { fetchTimeEntries, logTime, deleteTimeEntry } from '@/lib/api'
import type { TimeEntry } from '@/types'
import { errorMessage } from '@/lib/utils'

interface TimeTrackerProps {
  iid: number
  projectId: string
  /** agent 이상인 경우 true — 입력/삭제 기능 활성화 */
  canLog: boolean
  /** 현재 로그인 사용자 ID (본인 항목 삭제 권한 판단용) */
  currentUserId?: string
  /** admin/agent 역할 여부 (타인 항목 삭제 가능) */
  isAdmin?: boolean
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

export default function TimeTracker({
  iid,
  projectId,
  canLog,
  currentUserId,
  isAdmin = false,
}: TimeTrackerProps) {
  const t = useTranslations('time_tracker')
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [totalMinutes, setTotalMinutes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [hours, setHours] = useState('')
  const [mins, setMins] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchTimeEntries(iid, projectId)
      .then(({ total_minutes, entries: e }) => {
        setTotalMinutes(total_minutes)
        setEntries(e)
        setError(null)
      })
      .catch(() => setError(t('load_failed')))
      .finally(() => setLoading(false))
  }, [iid, projectId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const h = parseInt(hours || '0', 10)
    const m = parseInt(mins || '0', 10)
    const totalMins = h * 60 + m

    if (totalMins < 1) {
      setFormError(t('required'))
      return
    }
    if (totalMins > 10080) {
      setFormError(t('max_exceeded'))
      return
    }

    setSubmitting(true)
    try {
      const entry = await logTime(iid, projectId, totalMins, description || undefined)
      setEntries((prev) => [entry, ...prev])
      setTotalMinutes((prev) => prev + totalMins)
      setHours('')
      setMins('')
      setDescription('')
    } catch (err: unknown) {
      setFormError(errorMessage(err, t('record_failed')))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(entryId: number) {
    if (!confirm(t('delete_confirm'))) return
    setDeletingId(entryId)
    try {
      await deleteTimeEntry(iid, projectId, entryId)
      const removed = entries.find((e) => e.id === entryId)
      setEntries((prev) => prev.filter((e) => e.id !== entryId))
      if (removed) setTotalMinutes((prev) => prev - removed.minutes)
    } catch (err: unknown) {
      toast.error(errorMessage(err, t('delete_failed')))
    } finally {
      setDeletingId(null)
    }
  }

  function canDelete(entry: TimeEntry): boolean {
    if (isAdmin) return true
    return !!currentUserId && entry.agent_id === currentUserId
  }

  return (
    <div className="space-y-3">
      {/* 합계 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('title')}</span>
        {totalMinutes > 0 && (
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
            {t('total', { value: formatMinutes(totalMinutes) })}
          </span>
        )}
      </div>

      {/* 항목 목록 */}
      {loading ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('loading')}</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="text-xs bg-gray-50 dark:bg-gray-800 rounded-md px-2.5 py-2 flex items-start justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                    {formatMinutes(entry.minutes)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 text-[11px]">
                    {new Date(entry.logged_at).toLocaleDateString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
                <div className="text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {entry.agent_name}
                  {entry.description && (
                    <span className="text-gray-400 dark:text-gray-500"> — {entry.description}</span>
                  )}
                </div>
              </div>
              {canDelete(entry) && (
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                  title={t('delete_title')}
                >
                  {deletingId === entry.id ? '...' : '✕'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 입력 폼 (agent 이상만) */}
      {canLog && (
        <form onSubmit={handleSubmit} className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={0}
                max={168}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
                className="w-12 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 text-xs text-center dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">h</span>
              <input
                type="number"
                min={0}
                max={59}
                value={mins}
                onChange={(e) => setMins(e.target.value)}
                placeholder="0"
                className="w-12 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 text-xs text-center dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">m</span>
            </div>
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('note_placeholder')}
            maxLength={500}
            className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {formError && (
            <p className="text-xs text-red-500">{formError}</p>
          )}
          <button
            type="submit"
            disabled={submitting || (!hours && !mins)}
            className={`relative overflow-hidden w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs py-1.5 rounded transition-colors ${submitting ? 'btn-progress' : ''}`}
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>
      )}
    </div>
  )
}
