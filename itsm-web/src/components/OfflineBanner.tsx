'use client'

import { useEffect, useState } from 'react'

/**
 * 네트워크 오프라인 감지 배너.
 * navigator.onLine + online/offline 이벤트로 실시간 감지하여
 * 화면 상단에 빨간 배너를 표시한다.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setOffline(!navigator.onLine)
    const onOffline = () => setOffline(true)
    const onOnline = () => setOffline(false)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-sm px-4 py-2 text-center shadow-lg flex items-center justify-center gap-2 print-hidden"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
      </svg>
      네트워크 연결이 끊겼습니다. 일부 기능이 동작하지 않을 수 있습니다.
    </div>
  )
}
