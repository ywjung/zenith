'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { API_BASE } from '@/lib/constants'

function LoginContent() {
  const params = useSearchParams()
  const error = params.get('error')

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 w-full max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
            <rect width="64" height="64" rx="16" fill="#1D4ED8"/>
            <polygon points="32,8 34.4,16.8 43.2,16.8 36.4,22 38.8,30.8 32,25.6 25.2,30.8 27.6,22 20.8,16.8 29.6,16.8" fill="#FCD34D"/>
            <path d="M18 37H46L18 52H47" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">ZENITH</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">IT 서비스 관리 플랫폼</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">GitLab 계정으로 로그인하세요</p>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 mb-4 text-sm">
            로그인에 실패했습니다. 다시 시도해주세요.
          </div>
        )}
        <a
          href={`${API_BASE}/auth/login`}
          className="block w-full bg-orange-600 text-white py-2.5 rounded-lg font-semibold hover:bg-orange-700 transition-colors"
        >
          GitLab으로 로그인
        </a>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
