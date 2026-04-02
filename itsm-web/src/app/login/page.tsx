'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:   'GitLab 로그인이 취소됐습니다.',
  csrf:            '보안 검증에 실패했습니다. 다시 시도해 주세요.',
  token_exchange:  '인증 처리 중 오류가 발생했습니다. 다시 시도해 주세요.',
  user_info:       '사용자 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  auth_failed:     '로그인에 실패했습니다. 다시 시도해 주세요.',
  exchange_failed: '로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.',
}

function LoginContent() {
  const params = useSearchParams()
  const router = useRouter()
  // AuthContext의 /api/auth/me 결과를 재사용 — 중복 호출 방지
  const { user, loading } = useAuth()

  const errorKey = params.get('error') ?? ''
  const errorMsg = ERROR_MESSAGES[errorKey] ?? (errorKey ? '인증 오류가 발생했습니다. 다시 시도해 주세요.' : null)

  // 이미 로그인된 경우 메인으로 이동
  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [user, loading, router])

  return (
    // fixed inset-0: Header/Footer/body 위를 완전히 덮는 full-screen 레이아웃
    <div className="fixed inset-0 z-[999] flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}
    >
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* Glow orbs */}
      <div className="absolute top-[30%] left-[20%] w-[500px] h-[400px] rounded-full opacity-10 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />
      <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[300px] rounded-full opacity-8 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }} />

      {/* Card */}
      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-yellow-400/60 border-t-yellow-400 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm">인증 확인 중...</p>
        </div>
      ) : (
        <div className="relative w-full max-w-sm mx-6">
          {/* Outer glow ring */}
          <div className="absolute -inset-px rounded-2xl opacity-40"
            style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.5), rgba(139,92,246,0.3), rgba(59,130,246,0.1))' }} />

          <div className="relative rounded-2xl overflow-hidden"
            style={{ background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Top accent bar */}
            <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, transparent, #3b82f6, #8b5cf6, transparent)' }} />

            <div className="p-8">
              {/* Logo */}
              <div className="flex flex-col items-center mb-8">
                <div className="w-18 h-18 mb-4 relative">
                  <div className="absolute inset-0 rounded-2xl opacity-30 blur-xl"
                    style={{ background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)' }} />
                  <div className="relative w-[72px] h-[72px] rounded-2xl flex items-center justify-center shadow-2xl"
                    style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)', boxShadow: '0 0 30px rgba(59,130,246,0.4)' }}
                  >
                    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-11 h-11">
                      <polygon
                        points="16,3 17.4,8 22.5,8 18.5,11.2 19.9,16.2 16,13 12.1,16.2 13.5,11.2 9.5,8 14.6,8"
                        fill="#FCD34D"
                      />
                      <path
                        d="M8 19H23.5L8 28H24"
                        stroke="white"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <h1 className="text-3xl font-bold tracking-[0.15em] text-white">ZENITH</h1>
                <p className="text-xs tracking-widest text-slate-400 mt-1.5 uppercase">IT Service Management</p>
              </div>

              {/* Error message */}
              {errorMsg && (
                <div className="flex items-start gap-2.5 mb-6 px-3.5 py-3 rounded-xl"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-sm text-red-300 leading-relaxed">{errorMsg}</p>
                </div>
              )}

              {/* Login button */}
              <a
                href={`${API_BASE}/auth/login`}
                className="flex items-center justify-center gap-2.5 w-full py-3 px-4 rounded-xl font-semibold text-sm text-white transition-all duration-150 active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, #FC6D26 0%, #E24329 100%)',
                  boxShadow: '0 4px 24px rgba(252,109,38,0.3)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 4px 32px rgba(252,109,38,0.5)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 4px 24px rgba(252,109,38,0.3)' }}
              >
                {/* GitLab fox logo */}
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24.507 9.5l-.034-.09L21.082.562a.896.896 0 00-1.694.091l-2.29 7.01H8.355L6.064.653a.898.898 0 00-1.694-.09L.451 9.411.416 9.5a6.297 6.297 0 002.09 7.277l.012.01.03.022 5.16 3.867 2.56 1.935 1.554 1.176a1.051 1.051 0 001.268 0l1.555-1.176 2.56-1.935 5.197-3.89.014-.01A6.297 6.297 0 0024.507 9.5z" fill="white"/>
                </svg>
                GitLab으로 로그인
              </a>

              <p className="text-center text-xs text-slate-500 mt-5 leading-relaxed">
                조직의 GitLab 계정으로 로그인합니다.<br />
                계정이 없으면 관리자에게 문의하세요.
              </p>

              {/* Portal link for users without GitLab account */}
              <div className="mt-4 pt-4 border-t border-white/5 text-center">
                <a
                  href="/portal"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 transition-colors duration-150"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  GitLab 계정 없이 IT 지원 요청하기
                </a>
              </div>
            </div>

            {/* Bottom security badge */}
            <div className="px-8 pb-5 flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-[10px] text-slate-600">OAuth 2.0 · httponly 쿠키 · CSRF 보호</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[999] flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
          <div className="w-10 h-10 border-2 border-yellow-400/60 border-t-yellow-400 rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
