'use client'

import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

const STORAGE_KEY = 'pwa-install-dismissed'

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => logger.warn('[SW] Registration failed:', err))
    }

    // Already dismissed or installed
    if (sessionStorage.getItem(STORAGE_KEY)) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
      setDeferredPrompt(null)
    }
  }

  function handleDismiss() {
    sessionStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Install app"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 sm:px-0"
    >
      <div className="flex items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 shadow-xl px-4 py-3">
        {/* App icon */}
        <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-700 flex items-center justify-center select-none" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-7 h-7">
            <polygon points="16,4 17.2,8.4 21.6,8.4 18.2,11 19.4,15.4 16,12.8 12.6,15.4 13.8,11 10.4,8.4 14.8,8.4" fill="#FCD34D"/>
            <path d="M9 18.5H22L9 26H23" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            ZENITH ITSM
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Add to home screen for quick access
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleInstall}
            className="rounded-md bg-blue-700 hover:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
