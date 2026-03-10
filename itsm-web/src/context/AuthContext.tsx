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
  role: string  // 'admin' | 'agent' | 'developer' | 'user'
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
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
    window.location.href = '/login'
  }

  const isDeveloper = user?.role === 'developer' || user?.role === 'agent' || user?.role === 'admin'
  const isAgent = user?.role === 'agent' || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, loading, logout, isDeveloper, isAgent, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
