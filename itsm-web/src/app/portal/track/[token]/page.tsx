'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { API_BASE, STATUS_INFO } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false })

interface PortalComment {
  id: number
  body: string
  author_name: string
  created_at: string
}

interface TicketStatus {
  ticket_iid: number
  title: string
  status: string
  priority: string | null
  category: string | null
  created_at: string
  updated_at: string | null
  sla_deadline: string | null
  sla_breached: boolean
  comments: PortalComment[]
  expires_at: string | null
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-700 bg-red-50 border-red-200',
  high: 'text-orange-700 bg-orange-50 border-orange-200',
  medium: 'text-blue-700 bg-blue-50 border-blue-200',
  low: 'text-gray-600 bg-gray-50 border-gray-200',
}

function SLABadge({ deadline, breached }: { deadline: string | null; breached: boolean }) {
  const t = useTranslations('portal_track')
  if (!deadline) return null
  const dl = new Date(deadline)
  const now = new Date()
  const diffMs = dl.getTime() - now.getTime()
  const diffH = diffMs / 3600000

  let color = 'text-green-700 bg-green-50 border-green-200'
  let label = t('deadline', { date: dl.toLocaleDateString() })
  if (breached || diffH < 0) {
    color = 'text-red-700 bg-red-50 border-red-200'
    label = t('sla_exceeded')
  } else if (diffH < 24) {
    color = 'text-orange-700 bg-orange-50 border-orange-200'
    label = t('deadline_soon', { hours: Math.round(diffH) })
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full border ${color}`}>
      ⏱ {label}
    </span>
  )
}

export default function TrackPage() {
  const t = useTranslations('portal_track')
  const params = useParams()
  const token = params?.token as string

  const [ticket, setTicket] = useState<TicketStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extending, setExtending] = useState(false)
  const [extendMsg, setExtendMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/portal/track/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || t('load_error'))
        }
        return res.json()
      })
      .then(setTicket)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  async function handleExtend() {
    setExtending(true)
    setExtendMsg(null)
    try {
      const res = await fetch(`${API_BASE}/portal/extend/${token}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || t('extend_failed'))
      setExtendMsg(t('extend_success', { date: new Date(data.expires_at).toLocaleDateString() }))
      if (ticket) setTicket({ ...ticket, expires_at: data.expires_at })
    } catch (e: unknown) {
      setExtendMsg(errorMessage(e, t('extend_failed')))
    } finally {
      setExtending(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">⏳</div>
        <p>{t('loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">{t('not_found')}</h1>
        <p className="text-gray-500 text-sm mb-6">{error}</p>
        <Link href="/portal" className="text-blue-600 text-sm hover:underline">
          {t('new_request')}
        </Link>
      </div>
    )
  }

  if (!ticket) return null

  const statusInfo = STATUS_INFO[ticket.status] ?? {
    label: ticket.status,
    color: 'text-gray-600 bg-gray-50 border-gray-200',
    icon: '📋',
  }

  const priorityInfo = ticket.priority ? { label: t(`prio_${ticket.priority}` as 'prio_critical'), color: PRIORITY_COLORS[ticket.priority] } : null
  const isClosed = ticket.status === 'resolved' || ticket.status === 'closed'

  // 토큰 만료까지 3일 이하이면 연장 버튼 표시
  const expiresAt = ticket.expires_at ? new Date(ticket.expires_at) : null
  const showExtend = expiresAt && (expiresAt.getTime() - Date.now()) < 3 * 24 * 3600 * 1000

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-5">
      <div>
        <Link href="/portal" className="text-sm text-blue-600 hover:underline">
          {t('back_new')}
        </Link>
      </div>

      {/* 헤더 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-400 mb-1">{t('ticket_id', { iid: ticket.ticket_iid })}</div>
            <h1 className="text-lg font-semibold text-gray-900 leading-snug">{ticket.title}</h1>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full border ${statusInfo.color}`}
          >
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>

        {/* 메타 정보 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {priorityInfo && (
            <span className={`inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full border ${priorityInfo.color}`}>
              {priorityInfo.label}
            </span>
          )}
          {ticket.category && (
            <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full border text-gray-600 bg-gray-50 border-gray-200">
              {t(`cat_${ticket.category}` as 'cat_hardware') !== `cat_${ticket.category}` ? t(`cat_${ticket.category}` as 'cat_hardware') : ticket.category}
            </span>
          )}
          <SLABadge deadline={ticket.sla_deadline} breached={ticket.sla_breached} />
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-2 text-sm text-gray-500">
          <div className="flex justify-between">
            <span>{t('submitted')}</span>
            <span className="text-gray-700">{new Date(ticket.created_at).toLocaleString()}</span>
          </div>
          {ticket.updated_at && (
            <div className="flex justify-between">
              <span>{t('updated')}</span>
              <span className="text-gray-700">{new Date(ticket.updated_at).toLocaleString()}</span>
            </div>
          )}
          {expiresAt && (
            <div className="flex justify-between items-center">
              <span>{t('link_expires')}</span>
              <span className="text-gray-700">{expiresAt.toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {isClosed && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            {t('completed')}
          </div>
        )}
      </div>

      {/* 담당자 댓글 */}
      {ticket.comments.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{t('comments_title', { n: ticket.comments.length })}</h2>
          <div className="space-y-4">
            {ticket.comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {c.author_name[0]?.toUpperCase() ?? 'A'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800">{c.author_name}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-700"><MarkdownRenderer content={c.body} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 토큰 연장 */}
      {showExtend && !isClosed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="text-sm text-amber-800">
            <p className="font-medium">{t('link_expiring_title')}</p>
            <p className="text-xs mt-0.5 text-amber-700">{t('link_expiring_body')}</p>
          </div>
          <button
            onClick={handleExtend}
            disabled={extending}
            className="shrink-0 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {extending ? t('extending') : t('extend')}
          </button>
        </div>
      )}
      {extendMsg && (
        <div className="text-sm text-center text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
          {extendMsg}
        </div>
      )}
    </div>
  )
}
