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

interface RedisStats {
  hit_rate_pct: number
  hits: number
  misses: number
  total_commands: number
  used_memory_human: string
  used_memory_bytes: number
  max_memory_bytes: number
  memory_usage_pct: number | null
  total_keys: number
  itsm_cache_keys: number
  connected_clients: number
  uptime_seconds: number
  redis_version: string
  evicted_keys: number
  expired_keys: number
}

const FLOWER_URL = process.env.NEXT_PUBLIC_FLOWER_URL || '/flower/'
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || '/grafana/'

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
  const [redis, setRedis] = useState<RedisStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [flushingCache, setFlushingCache] = useState(false)

  async function flushCache() {
    if (!confirm('ITSM 캐시를 초기화하시겠습니까? 일시적으로 응답이 느려질 수 있습니다.')) return
    setFlushingCache(true)
    try {
      await fetch(`${API_BASE}/admin/redis/cache`, { method: 'DELETE', credentials: 'include' })
      await refresh()
    } finally {
      setFlushingCache(false)
    }
  }

  async function refresh() {
    setLoading(true)
    try {
      const [h, c, rd] = await Promise.allSettled([
        fetch(`${API_BASE}/health`, { credentials: 'include' }).then(r => r.json()),
        fetch(`${API_BASE}/admin/celery/stats`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/admin/redis/stats`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ])
      if (h.status === 'fulfilled') {
        const raw = h.value
        // API returns { status, checks: { db, redis, ... } } — flatten for UI
        setHealth({
          status: raw.status,
          db: raw.checks?.db ?? raw.db ?? 'unknown',
          redis: raw.checks?.redis ?? raw.redis ?? 'unknown',
          celery_broker: raw.checks?.celery_broker ?? raw.celery_broker ?? 'unknown',
          version: raw.version,
        })
      }
      if (c.status === 'fulfilled') setCelery(c.value)
      if (rd.status === 'fulfilled') setRedis(rd.value)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            시스템 모니터링
          </h1>
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

      {/* Redis 캐시 통계 */}
      {redis && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">🔴 Redis 캐시 현황</h2>
            <button
              onClick={flushCache}
              disabled={flushingCache}
              className="text-xs bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              {flushingCache ? '초기화 중…' : '🗑️ ITSM 캐시 초기화'}
            </button>
          </div>

          {/* 히트율 게이지 */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">캐시 히트율</span>
              <span className={`text-sm font-bold ${redis.hit_rate_pct >= 80 ? 'text-green-600 dark:text-green-400' : redis.hit_rate_pct >= 50 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                {redis.hit_rate_pct}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${redis.hit_rate_pct >= 80 ? 'bg-green-500' : redis.hit_rate_pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(redis.hit_rate_pct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span>히트: {redis.hits.toLocaleString()}</span>
              <span>미스: {redis.misses.toLocaleString()}</span>
            </div>
          </div>

          {/* 메모리 게이지 */}
          {redis.memory_usage_pct !== null && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">메모리 사용률</span>
                <span className={`text-sm font-bold ${redis.memory_usage_pct >= 85 ? 'text-red-600 dark:text-red-400' : redis.memory_usage_pct >= 70 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                  {redis.memory_usage_pct}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${redis.memory_usage_pct >= 85 ? 'bg-red-500' : redis.memory_usage_pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(redis.memory_usage_pct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* 주요 지표 그리드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '메모리 사용', value: redis.used_memory_human },
              { label: '전체 키', value: redis.total_keys.toLocaleString() + '개' },
              { label: 'ITSM 캐시 키', value: redis.itsm_cache_keys.toLocaleString() + '개' },
              { label: '연결 수', value: redis.connected_clients + '개' },
              { label: '만료된 키', value: redis.expired_keys.toLocaleString() },
              { label: '강제 삭제 키', value: redis.evicted_keys.toLocaleString() },
              { label: 'Redis 버전', value: redis.redis_version },
              { label: '가동 시간', value: (() => {
                const s = redis.uptime_seconds
                if (s < 3600) return `${Math.floor(s/60)}분`
                if (s < 86400) return `${Math.floor(s/3600)}시간`
                return `${Math.floor(s/86400)}일`
              })() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{value}</div>
              </div>
            ))}
          </div>
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
              url: '/prometheus/',
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
