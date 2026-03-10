'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'
import { Suspense } from 'react'

function CallbackContent() {
  const params = useSearchParams()
  const router = useRouter()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    // params를 먼저 읽은 후 URL 정리 — replaceState가 useSearchParams()를 초기화할 수 있음
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    // URL에서 code/state 파라미터 제거 — 주소창 노출 방지
    window.history.replaceState({}, '', '/auth/callback')

    if (error || !code || !state) {
      router.replace('/login?error=access_denied')
      return
    }

    fetch(`${API_BASE}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, state }),
    })
      .then((res) => {
        if (res.ok) {
          // window.location으로 전체 새로고침 — AuthProvider가 재마운트되어 최신 쿠키 반영
          window.location.replace('/')
        } else {
          router.replace('/login?error=auth_failed')
        }
      })
      .catch(() => {
        router.replace('/login?error=auth_failed')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm font-medium">로그인 처리 중...</p>
        <p className="text-gray-400 text-xs mt-1">잠시만 기다려 주세요</p>
      </div>
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  )
}
