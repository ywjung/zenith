'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-4xl mb-3">⏳</div>
        <p>인증 확인 중...</p>
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}
