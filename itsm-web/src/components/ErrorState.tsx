'use client'

import SpinnerIcon from './SpinnerIcon'
import { useState } from 'react'

interface ErrorStateProps {
  message?: string
  onRetry?: () => void | Promise<void>
  compact?: boolean
  className?: string
}

/**
 * 데이터 로드 실패 시 표시하는 에러 상태 컴포넌트.
 * 재시도 버튼 + 친근한 메시지 + 다크모드 지원.
 *
 * 사용 예:
 *   {error ? <ErrorState message={error} onRetry={load} /> : ...}
 */
export default function ErrorState({
  message = '데이터를 불러오는 중 오류가 발생했습니다.',
  onRetry,
  compact = false,
  className = '',
}: ErrorStateProps) {
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    if (!onRetry) return
    setRetrying(true)
    try { await onRetry() } finally { setRetrying(false) }
  }

  const padding = compact ? 'py-6 px-4' : 'py-12 px-6'

  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center text-center ${padding} ${className}`}
    >
      <div className={`${compact ? 'text-3xl' : 'text-5xl'} mb-3 select-none`} aria-hidden="true">
        ⚠️
      </div>
      <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-gray-800 dark:text-gray-200 mb-1`}>
        문제가 발생했습니다
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mb-4">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {retrying && <SpinnerIcon className="w-3.5 h-3.5" />}
          {retrying ? '재시도 중...' : '🔄 다시 시도'}
        </button>
      )}
    </div>
  )
}
