'use client'

import { useEffect, useState } from 'react'
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
  return n.toLocaleString('ko-KR')
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
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
      setPreviewError(errorMessage(e, '불러오기 실패'))
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
          error: errorMessage(e, '실행 실패'),
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
          error: errorMessage(e, '실행 실패'),
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
          label: '감사 로그 정리',
          desc: `${preview.policy.audit_log_retention_days}일 이상 경과한 감사 로그를 삭제합니다.`,
          count: preview.old_audit_logs,
          countLabel: `감사 로그 (${preview.policy.audit_log_retention_days}일+)`,
          icon: '🔍',
          confirmDesc: `${preview.policy.audit_log_retention_days}일 이상된 감사 로그 ${formatNumber(preview.old_audit_logs)}건을 영구 삭제합니다.`,
        },
        {
          key: 'notifications',
          endpoint: 'notifications',
          label: '읽은 알림 정리',
          desc: `읽음 처리된 알림 중 ${preview.policy.notification_retention_days}일 이상된 항목을 삭제합니다.`,
          count: preview.orphan_notifications,
          countLabel: `읽은 알림 (${preview.policy.notification_retention_days}일+)`,
          icon: '🔔',
          confirmDesc: `${preview.policy.notification_retention_days}일 이상된 읽음 알림 ${formatNumber(preview.orphan_notifications)}건을 영구 삭제합니다.`,
        },
        {
          key: 'kb-revisions',
          endpoint: 'kb-revisions',
          label: 'KB 구버전 정리',
          desc: `KB 문서당 최신 ${preview.policy.kb_revision_keep_count}개 버전만 유지하고 나머지를 삭제합니다.`,
          count: preview.old_kb_revisions,
          countLabel: `초과 KB 버전 (최신 ${preview.policy.kb_revision_keep_count}개 초과)`,
          icon: '📚',
          confirmDesc: `KB 문서당 최신 ${preview.policy.kb_revision_keep_count}개 이외의 구버전 ${formatNumber(preview.old_kb_revisions)}건을 영구 삭제합니다.`,
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
            DB 정리 자동화
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            오래된 로그·알림·KB 버전을 선택적으로 정리하고 DB를 최적화합니다.
          </p>
        </div>
        <button
          onClick={loadPreview}
          disabled={previewLoading}
          className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          🔄 새로고침
        </button>
      </div>

      {/* 오류 */}
      {previewError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
          미리보기 불러오기 실패: {previewError}
        </div>
      )}

      {/* 미리보기 섹션 */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">정리 대상 현황</h3>
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
                감사 로그 ({preview.policy.audit_log_retention_days}일+)
              </div>
              <div className={`text-2xl font-bold ${preview.old_audit_logs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {formatNumber(preview.old_audit_logs)}건
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                읽은 알림 ({preview.policy.notification_retention_days}일+)
              </div>
              <div className={`text-2xl font-bold ${preview.orphan_notifications > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {formatNumber(preview.orphan_notifications)}건
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                초과 KB 버전 (최신 {preview.policy.kb_revision_keep_count}개 초과)
              </div>
              <div className={`text-2xl font-bold ${preview.old_kb_revisions > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {formatNumber(preview.old_kb_revisions)}건
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
                          {task.countLabel}: {formatNumber(task.count)}건
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
                    {runningKey === task.key ? '실행 중…' : '실행'}
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
              <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">DB 최적화 (VACUUM ANALYZE)</div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                테이블 통계를 갱신하고 불필요한 페이지를 회수합니다. 정리 작업 후 실행하면 효과적입니다.
              </p>
            </div>
          </div>
          <button
            disabled={vacuumRunning || runningKey !== null}
            onClick={() =>
              openConfirm(
                'VACUUM ANALYZE 실행',
                'PostgreSQL VACUUM ANALYZE를 실행합니다. 완료까지 수 초~수 분이 소요될 수 있습니다.',
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
                실행 중…
              </span>
            ) : (
              'DB 최적화 실행'
            )}
          </button>
        </div>
      </div>

      {/* 실행 이력 */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-3">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">실행 이력 (현재 세션)</h3>
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
                      ? `${formatNumber(entry.deleted)}건 삭제`
                      : '완료'}{' '}
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
                이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => {
                  closeModal()
                  modal.onConfirm()
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
