'use client'

import React from 'react'
import { logger } from '@/lib/logger'
import { API_BASE } from '@/lib/constants'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('[ErrorBoundary]', error, info.componentStack)
    // fire-and-forget: 서버 로그에 클라이언트 예외를 수집 (추적 가능하도록).
    try {
      const body = JSON.stringify({
        message: error.message,
        stack: error.stack?.slice(0, 2000),
        component_stack: info.componentStack?.slice(0, 2000),
        path: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      })
      fetch(`${API_BASE}/client-errors`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body, keepalive: true,
      }).catch(() => {})
    } catch { /* ignore */ }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 text-center p-8">
          <p className="text-red-500 font-medium">페이지를 불러오는 중 오류가 발생했습니다.</p>
          <p className="text-sm text-gray-400 max-w-md break-words">{this.state.error?.message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              다시 시도
            </button>
            <button
              onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
