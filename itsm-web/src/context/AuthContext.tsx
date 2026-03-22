'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { API_BASE } from '@/lib/constants'

interface User {
  sub: string
  username: string
  name: string
  email: string
  avatar_url?: string
  organization?: string
  role: string  // 'admin' | 'agent' | 'pl' | 'developer' | 'user'
}

interface AuthContextType {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  isDeveloper: boolean
  isAgent: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
  isDeveloper: false,
  isAgent: false,
  isAdmin: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (res.ok) return res.json()
        // 401 = unauthenticated (expected); other errors = network/server issue
        if (res.status !== 401) {
          console.warn('[Auth] /auth/me returned', res.status)
        }
        return null
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // 네트워크 오류가 있어도 클라이언트 측 로그아웃 진행
    }
    // L-5: 로그아웃 시 모든 클라이언트 스토리지 초기화
    sessionStorage.clear()
    localStorage.clear()
    setUser(null)
    window.location.href = '/login'
  }

  const isDeveloper = user?.role === 'developer' || user?.role === 'pl' || user?.role === 'agent' || user?.role === 'admin'
  const isAgent = user?.role === 'agent' || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, loading, logout, isDeveloper, isAgent, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
