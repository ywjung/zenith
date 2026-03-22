'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface HealthStatus {
  status: string
  redis: string
  celery_broker: string
  db: string
  version?: string
}

interface CeleryStats {
  active_tasks: number
  reserved_tasks: number
  workers: string[]
  queues: Record<string, number>
}

const FLOWER_URL = process.env.NEXT_PUBLIC_FLOWER_URL || '/flower'
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || '/grafana'

function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'healthy' || status === 'connected'
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {ok ? '정상' : status}
    </span>
  )
}

export default function MonitoringPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [celery, setCelery] = useState<CeleryStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  async function refresh() {
    setLoading(true)
    try {
      const [h, c] = await Promise.allSettled([
        fetch(`${API_BASE}/health`, { credentials: 'include' }).then(r => r.json()),
        fetch(`${API_BASE}/admin/celery/stats`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ])
      if (h.status === 'fulfilled') setHealth(h.value)
      if (c.status === 'fulfilled') setCelery(c.value)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">시스템 모니터링</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            API 서버 · Celery · Redis 상태와 외부 모니터링 도구 링크를 제공합니다.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? '갱신 중…' : '↻ 새로고침'}
        </button>
      </div>

      {/* API 헬스 */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">🏥 서비스 상태</h2>
        {health ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'API 서버', value: health.status },
              { label: 'PostgreSQL', value: health.db },
              { label: 'Redis', value: health.redis },
              { label: 'Celery 브로커', value: health.celery_broker },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
                <StatusDot status={value ?? 'unknown'} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">불러오는 중…</p>
        )}
        {health?.version && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">버전: {health.version}</p>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          마지막 갱신: {lastRefresh.toLocaleTimeString('ko-KR')}
        </p>
      </div>

      {/* Celery 작업 */}
      {celery && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">⚙️ Celery 작업 현황</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{celery.active_tasks}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">실행 중</div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{celery.reserved_tasks}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">예약됨</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{celery.workers.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">워커</div>
            </div>
          </div>
          {Object.keys(celery.queues).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">큐별 대기 작업</div>
              <div className="space-y-1.5">
                {Object.entries(celery.queues).map(([q, n]) => (
                  <div key={q} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{q}</span>
                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-medium text-gray-700 dark:text-gray-300">{n}개</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 외부 도구 */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">🔗 외부 모니터링 도구</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              name: 'Celery Flower',
              desc: 'Celery 작업 · 워커 실시간 모니터링',
              icon: '🌸',
              url: FLOWER_URL,
              color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40',
            },
            {
              name: 'Grafana',
              desc: '메트릭 대시보드 · SLA · 성능 추이',
              icon: '📊',
              url: GRAFANA_URL,
              color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40',
            },
            {
              name: 'Prometheus',
              desc: '원시 메트릭 · 알림 규칙 현황',
              icon: '🔥',
              url: '/prometheus',
              color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40',
            },
          ].map(tool => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block p-4 rounded-xl border transition-colors ${tool.color}`}
            >
              <div className="text-2xl mb-2">{tool.icon}</div>
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{tool.name} ↗</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tool.desc}</div>
            </a>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          * 도구에 접근하려면 Docker Compose 서비스가 실행 중이어야 합니다.
          nginx 프록시를 통해 /flower, /grafana, /prometheus 경로로 연결됩니다.
        </p>
      </div>
    </div>
  )
}
