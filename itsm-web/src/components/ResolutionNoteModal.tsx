'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

const RESOLUTION_TYPES = [
  { value: 'permanent_fix', i18nPrefix: 'type_permanent_fix' },
  { value: 'workaround',    i18nPrefix: 'type_workaround' },
  { value: 'no_action',     i18nPrefix: 'type_no_action' },
  { value: 'duplicate',     i18nPrefix: 'type_duplicate' },
  { value: 'by_mr',         i18nPrefix: 'type_by_mr' },
] as const

interface Props {
  ticketIid: number
  targetStatus: 'resolved' | 'closed'
  onConfirm: (note: string, type: string, reason: string) => void
  onCancel: () => void
}

export default function ResolutionNoteModal({ ticketIid, targetStatus, onConfirm, onCancel }: Props) {
  const t = useTranslations('resolution_modal')
  const [note, setNote] = useState('')
  const [type, setType] = useState('permanent_fix')
  const [reason, setReason] = useState('')

  const statusLabel = targetStatus === 'resolved' ? t('status_resolved') : t('status_closed')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] animate-scaleIn">
        <div className="px-6 pt-6 pb-4 border-b dark:border-gray-700 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {t('title', { iid: ticketIid, label: statusLabel })}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('subtitle')}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('type_label')}</label>
            <div className="grid grid-cols-1 gap-2">
              {RESOLUTION_TYPES.map(rt => (
                <label
                  key={rt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    type === rt.value
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="resolution_type"
                    value={rt.value}
                    checked={type === rt.value}
                    onChange={() => setType(rt.value)}
                    className="shrink-0"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{t(`${rt.i18nPrefix}_label` as 'type_permanent_fix_label')}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t(`${rt.i18nPrefix}_desc` as 'type_permanent_fix_desc')}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              {t('note_label')}
              <span className="text-gray-400 font-normal ml-1">{t('optional')}</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder={t('note_placeholder')}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none dark:bg-gray-800 dark:text-gray-100"
              maxLength={5000}
            />
            <div className="text-xs text-gray-400 text-right mt-0.5">{note.length}/5000</div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
              {t('reason_label')}
              <span className="text-gray-400 font-normal ml-1">{t('optional')}</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('reason_placeholder')}
              maxLength={500}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => onConfirm(note, type, reason)}
            className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            {t('confirm', { label: statusLabel })}
          </button>
        </div>
      </div>
    </div>
  )
}
