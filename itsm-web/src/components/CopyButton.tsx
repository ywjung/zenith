'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

/**
 * 클립보드 복사 버튼 — 텍스트 복사 후 토스트 알림.
 * 짧은 시각 피드백(✓ 복사됨)도 제공.
 */
export default function CopyButton({
  value,
  label,
  successMessage,
  className = '',
  iconOnly = false,
  children,
}: {
  value: string
  /** 버튼 텍스트 (children보다 우선) */
  label?: string
  /** 토스트에 표시할 메시지. 없으면 기본 "복사되었습니다" */
  successMessage?: string
  className?: string
  iconOnly?: boolean
  children?: React.ReactNode
}) {
  const t = useTranslations()
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(successMessage || t('components_copybutton.copy_success'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('components_copybutton.copy_failed'))
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label || t('components_copybutton.copy_aria_label')}
      className={`inline-flex items-center gap-1 text-xs hover:text-blue-600 dark:hover:text-blue-400 transition-colors ${className}`}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
      {!iconOnly && (label || children)}
    </button>
  )
}
