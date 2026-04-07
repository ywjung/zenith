'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api'
import type { NotificationItem } from '@/types'
import { API_BASE } from '@/lib/constants'

export default function NotificationBell() {
  const t = useTranslations('notifications')
  const tc = useTranslations('common')
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  const loadNotifications = async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const data = await fetchNotifications(20)
      if (signal?.aborted) return
      setNotifications(data.notifications)
      setUnreadCount(data.unread_count)
    } catch {
      // silently ignore
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  const connectSSE = useCallback((signal: AbortSignal) => {
    if (signal.aborted) return
    try {
      const es = new EventSource(`${API_BASE}/notifications/stream`, { withCredentials: true })
      eventSourceRef.current = es

      es.onopen = () => {
        reconnectAttemptsRef.current = 0
      }

      es.onmessage = (e) => {
        if (signal.aborted) return
        reconnectAttemptsRef.current = 0
        try {
          const payload = JSON.parse(e.data) as NotificationItem
          setNotifications((prev) => [{ ...payload, is_read: false }, ...prev.slice(0, 19)])
          setUnreadCount((c) => c + 1)
        } catch {
          // ignore parse errors
        }
      }

      es.onerror = () => {
        es.close()
        eventSourceRef.current = null
        if (signal.aborted) return
        reconnectAttemptsRef.current++
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000)
        reconnectRef.current = setTimeout(() => { if (!signal.aborted) connectSSE(signal) }, delay)
      }
    } catch {
      // SSE not supported or error
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadNotifications(controller.signal)
    connectSSE(controller.signal)

    return () => {
      controller.abort()
      if (reconnectRef.current !== null) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [connectSSE])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleMarkRead = async (id: number) => {
    try {
      await markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch {
      // silently ignore — UI state remains unchanged
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {
      // silently ignore
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return t('just_now')
    if (diff < 3600) return t('minutes_ago', { n: Math.floor(diff / 60) })
    if (diff < 86400) return t('hours_ago', { n: Math.floor(diff / 3600) })
    return d.toLocaleDateString()
  }

  return (
    <div className="relative" ref={dropdownRef} data-tour="notification-bell">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 rounded-md hover:bg-blue-600 transition-colors"
        aria-label={t('title')}
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{t('title')}</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t('mark_all_read_btn')}
              </button>
            )}
          </div>

          {/* 목록 */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{tc('loading')}</div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{t('empty')}</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 transition-colors ${
                    !n.is_read
                      ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {n.link ? (
                        <Link
                          href={n.link}
                          className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate block hover:text-blue-600 dark:hover:text-blue-400"
                          onClick={() => {
                            if (!n.is_read) handleMarkRead(n.id)
                            setOpen(false)
                          }}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{n.title}</p>
                      )}
                      {n.body && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatTime(n.created_at)}</p>
                    </div>
                    {!n.is_read && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1.5"
                        title={t('mark_read_title')}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 푸터 링크 */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 flex items-center justify-between gap-2">
            <Link
              href="/notifications"
              className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              onClick={() => setOpen(false)}
            >
              <span>🔔</span>
              <span>{t('subscribed_tickets_link')}</span>
            </Link>
            <Link
              href="/notifications?tab=prefs"
              className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              onClick={() => setOpen(false)}
            >
              <span>⚙️</span>
              <span>{t('settings_link')}</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
