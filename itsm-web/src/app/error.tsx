'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

/**
 * Next.js App Router 전역 에러 바운더리.
 * 페이지 렌더링 중 처리되지 않은 예외 발생 시 표시.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('error_page')
  const tc = useTranslations('common')

  useEffect(() => {
    // 운영 환경에서는 에러 추적 시스템으로 전송
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <main role="alert" aria-labelledby="error-title" className="min-h-[60vh] flex items-center justify-center px-4 animate-fadeIn">
      <div className="max-w-md text-center">
        <div className="text-7xl mb-6 select-none" aria-hidden="true">⚠️</div>
        <span className="sr-only">{t('error_sr')}</span>
        <h1 id="error-title" className="text-2xl font-extrabold text-gray-900 dark:text-white mb-3">
          {t('error_heading')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          {t('error_body')}
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 dark:text-gray-600 mb-6 font-mono">
            {t('error_id', { id: error.digest })}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-semibold transition-all shadow-sm"
          >
            {tc('retry_again')}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 text-sm font-medium text-gray-700 dark:text-gray-300 transition-all"
          >
            {t('cta_home')}
          </Link>
        </div>
      </div>
    </main>
  )
}
