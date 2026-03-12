'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { fetchServiceTypes } from '@/lib/api'
import type { ServiceType } from '@/types'

interface ServiceTypesCtx {
  serviceTypes: ServiceType[]
  reload: () => void
  getLabel: (value: string) => string
  getEmoji: (value: string) => string
}

const defaultCtx: ServiceTypesCtx = {
  serviceTypes: [],
  reload: () => {},
  getLabel: (v) => v,
  getEmoji: () => '📋',
}

const ServiceTypesContext = createContext<ServiceTypesCtx>(defaultCtx)

// Fallback labels for when API is not yet loaded
const FALLBACK: Record<string, { label: string; emoji: string }> = {
  hardware: { label: '하드웨어',   emoji: '🖥️' },
  software: { label: '소프트웨어', emoji: '💻' },
  network:  { label: '네트워크',   emoji: '🌐' },
  account:  { label: '계정/권한',  emoji: '👤' },
  other:    { label: '기타',       emoji: '📋' },
}

export function ServiceTypesProvider({ children }: { children: React.ReactNode }) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])

  const load = useCallback(() => {
    fetchServiceTypes()
      .then(setServiceTypes)
      .catch(() => {/* not authenticated yet, context stays empty */})
  }, [])

  useEffect(() => { load() }, [load])

  // value 또는 label 모두로 조회 (KB 아티클이 한국어 레이블을 저장한 경우 호환)
  const getLabel = (value: string) => {
    const found = serviceTypes.find(t => t.value === value || t.label === value)
    if (found) return found.label
    return FALLBACK[value]?.label ?? value
  }

  const getEmoji = (value: string) => {
    const found = serviceTypes.find(t => t.value === value || t.label === value)
    if (found) return found.emoji
    return FALLBACK[value]?.emoji ?? '📋'
  }

  return (
    <ServiceTypesContext.Provider value={{ serviceTypes, reload: load, getLabel, getEmoji }}>
      {children}
    </ServiceTypesContext.Provider>
  )
}

export function useServiceTypes() {
  return useContext(ServiceTypesContext)
}
