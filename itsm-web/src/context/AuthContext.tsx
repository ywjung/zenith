'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost/api'

interface User {
  sub: string
  username: string
  name: string
  avatar_url?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
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

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
