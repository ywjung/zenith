'use client'

import { useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'

function CallbackContent() {
  const params = useSearchParams()
  const router = useRouter()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    // GitLab OAuth 처리 ─────────────────────────────────

    // URL에서 code/state 제거 — 주소창 노출 방지 (보안)
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
      .then(res => {
        if (res.ok) {
          // window.location으로 전체 새로고침 — AuthProvider 재마운트로 최신 쿠키 반영
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
    <div className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}
    >
      <div className="flex flex-col items-center gap-5">
        {/* ZENITH logo */}
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)', boxShadow: '0 0 30px rgba(59,130,246,0.4)' }}
        >
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
            <polygon
              points="16,3 17.4,8 22.5,8 18.5,11.2 19.9,16.2 16,13 12.1,16.2 13.5,11.2 9.5,8 14.6,8"
              fill="#FCD34D"
            />
            <path d="M8 19H23.5L8 28H24" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Spinner */}
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-slate-700" />
          <div className="absolute inset-0 rounded-full border-2 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        </div>

        <div className="text-center">
          <p className="text-white text-sm font-medium">로그인 처리 중</p>
          <p className="text-slate-500 text-xs mt-1">잠시만 기다려 주세요...</p>
        </div>
      </div>
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[999] flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  )
}
