'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { API_BASE } from '@/lib/constants'

function LoginContent() {
  const params = useSearchParams()
  const error = params.get('error')

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-white rounded-xl border shadow-sm p-8 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🛠️</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">ITSM 포털</h1>
        <p className="text-gray-500 text-sm mb-6">GitLab 계정으로 로그인하세요</p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 mb-4 text-sm">
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
