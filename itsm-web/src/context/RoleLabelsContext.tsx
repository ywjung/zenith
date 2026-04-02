'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ROLE_LABELS } from '@/lib/constants'
import { API_BASE } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { useAuth } from './AuthContext'

export type RoleLabels = Record<string, string>

interface RoleLabelsContextValue {
  labels: RoleLabels
  refresh: () => void
}

const RoleLabelsContext = createContext<RoleLabelsContextValue>({
  labels: ROLE_LABELS,
  refresh: () => {},
})

export function RoleLabelsProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<RoleLabels>(ROLE_LABELS)
  const { user } = useAuth()

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/admin/role-labels`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data) setLabels({ ...ROLE_LABELS, ...data }) })
      .catch((err) => { logger.error('[RoleLabels] fetch failed', err) })
  }, [])

  // 사용자가 인증된 후에만 호출 — 미인증 시 403 콘솔 오류 방지
  useEffect(() => { if (user) refresh() }, [user, refresh])

  return (
    <RoleLabelsContext.Provider value={{ labels, refresh }}>
      {children}
    </RoleLabelsContext.Provider>
  )
}

export function useRoleLabels(): RoleLabels {
  return useContext(RoleLabelsContext).labels
}

export function useRoleLabelsContext() {
  return useContext(RoleLabelsContext)
}
