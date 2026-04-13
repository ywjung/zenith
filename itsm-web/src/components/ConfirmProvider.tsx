'use client'

import { createContext, useCallback, useContext, useState, ReactNode } from 'react'
import ConfirmDialog from './ConfirmDialog'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * 전역 async confirm 프로바이더.
 * window.confirm() 대체용. 다크모드/i18n/키보드 지원.
 *
 * 사용법:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: '삭제하시겠습니까?', variant: 'danger' })) {
 *     handleDelete()
 *   }
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve })
    })
  }, [])

  const handleConfirm = () => {
    state?.resolve(true)
    setState(null)
  }
  const handleCancel = () => {
    state?.resolve(false)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          open={true}
          title={state.title}
          message={state.message}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          variant={state.variant}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // 프로바이더 외부에서 호출 시 네이티브 confirm으로 폴백
    return async (opts) => window.confirm(`${opts.title}${opts.message ? `\n\n${opts.message}` : ''}`)
  }
  return ctx
}
