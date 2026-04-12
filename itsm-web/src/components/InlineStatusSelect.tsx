'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { updateTicket } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'

// 상태 값과 색상만 정의 — 라벨은 constants.ts의 STATUS_LABELS 공용 사용.
// TODO: STATUS_LABELS 자체를 i18n 키로 옮기는 작업은 별도.
const STATUSES: { value: string; color: string }[] = [
  { value: 'open',        color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  { value: 'approved',    color: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300' },
  { value: 'in_progress', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  { value: 'waiting',     color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  { value: 'resolved',    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  { value: 'testing',     color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  { value: 'closed',      color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
]

/**
 * 티켓 목록에서 상태를 인라인으로 변경하는 드롭다운.
 * StatusBadge를 대체하여 에이전트가 1클릭으로 상태 변경 가능.
 */
export default function InlineStatusSelect({
  iid,
  projectId,
  currentStatus,
  onChanged,
}: {
  iid: number
  projectId?: string | number | null
  currentStatus: string
  onChanged?: (newStatus: string) => void
}) {
  const t = useTranslations('inline')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = STATUSES.find(s => s.value === currentStatus) ?? STATUSES[0]

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleChange = async (newStatus: string) => {
    if (newStatus === currentStatus) { setOpen(false); return }
    setSaving(true)
    setOpen(false)
    try {
      await updateTicket(iid, { status: newStatus }, projectId ? String(projectId) : undefined)
      toast.success(t('status_toast', { iid, label: STATUS_LABELS[newStatus] ?? newStatus }))
      onChanged?.(newStatus)
    } catch (err) {
      toast.error(errorMessage(err, t('status_failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-pointer transition-all hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-600 ${saving ? 'opacity-50' : ''} ${current.color}`}
        title={t('status_change')}
      >
        {saving ? t('status_changing') : (STATUS_LABELS[current.value] ?? current.value)}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[140px] animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUSES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleChange(s.value)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                s.value === currentStatus
                  ? 'bg-blue-50 dark:bg-blue-900/30 font-semibold'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${s.color.split(' ')[0]}`} />
              {STATUS_LABELS[s.value] ?? s.value}
              {s.value === currentStatus && <span className="text-blue-500 ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
