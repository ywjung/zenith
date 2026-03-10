'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api'
import type { NotificationItem } from '@/types'
import { API_BASE } from '@/lib/constants'

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadNotifications = async () => {
    setLoading(true)
    try {
      const data = await fetchNotifications(20)
      setNotifications(data.notifications)
      setUnreadCount(data.unread_count)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()

    // SSE for real-time notifications
    let eventSource: EventSource | null = null
    try {
      eventSource = new EventSource(`${API_BASE}/notifications/stream`, { withCredentials: true })
      eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data) as NotificationItem
          setNotifications((prev) => [{ ...payload, is_read: false }, ...prev.slice(0, 19)])
          setUnreadCount((c) => c + 1)
        } catch {
          // ignore parse errors
        }
      }
      eventSource.onerror = () => {
        eventSource?.close()
      }
    } catch {
      // SSE not supported or error
    }

    return () => {
      eventSource?.close()
    }
  }, [])

  // Close dropdown on outside click
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
    await markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return '방금'
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
    return d.toLocaleDateString('ko-KR')
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 rounded-md hover:bg-blue-600 transition-colors"
        aria-label="알림"
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <span className="font-semibold text-gray-800 text-sm">알림</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 hover:underline"
              >
                모두 읽음
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-gray-400 text-sm">불러오는 중...</div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">알림이 없습니다.</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b last:border-b-0 hover:bg-gray-50 transition-colors ${
                    !n.is_read ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {n.link ? (
                        <Link
                          href={n.link}
                          className="font-medium text-gray-900 text-sm truncate block hover:text-blue-600"
                          onClick={() => {
                            if (!n.is_read) handleMarkRead(n.id)
                            setOpen(false)
                          }}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        <p className="font-medium text-gray-900 text-sm truncate">{n.title}</p>
                      )}
                      {n.body && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">{formatTime(n.created_at)}</p>
                    </div>
                    {!n.is_read && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1.5"
                        title="읽음 처리"
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 구독·알림 설정 링크 */}
          <div className="border-t px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2">
            <Link
              href="/notifications"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
              onClick={() => setOpen(false)}
            >
              <span>🔔</span>
              <span>구독 중인 티켓</span>
            </Link>
            <Link
              href="/notifications?tab=prefs"
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 transition-colors"
              onClick={() => setOpen(false)}
            >
              <span>⚙️</span>
              <span>알림 설정</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
