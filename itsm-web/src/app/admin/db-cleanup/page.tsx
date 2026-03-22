'use client'

import { useEffect, useState } from 'react'

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

interface CleanupStats {
  expired_refresh_tokens: number
  expired_guest_tokens: number
  old_read_notifications: number
  old_audit_logs: number
  policy: {
    refresh_token_ttl_days: string
    guest_token_ttl_days: string
    notification_retention_days: number
    audit_log_retention_days: number
    schedule: string
  }
}

export default function DbCleanupPage() {
  const [stats, setStats] = useState<CleanupStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)

  async function loadStats() {
    try {
      const data = await apiFetch<CleanupStats>('/admin/db-cleanup/stats')
      setStats(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStats() }, [])

  async function handleRun() {
    if (!confirm('만료 데이터 정리를 즉시 실행하시겠습니까?')) return
    setRunning(true)
    try {
      await apiFetch('/admin/db-cleanup/run', { method: 'POST' })
      setLastRun(new Date().toLocaleString('ko-KR'))
      await loadStats()
    } catch (e) {
      alert(e instanceof Error ? e.message : '실행 실패')
    } finally {
      setRunning(false)
    }
  }

  const cards = stats ? [
    { label: '만료된 RefreshToken', value: stats.expired_refresh_tokens, desc: 'expires_at 초과' },
    { label: '만료된 GuestToken', value: stats.expired_guest_tokens, desc: 'expires_at 초과' },
    { label: '오래된 읽음 알림', value: stats.old_read_notifications, desc: `${stats.policy.notification_retention_days}일 초과` },
    { label: '오래된 감사 로그', value: stats.old_audit_logs, desc: `${stats.policy.audit_log_retention_days}일 초과` },
  ] : []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">DB 보존 정책 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            만료된 토큰, 오래된 알림·감사로그를 자동으로 정리합니다.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
        >
          {running ? '실행 중…' : '지금 정리 실행'}
        </button>
      </div>

      {lastRun && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg text-sm text-green-700 dark:text-green-400">
          ✅ {lastRun}에 정리 작업을 큐에 등록했습니다. 백그라운드에서 실행됩니다.
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {cards.map((c) => (
              <div key={c.label} className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{c.label}</p>
                <p className={`text-3xl font-bold ${c.value > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
                  {c.value.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{c.desc}</p>
              </div>
            ))}
          </div>

          {stats && (
            <div className="bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">보존 정책</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <th className="text-left pb-2">대상</th>
                    <th className="text-left pb-2">정책</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  <tr><td className="py-2 text-gray-700 dark:text-gray-300">RefreshToken</td><td className="py-2 text-gray-500">{stats.policy.refresh_token_ttl_days}</td></tr>
                  <tr><td className="py-2 text-gray-700 dark:text-gray-300">GuestToken</td><td className="py-2 text-gray-500">{stats.policy.guest_token_ttl_days}</td></tr>
                  <tr><td className="py-2 text-gray-700 dark:text-gray-300">읽음 알림</td><td className="py-2 text-gray-500">{stats.policy.notification_retention_days}일 이상 경과 시 삭제</td></tr>
                  <tr><td className="py-2 text-gray-700 dark:text-gray-300">감사 로그</td><td className="py-2 text-gray-500">{stats.policy.audit_log_retention_days}일 이상 경과 시 삭제</td></tr>
                  <tr><td className="py-2 text-gray-700 dark:text-gray-300">자동 실행</td><td className="py-2 text-gray-500">{stats.policy.schedule}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
