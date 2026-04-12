'use client'

import { toast } from 'sonner'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import RequireAuth from '@/components/RequireAuth'
import EmptyState from '@/components/EmptyState'
import { SkeletonRow } from '@/components/Skeleton'
import { listChanges, getChangeStats, transitionChange, type ChangeRequest } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import { formatDate, errorMessage } from '@/lib/utils'

const STATUS_KEYS = ['draft', 'submitted', 'reviewing', 'approved', 'rejected', 'implementing', 'implemented', 'failed', 'cancelled'] as const

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  reviewing: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  approved: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  implementing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  cancelled: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-600 dark:text-green-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  high: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
}

const TYPE_COLORS: Record<string, string> = {
  standard: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  normal: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  emergency: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

function ChangesContent() {
  const t = useTranslations('changes')
  const { user } = useAuth()
  const isAgent = user?.role === 'admin' || user?.role === 'agent'

  const statusLabel = (s: string) => t(`status_${s}` as 'status_draft')
  const typeLabel = (tp: string) => t(`type_${tp}` as 'type_standard')

  const [changes, setChanges] = useState<ChangeRequest[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [transitioning, setTransitioning] = useState<number | null>(null)
  const [commentModal, setCommentModal] = useState<{ id: number; status: string; label: string } | null>(null)
  const [commentInput, setCommentInput] = useState('')

  const COMMENT_REQUIRED = new Set(['approved', 'rejected', 'implemented', 'failed'])
  const actionLabel = (s: string) => {
    if (s === 'approved') return t('action_approved')
    if (s === 'rejected') return t('action_rejected')
    if (s === 'implemented') return t('action_implemented')
    if (s === 'failed') return t('action_failed')
    return t('action_default')
  }

  const PER_PAGE = 20

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [res, s] = await Promise.all([
        listChanges({ status: statusFilter || undefined, change_type: typeFilter || undefined, page, per_page: PER_PAGE }),
        isAgent ? getChangeStats() : Promise.resolve({}),
      ])
      setChanges(res.changes)
      setTotal(res.total)
      if (isAgent) setStats(s)
    } catch {
      /* empty list on error */
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter, page, isAgent])

  useEffect(() => { loadData() }, [loadData])

  const handleQuickTransition = (id: number, newStatus: string) => {
    if (COMMENT_REQUIRED.has(newStatus)) {
      setCommentModal({ id, status: newStatus, label: actionLabel(newStatus) })
      setCommentInput('')
      return
    }
    doTransition(id, newStatus)
  }

  const doTransition = async (id: number, newStatus: string, comment?: string) => {
    setTransitioning(id)
    try {
      await transitionChange(id, newStatus, comment)
      await loadData()
    } catch (e: unknown) {
      toast.error(errorMessage(e, t('loading_fail')))
    } finally {
      setTransitioning(null)
    }
  }

  const confirmCommentModal = async () => {
    if (!commentModal || !commentInput.trim()) return
    const { id, status } = commentModal
    setCommentModal(null)
    await doTransition(id, status, commentInput.trim())
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div>
        {commentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fadeIn backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4 animate-scaleIn">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                {statusLabel(commentModal.status)}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('comment_prompt', { label: commentModal.label })}</p>
              <textarea
                autoFocus
                value={commentInput}
                onChange={e => setCommentInput(e.target.value)}
                rows={3}
                placeholder={t('comment_placeholder', { label: commentModal.label })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setCommentModal(null)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={confirmCommentModal}
                  disabled={!commentInput.trim()}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40"
                >
                  {t('confirm')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
          </div>
          <Link
            href="/changes/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t('new')}
          </Link>
        </div>

        {isAgent && Object.keys(stats).length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">
            {STATUS_KEYS.map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1) }}
                className={`rounded-xl p-2 text-center cursor-pointer border transition-all ${
                  statusFilter === s
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-300'
                }`}
              >
                <div className="text-lg font-bold text-gray-900 dark:text-white">{stats[s] ?? 0}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{statusLabel(s)}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">{t('all_status')}</option>
            {STATUS_KEYS.map(v => (
              <option key={v} value={v}>{statusLabel(v)}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">{t('all_types')}</option>
            <option value="standard">{t('type_standard')}</option>
            <option value="normal">{t('type_normal')}</option>
            <option value="emergency">{t('type_emergency')}</option>
          </select>
          {(statusFilter || typeFilter) && (
            <button
              onClick={() => { setStatusFilter(''); setTypeFilter(''); setPage(1) }}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2"
            >
              {t('reset_filter')}
            </button>
          )}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          {loading ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {[1,2,3,4,5].map(i => <SkeletonRow key={i} cols={5} />)}
            </div>
          ) : changes.length === 0 ? (
            <EmptyState
              icon="🔄"
              title={t('empty_title')}
              description={t('empty_desc')}
              actionLabel={t('empty_cta')}
              actionHref="/changes/new"
            />
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {changes.map(cr => (
                <div key={cr.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cr.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {statusLabel(cr.status)}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[cr.change_type]}`}>
                          {typeLabel(cr.change_type)}
                        </span>
                        <span className={`text-xs font-medium ${RISK_COLORS[cr.risk_level] ?? ''}`}>
                          {t('risk_level', { level: cr.risk_level.toUpperCase() })}
                        </span>
                      </div>
                      <Link
                        href={`/changes/${cr.id}`}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 line-clamp-1"
                      >
                        #{cr.id} {cr.title}
                      </Link>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>{t('requester', { name: cr.requester_name ?? cr.requester_username })}</span>
                        {cr.scheduled_start_at && (
                          <span>{t('scheduled', { date: formatDate(cr.scheduled_start_at) })}</span>
                        )}
                        <span>{t('created', { date: formatDate(cr.created_at ?? '') })}</span>
                      </div>
                    </div>

                    {isAgent && (
                      <div className="flex gap-1 flex-shrink-0">
                        {cr.status === 'submitted' && (
                          <button
                            onClick={() => handleQuickTransition(cr.id, 'reviewing')}
                            disabled={transitioning === cr.id}
                            className="px-2 py-1 text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('start_review')}
                          </button>
                        )}
                        {cr.status === 'reviewing' && (
                          <>
                            <button
                              onClick={() => handleQuickTransition(cr.id, 'approved')}
                              disabled={transitioning === cr.id}
                              className="px-2 py-1 text-xs bg-teal-100 hover:bg-teal-200 text-teal-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t('approve')}
                            </button>
                            <button
                              onClick={() => handleQuickTransition(cr.id, 'rejected')}
                              disabled={transitioning === cr.id}
                              className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t('reject')}
                            </button>
                          </>
                        )}
                        {cr.status === 'approved' && (
                          <button
                            onClick={() => handleQuickTransition(cr.id, 'implementing')}
                            disabled={transitioning === cr.id}
                            className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('start_implementing')}
                          </button>
                        )}
                        {cr.status === 'implementing' && (
                          <>
                            <button
                              onClick={() => handleQuickTransition(cr.id, 'implemented')}
                              disabled={transitioning === cr.id}
                              className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t('mark_done')}
                            </button>
                            <button
                              onClick={() => handleQuickTransition(cr.id, 'failed')}
                              disabled={transitioning === cr.id}
                              className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t('mark_failed')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('prev_page')}
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('next_page')}
            </button>
          </div>
        )}
    </div>
  )
}

export default function ChangesPage() {
  return (
    <RequireAuth>
      <ChangesContent />
    </RequireAuth>
  )
}
