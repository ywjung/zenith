'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 다크모드/i18n 가능한 confirm 대체 모달.
 * window.confirm() 대신 사용.
 *
 * 사용 예:
 *   const [confirmOpen, setConfirmOpen] = useState(false)
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     title="정말 삭제하시겠습니까?"
 *     message="이 작업은 되돌릴 수 없습니다."
 *     variant="danger"
 *     confirmLabel="삭제"
 *     onConfirm={() => { handleDelete(); setConfirmOpen(false) }}
 *     onCancel={() => setConfirmOpen(false)}
 *   />
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useTranslations('common')
  const resolvedConfirm = confirmLabel ?? t('confirm')
  const resolvedCancel = cancelLabel ?? t('cancel')
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // 이전 포커스 저장 (모달 닫힐 때 복원)
    const previouslyFocused = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Enter') {
        // textarea/input 안에서는 무시
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        e.preventDefault()
        onConfirm()
        return
      }
      // Tab 키 — focus trap (모달 안에서만 순환)
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    // 포커스를 confirm 버튼으로 이동
    confirmBtnRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onCancel, onConfirm])

  if (!open) return null

  const confirmCls =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500'
      : 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500'

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm animate-scaleIn">
        <div className="p-6">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-bold text-gray-900 dark:text-white mb-2"
          >
            {title}
          </h2>
          {message && (
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
              {message}
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            {resolvedCancel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none ${confirmCls}`}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  )
}
