'use client'

import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useConfirm } from '@/components/ConfirmProvider'
import { API_BASE } from '@/lib/constants'
import { logger } from '@/lib/logger'

interface FailedNotificationItem {
  id: number
  task_name: string
  task_id: string | null
  payload: Record<string, unknown> | null
  error_message: string | null
  retry_count: number
  resolved: boolean
  created_at: string | null
}

interface ListResponse {
  total: number
  skip: number
  limit: number
  items: FailedNotificationItem[]
}

export default function FailedNotificationsPage() {
  const t = useTranslations('admin.failed_notifications')
  const confirm = useConfirm()
  const [data, setData] = useState<ListResponse | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const LIMIT = 50

  async function fetchData(resolved: boolean, skip: number) {
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/admin/failed-notifications?resolved=${resolved}&skip=${skip}&limit=${LIMIT}`,
        { credentials: 'include' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ListResponse = await res.json()
      setData(json)
    } catch (err) {
      logger.error('Failed to load failed notifications:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(0)
    fetchData(showResolved, 0)
  }, [showResolved])

  function handlePageChange(newPage: number) {
    setPage(newPage)
    fetchData(showResolved, newPage * LIMIT)
  }

  async function handleResolve(id: number) {
    setActionLoading(id)
    try {
      const res = await fetch(`${API_BASE}/admin/failed-notifications/${id}/resolve`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchData(showResolved, page * LIMIT)
    } catch (err) {
      logger.error('Resolve failed:', err)
      toast.error(t('resolve_error'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete(id: number) {
    if (!(await confirm({ title: t('delete_confirm_title'), variant: 'danger', confirmLabel: t('delete_confirm_ok') }))) return
    setActionLoading(id)
    try {
      const res = await fetch(`${API_BASE}/admin/failed-notifications/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchData(showResolved, page * LIMIT)
    } catch (err) {
      logger.error('Delete failed:', err)
      toast.error(t('delete_error'))
    } finally {
      setActionLoading(null)
    }
  }

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span>⚠️</span>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={() => fetchData(showResolved, page * LIMIT)}
          disabled={loading}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? t('loading') : t('refresh')}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setShowResolved(false)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !showResolved
              ? 'bg-red-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('tab_open')}
          {data && !showResolved && (
            <span className="ml-1.5 bg-white/20 text-white rounded-full px-1.5 py-0.5 text-xs">
              {data.total}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowResolved(true)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            showResolved
              ? 'bg-gray-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {t('tab_resolved')}
          {data && showResolved && (
            <span className="ml-1.5 bg-white/20 text-white rounded-full px-1.5 py-0.5 text-xs">
              {data.total}
            </span>
          )}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading_items')}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {showResolved ? t('empty_resolved') : t('empty_open')}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.items.map(item => (
              <div key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {item.task_name}
                      </span>
                      <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded">
                        {t('retry_count', { n: item.retry_count })}
                      </span>
                      {item.resolved && (
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">
                          {t('resolved_badge')}
                        </span>
                      )}
                    </div>
                    {item.task_id && (
                      <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
                        {t('task_id_label', { id: item.task_id })}
                      </p>
                    )}
                    {item.error_message && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2">
                        {item.error_message}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString()
                        : '-'}
                    </p>

                    {item.payload && (
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="text-xs text-blue-500 hover:text-blue-700 mt-1"
                      >
                        {expandedId === item.id ? t('payload_close') : t('payload_open')}
                      </button>
                    )}
                    {expandedId === item.id && item.payload && (
                      <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 overflow-x-auto text-gray-700 dark:text-gray-300 max-h-48">
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!item.resolved && (
                      <button
                        onClick={() => handleResolve(item.id)}
                        disabled={actionLoading === item.id}
                        className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        {actionLoading === item.id ? t('processing') : t('mark_resolved')}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={actionLoading === item.id}
                      className="text-xs bg-gray-200 hover:bg-red-100 hover:text-red-700 dark:bg-gray-700 dark:hover:bg-red-900/30 dark:hover:text-red-400 disabled:opacity-60 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('prev_page')}
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('next_page')}
          </button>
        </div>
      )}
    </div>
  )
}
