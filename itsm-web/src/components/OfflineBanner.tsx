'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

/**
 * 네트워크 오프라인 감지 배너 + SSE 재연결 표시.
 * - navigator.onLine + online/offline 이벤트
 * - 'sse:reconnecting' / 'sse:connected' CustomEvent 청취
 */
export default function OfflineBanner() {
  const t = useTranslations('common.offline')
  const [offline, setOffline] = useState(false)
  const [sseReconnect, setSseReconnect] = useState<{ attempt: number } | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setOffline(!navigator.onLine)
    const onOffline = () => setOffline(true)
    const onOnline = () => setOffline(false)
    const onSseReconnect = (e: Event) => {
      const detail = (e as CustomEvent<{ attempt: number }>).detail
      setSseReconnect({ attempt: detail.attempt })
    }
    const onSseConnected = () => setSseReconnect(null)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('sse:reconnecting', onSseReconnect as EventListener)
    window.addEventListener('sse:connected', onSseConnected)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('sse:reconnecting', onSseReconnect as EventListener)
      window.removeEventListener('sse:connected', onSseConnected)
    }
  }, [])

  if (offline) {
    return (
      <div
        role="alert"
        className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-sm px-4 py-2 text-center shadow-lg flex items-center justify-center gap-2 print-hidden animate-fadeIn"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
        </svg>
        {t('banner')}
      </div>
    )
  }

  if (sseReconnect && sseReconnect.attempt >= 2) {
    return (
      <div
        role="status"
        className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-white text-sm px-4 py-2 text-center shadow-lg flex items-center justify-center gap-2 print-hidden animate-fadeIn"
      >
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        {t('sse_reconnecting', { attempt: sseReconnect.attempt })}
      </div>
    )
  }

  return null
}
