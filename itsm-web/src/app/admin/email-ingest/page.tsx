'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { adminFetch } from '@/lib/adminFetch'
import { errorMessage } from '@/lib/utils'

interface IngestStatus {
  enabled: boolean
  imap_host?: string
  imap_user?: string
  schedule?: string
  recent_results?: unknown[]
}


export default function EmailIngestPage() {
  const [status, setStatus] = useState<IngestStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await adminFetch('/admin/email-ingest/status')
      setStatus(data)
    } catch (e: unknown) {
      setError(errorMessage(e, '불러오기 실패'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleTrigger() {
    setTriggering(true)
    setTriggerResult(null)
    try {
      const res = await adminFetch('/admin/email-ingest/trigger', { method: 'POST' })
      setTriggerResult(`태스크 큐에 등록됨 (ID: ${(res as { task_id: string }).task_id})`)
    } catch (e: unknown) {
      setTriggerResult(`오류: ${errorMessage(e, '실행 실패')}`)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            이메일 수신 모니터링
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            IMAP 기반 이메일 수신 설정 및 Celery 태스크 상태
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          🔄 새로고침
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-8 animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
        </div>
      ) : status ? (
        <>
          {/* 설정 상태 */}
          <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">설정 상태</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <span className={`w-3 h-3 rounded-full shrink-0 ${status.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">수신 활성화</div>
                  <div className={`text-sm font-semibold ${status.enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                    {status.enabled ? '활성' : '비활성'}
                  </div>
                </div>
              </div>
              {status.enabled && (
                <>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <div className="text-xs text-gray-500 dark:text-gray-400">IMAP 서버</div>
                    <div className="text-sm font-mono text-gray-800 dark:text-gray-100 mt-0.5 truncate">
                      {status.imap_host || '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <div className="text-xs text-gray-500 dark:text-gray-400">계정</div>
                    <div className="text-sm font-mono text-gray-800 dark:text-gray-100 mt-0.5 truncate">
                      {status.imap_user || '—'}
                    </div>
                  </div>
                </>
              )}
            </div>
            {status.enabled && status.schedule && (
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>⏱</span>
                <span>Celery Beat 스케줄: <strong className="text-gray-700 dark:text-gray-300">{status.schedule}</strong></span>
              </div>
            )}
          </div>

          {/* 수동 실행 */}
          {status.enabled && (
            <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">수동 실행</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                스케줄을 기다리지 않고 즉시 받은편지함을 처리합니다.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTrigger}
                  disabled={triggering}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {triggering ? '실행 중...' : '▶ 지금 실행'}
                </button>
                {triggerResult && (
                  <span className={`text-sm ${triggerResult.startsWith('오류') ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                    {triggerResult}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 비활성 안내 */}
          {!status.enabled && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📭</span>
                <div>
                  <h3 className="font-semibold text-amber-800 dark:text-amber-300 text-sm">이메일 수신이 비활성화되어 있습니다</h3>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    환경 변수 <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">IMAP_ENABLED=true</code> 및{' '}
                    <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">IMAP_HOST</code>,{' '}
                    <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">IMAP_USER</code>,{' '}
                    <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">IMAP_PASSWORD</code>를 설정하세요.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
