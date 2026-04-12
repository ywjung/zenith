'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'
import { adminFetch } from '@/lib/adminFetch'
import { errorMessage } from '@/lib/utils'

interface PreviewData {
  old_audit_logs: number
  orphan_notifications: number
  old_kb_revisions: number
  policy: {
    audit_log_retention_days: number
    notification_retention_days: number
    kb_revision_keep_count: number
  }
}

interface CleanupResult {
  deleted: number
  duration_ms: number
}

interface HistoryEntry {
  timestamp: string
  label: string
  deleted?: number
  duration_ms: number
  error?: string
}


function formatNumber(n: number) {
  return n.toLocaleString()
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface ConfirmModal {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
}

export default function DbCleanupPage() {
  const t = useTranslations('admin.db_cleanup')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [vacuumRunning, setVacuumRunning] = useState(false)

  const [history, setHistory] = useState<HistoryEntry[]>([])

  const [modal, setModal] = useState<ConfirmModal>({
    open: false,
    title: '',
    description: '',
    onConfirm: () => {},
  })

  async function loadPreview() {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const data = await adminFetch<PreviewData>('/admin/db-cleanup/preview')
      setPreview(data)
    } catch (e: unknown) {
      setPreviewError(errorMessage(e, t('load_failed')))
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    loadPreview()
  }, [])

  function openConfirm(title: string, description: string, onConfirm: () => void) {
    setModal({ open: true, title, description, onConfirm })
  }

  function closeModal() {
    setModal(prev => ({ ...prev, open: false }))
  }

  async function runCleanup(key: string, endpoint: string, label: string) {
    setRunningKey(key)
    const started = Date.now()
    try {
      const result = await adminFetch<CleanupResult>(`/admin/db-cleanup/${endpoint}`, { method: 'POST' })
      setHistory(prev => [
        {
          timestamp: new Date().toISOString(),
          label,
          deleted: result.deleted,
          duration_ms: result.duration_ms,
        },
        ...prev,
      ])
      await loadPreview()
    } catch (e: unknown) {
      setHistory(prev => [
        {
          timestamp: new Date().toISOString(),
          label,
          duration_ms: Date.now() - started,
          error: errorMessage(e, t('run_failed')),
        },
        ...prev,
      ])
    } finally {
      setRunningKey(null)
    }
  }

  async function runVacuum() {
    setVacuumRunning(true)
    const started = Date.now()
    try {
      const result = await adminFetch<{ duration_ms: number }>('/admin/db-cleanup/vacuum', { method: 'POST' })
      setHistory(prev => [
        {
          timestamp: new Date().toISOString(),
          label: 'VACUUM ANALYZE',
          duration_ms: result.duration_ms,
        },
        ...prev,
      ])
    } catch (e: unknown) {
      setHistory(prev => [
        {
          timestamp: new Date().toISOString(),
          label: 'VACUUM ANALYZE',
          duration_ms: Date.now() - started,
          error: errorMessage(e, t('run_failed')),
        },
        ...prev,
      ])
    } finally {
      setVacuumRunning(false)
    }
  }

  const cleanupTasks = preview
    ? [
        {
          key: 'audit-logs',
          endpoint: 'audit-logs',
          label: t('task_audit_label'),
          desc: t('task_audit_desc', { days: preview.policy.audit_log_retention_days }),
          count: preview.old_audit_logs,
          countLabel: t('audit_label', { days: preview.policy.audit_log_retention_days }),
          icon: '🔍',
          confirmDesc: t('task_audit_confirm', { days: preview.policy.audit_log_retention_days, n: formatNumber(preview.old_audit_logs) }),
        },
        {
          key: 'notifications',
          endpoint: 'notifications',
          label: t('task_notif_label'),
          desc: t('task_notif_desc', { days: preview.policy.notification_retention_days }),
          count: preview.orphan_notifications,
          countLabel: t('notif_label', { days: preview.policy.notification_retention_days }),
          icon: '🔔',
          confirmDesc: t('task_notif_confirm', { days: preview.policy.notification_retention_days, n: formatNumber(preview.orphan_notifications) }),
        },
        {
          key: 'kb-revisions',
          endpoint: 'kb-revisions',
          label: t('task_kb_label'),
          desc: t('task_kb_desc', { n: preview.policy.kb_revision_keep_count }),
          count: preview.old_kb_revisions,
          countLabel: t('kb_label', { n: preview.policy.kb_revision_keep_count }),
          icon: '📚',
          confirmDesc: t('task_kb_confirm', { n: preview.policy.kb_revision_keep_count, count: formatNumber(preview.old_kb_revisions) }),
        },
      ]
    : []

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={loadPreview}
          disabled={previewLoading}
          className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t('refresh')}
        </button>
      </div>

      {/* 오류 */}
      {previewError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
          {t('preview_error_prefix', { msg: previewError })}
        </div>
      )}

      {/* 미리보기 섹션 */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{t('preview_title')}</h3>
        {previewLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-1" />
                <div className="h-7 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : preview ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                {t('audit_label', { days: preview.policy.audit_log_retention_days })}
              </div>
              <div className={`text-2xl font-bold ${preview.old_audit_logs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {t('count_suffix', { n: formatNumber(preview.old_audit_logs) })}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                {t('notif_label', { days: preview.policy.notification_retention_days })}
              </div>
              <div className={`text-2xl font-bold ${preview.orphan_notifications > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {t('count_suffix', { n: formatNumber(preview.orphan_notifications) })}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                {t('kb_label', { n: preview.policy.kb_revision_keep_count })}
              </div>
              <div className={`text-2xl font-bold ${preview.old_kb_revisions > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {t('count_suffix', { n: formatNumber(preview.old_kb_revisions) })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 정리 작업 카드 */}
      <div className="space-y-3">
        {previewLoading
          ? [1, 2, 3].map(i => (
              <div
                key={i}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 animate-pulse"
              >
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
              </div>
            ))
          : cleanupTasks.map(task => (
              <div
                key={task.key}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="text-xl shrink-0 mt-0.5">{task.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                          {task.label}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            task.count > 0
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {task.countLabel}: {t('count_suffix', { n: formatNumber(task.count) })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{task.desc}</p>
                    </div>
                  </div>
                  <button
                    disabled={runningKey !== null || task.count === 0}
                    onClick={() =>
                      openConfirm(task.label, task.confirmDesc, () =>
                        runCleanup(task.key, task.endpoint, task.label)
                      )
                    }
                    className={`shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      task.count === 0
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        : runningKey === task.key
                          ? 'bg-red-400 text-white cursor-wait'
                          : 'bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    {runningKey === task.key ? t('running') : t('run')}
                  </button>
                </div>
              </div>
            ))}
      </div>

      {/* VACUUM ANALYZE 카드 */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">🛠️</span>
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{t('vacuum_title')}</div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t('vacuum_desc')}
              </p>
            </div>
          </div>
          <button
            disabled={vacuumRunning || runningKey !== null}
            onClick={() =>
              openConfirm(
                t('vacuum_confirm_title'),
                t('vacuum_confirm_desc'),
                runVacuum
              )
            }
            className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white transition-colors"
          >
            {vacuumRunning ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {t('running')}
              </span>
            ) : (
              t('vacuum_run')
            )}
          </button>
        </div>
      </div>

      {/* 실행 이력 */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{t('history_title')}</h3>
          <div className="space-y-2">
            {history.map((entry, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 text-sm px-3 py-2 rounded-lg ${
                  entry.error
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className="shrink-0">{entry.error ? '❌' : '✅'}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="font-medium shrink-0">{entry.label}</span>
                {entry.error ? (
                  <span className="text-red-600 dark:text-red-400 text-xs truncate">{entry.error}</span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400 text-xs">
                    {entry.deleted !== undefined
                      ? t('deleted_count', { n: formatNumber(entry.deleted) })
                      : t('completed')}{' '}
                    ({formatDuration(entry.duration_ms)})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 확인 모달 */}
      {modal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fadeIn backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4 animate-scaleIn">
            <div>
              <h3
                id="confirm-modal-title"
                className="text-base font-bold text-gray-900 dark:text-gray-100"
              >
                {modal.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{modal.description}</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-2 font-medium">
                {t('irreversible')}
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => {
                  closeModal()
                  modal.onConfirm()
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                {t('confirm_delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
