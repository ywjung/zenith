'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface Viewer {
  id: number
  name: string
}

interface UseTicketWSResult {
  viewers: Viewer[]
  typingUsers: string[]
  sendTyping: (isTyping: boolean) => void
}

/** Read a cookie value by name from document.cookie. */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null
}

/** Derive the WebSocket base URL from the current page origin.
 *  http://localhost/...  → ws://localhost/api/ws/...
 *  https://itsm.corp/... → wss://itsm.corp/api/ws/...
 */
function buildWsUrl(ticketIid: string | number): string | null {
  if (typeof window === 'undefined') return null
  const token = getCookie('itsm_token')
  if (!token) return null

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}/api/ws/tickets/${ticketIid}?token=${encodeURIComponent(token)}`
}

export function useTicketWS(ticketIid: string | number): UseTicketWSResult {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  // Stable reference so the effect does not re-run when the callback changes
  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', is_typing: isTyping }))
    }
  }, [])

  useEffect(() => {
    const url = buildWsUrl(ticketIid)
    if (!url) return

    const ws = new WebSocket(url)
    wsRef.current = ws

    // Heartbeat: send ping every 30 s to keep the connection alive through proxies
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30_000)

    ws.onmessage = (event: MessageEvent) => {
      let msg: { type: string; users?: Viewer[]; user?: string; is_typing?: boolean }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }

      if (msg.type === 'viewers' && Array.isArray(msg.users)) {
        setViewers(msg.users)
      } else if (msg.type === 'typing' && typeof msg.user === 'string') {
        const name = msg.user
        if (msg.is_typing) {
          setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]))
        } else {
          setTypingUsers((prev) => prev.filter((u) => u !== name))
        }
      }
      // 'pong' and unknown types are silently ignored
    }

    ws.onerror = () => {
      // Non-fatal: connection may be retried on next mount
    }

    ws.onclose = () => {
      setViewers([])
      setTypingUsers([])
    }

    return () => {
      clearInterval(pingTimer)
      ws.close()
      wsRef.current = null
    }
  }, [ticketIid])

  return { viewers, typingUsers, sendTyping }
}
