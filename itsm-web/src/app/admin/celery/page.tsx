'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchCeleryFlowerStats,
  fetchCeleryFlowerWorkers,
  fetchCeleryFlowerTasks,
  type CeleryFlowerStats,
  type CeleryWorker,
  type CeleryTask,
} from '@/lib/api'

const REFRESH_INTERVAL = 30_000 // 30초

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function formatTimestamp(unix: number | null): string {
  if (!unix) return '-'
  return new Date(unix * 1000).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRuntime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '-'
  return `${seconds.toFixed(2)}s`
}

// ---------------------------------------------------------------------------
// 서브 컴포넌트
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color = 'blue',
  sub,
}: {
  label: string
  value: string | number
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple'
  sub?: string
}) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  }
  return (
    <div className={`rounded-xl p-4 text-center ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
      {sub && <div className="text-xs mt-0.5 opacity-60">{sub}</div>}
    </div>
  )
}

function WorkerBadge({ status }: { status: 'online' | 'offline' }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        온라인
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      오프라인
    </span>
  )
}

function TaskStateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    SUCCESS: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    FAILURE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    STARTED: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    PENDING: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
    RETRY: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    REVOKED: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  }
  const cls = map[state] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {state}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 페이지
// ---------------------------------------------------------------------------

export default function CeleryMonitorPage() {
  const [stats, setStats] = useState<CeleryFlowerStats | null>(null)
  const [workers, setWorkers] = useState<CeleryWorker[]>([])
  const [tasks, setTasks] = useState<CeleryTask[]>([])
  const [failedTasks, setFailedTasks] = useState<CeleryTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [taskFilter, setTaskFilter] = useState<string>('ALL')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, w, t, f] = await Promise.allSettled([
        fetchCeleryFlowerStats(),
        fetchCeleryFlowerWorkers(),
        fetchCeleryFlowerTasks('ALL', 20),
        fetchCeleryFlowerTasks('FAILURE', 10),
      ])

      if (s.status === 'fulfilled') setStats(s.value)
      else setError(s.reason?.message ?? 'Flower 서비스에 연결할 수 없습니다.')

      if (w.status === 'fulfilled') setWorkers(w.value)
      if (t.status === 'fulfilled') setTasks(t.value)
      if (f.status === 'fulfilled') setFailedTasks(f.value)
    } finally {
      setLoading(false)
      setLastRefresh(new Date())
    }
  }, [])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, REFRESH_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  // 태스크 필터 변경 시 재조회
  useEffect(() => {
    fetchCeleryFlowerTasks(taskFilter, 20)
      .then(setTasks)
      .catch(() => {})
  }, [taskFilter])

  // ---------------------------------------------------------------------------
  // Flower 미연결 상태
  // ---------------------------------------------------------------------------
  if (!loading && error) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader loading={loading} onRefresh={load} lastRefresh={lastRefresh} />
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-6 flex items-start gap-4">
          <span className="text-2xl shrink-0">⚠️</span>
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-300 text-sm">
              Flower 서비스에 연결할 수 없습니다
            </div>
            <div className="text-sm text-amber-700 dark:text-amber-400 mt-1">{error}</div>
            <div className="text-xs text-amber-600 dark:text-amber-500 mt-2">
              Flower 컨테이너(itsm-flower-1)가 실행 중인지 확인하세요.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // 정상 렌더
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <PageHeader loading={loading} onRefresh={load} lastRefresh={lastRefresh} />

      {/* 요약 통계 */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="활성 태스크"
            value={stats.total_active}
            color="blue"
          />
          <StatCard
            label="온라인 워커"
            value={stats.workers.filter(w => w.status === 'online').length}
            color="green"
            sub={`전체 ${stats.workers.length}개`}
          />
          <StatCard
            label="누적 처리"
            value={stats.total_processed.toLocaleString()}
            color="purple"
          />
          <StatCard
            label="최근 실패"
            value={stats.total_failed_recent}
            color={stats.total_failed_recent > 0 ? 'red' : 'green'}
          />
        </div>
      )}

      {/* 워커 상태 */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          워커 상태
        </h2>
        {workers.length === 0 ? (
          <p className="text-sm text-gray-400">워커 정보가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">워커</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">상태</th>
                  <th className="text-right py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">활성</th>
                  <th className="text-right py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">예약</th>
                  <th className="text-right py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">동시성</th>
                  <th className="text-right py-2 text-xs font-medium text-gray-500 dark:text-gray-400">누적 처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {workers.map(w => (
                  <tr key={w.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">{w.name}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <WorkerBadge status={w.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{w.active_tasks}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{w.reserved_tasks}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{w.concurrency}</td>
                    <td className="py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{w.processed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 큐 현황 */}
      {stats && Object.keys(stats.queues).length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            큐 현황
          </h2>
          <div className="space-y-2.5">
            {Object.entries(stats.queues).map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="font-mono text-xs text-gray-600 dark:text-gray-400 w-48 shrink-0 truncate">{name}</span>
                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: count > 0 ? `${Math.min(100, count * 10)}%` : '0%' }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-12 text-right tabular-nums">
                  {count}건
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 최근 실패 태스크 */}
      {failedTasks.length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-800 p-5">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-4">
            최근 실패 태스크 (최근 10건)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">태스크명</th>
                  <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400">실패 시각</th>
                  <th className="text-left py-2 text-xs font-medium text-gray-500 dark:text-gray-400">예외 메시지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {failedTasks.map(t => (
                  <tr key={t.uuid} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                        {t.name || t.uuid.slice(0, 12) + '…'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatTimestamp(t.failed)}
                    </td>
                    <td className="py-2.5 text-xs text-red-600 dark:text-red-400 max-w-xs truncate" title={t.exception}>
                      {t.exception || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 태스크 목록 */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">태스크 목록</h2>
          <div className="flex gap-1.5">
            {(['ALL', 'SUCCESS', 'FAILURE', 'STARTED', 'PENDING', 'RETRY'] as const).map(s => (
              <button
                key={s}
                onClick={() => setTaskFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  taskFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-400">태스크 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 dark:text-gray-400">태스크명</th>
                  <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 dark:text-gray-400">상태</th>
                  <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 dark:text-gray-400">워커</th>
                  <th className="text-right py-2 pr-3 text-xs font-medium text-gray-500 dark:text-gray-400">수신</th>
                  <th className="text-right py-2 text-xs font-medium text-gray-500 dark:text-gray-400">실행 시간</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {tasks.map(t => (
                  <tr key={t.uuid} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 pr-3">
                      <span
                        className="font-mono text-xs text-gray-700 dark:text-gray-300 block max-w-xs truncate"
                        title={t.name}
                      >
                        {t.name || t.uuid.slice(0, 12) + '…'}
                      </span>
                      {t.exception && (
                        <span className="text-xs text-red-500 dark:text-red-400 block truncate max-w-xs mt-0.5" title={t.exception}>
                          {t.exception}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <TaskStateBadge state={t.state} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-500 truncate block max-w-[140px]" title={t.worker}>
                        {t.worker ? t.worker.split('@')[0] : '-'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatTimestamp(t.received)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">
                      {formatRuntime(t.runtime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 헤더 컴포넌트
// ---------------------------------------------------------------------------

function PageHeader({
  loading,
  onRefresh,
  lastRefresh,
}: {
  loading: boolean
  onRefresh: () => void
  lastRefresh: Date
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
          Celery 모니터링
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Flower API를 통해 워커·큐·태스크 상태를 실시간으로 확인합니다. 30초마다 자동 갱신.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">
          갱신: {lastRefresh.toLocaleTimeString('ko-KR')}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? '갱신 중…' : '↻ 새로고침'}
        </button>
      </div>
    </div>
  )
}
