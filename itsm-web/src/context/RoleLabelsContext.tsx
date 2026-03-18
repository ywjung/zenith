'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ROLE_LABELS } from '@/lib/constants'
import { API_BASE } from '@/lib/constants'

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

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/admin/role-labels`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data) setLabels({ ...ROLE_LABELS, ...data }) })
      .catch((err) => { console.error('[RoleLabels] fetch failed', err) })
  }, [])

  useEffect(() => { refresh() }, [refresh])

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
