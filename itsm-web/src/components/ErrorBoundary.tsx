'use client'

import React from 'react'
import { logger } from '@/lib/logger'

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
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 text-center p-8">
          <p className="text-red-500 font-medium">An error occurred while loading the page.</p>
          <p className="text-sm text-gray-400">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-sm text-blue-600 hover:underline"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
