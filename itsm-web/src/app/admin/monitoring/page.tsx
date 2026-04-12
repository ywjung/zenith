'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useConfirm } from '@/components/ConfirmProvider'
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
  const t = useTranslations('admin.monitoring')
  const ok = status === 'ok' || status === 'healthy' || status === 'connected'
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {ok ? t('status_healthy') : status}
    </span>
  )
}

export default function MonitoringPage() {
  const t = useTranslations('admin.monitoring')
  const confirm = useConfirm()
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [celery, setCelery] = useState<CeleryStats | null>(null)
  const [redis, setRedis] = useState<RedisStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [flushingCache, setFlushingCache] = useState(false)

  async function flushCache() {
    if (!(await confirm({ title: t('flush_confirm'), variant: 'danger' }))) return
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [])

  function formatUptime(s: number): string {
    if (s < 3600) return t('uptime_minutes', { n: Math.floor(s/60) })
    if (s < 86400) return t('uptime_hours', { n: Math.floor(s/3600) })
    return t('uptime_days', { n: Math.floor(s/86400) })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? t('refreshing') : t('refresh')}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{t('services_title')}</h2>
        {health ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t('svc_api'),    value: health.status },
              { label: t('svc_db'),     value: health.db },
              { label: t('svc_redis'),  value: health.redis },
              { label: t('svc_celery'), value: health.celery_broker },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
                <StatusDot status={value ?? 'unknown'} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t('loading')}</p>
        )}
        {health?.version && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{t('version', { version: health.version })}</p>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {t('last_refresh', { time: lastRefresh.toLocaleTimeString() })}
        </p>
      </div>

      {celery && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{t('celery_title')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{celery.active_tasks}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('celery_active')}</div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{celery.reserved_tasks}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('celery_reserved')}</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{celery.workers.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('celery_workers')}</div>
            </div>
          </div>
          {Object.keys(celery.queues).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">{t('celery_queues')}</div>
              <div className="space-y-1.5">
                {Object.entries(celery.queues).map(([q, n]) => (
                  <div key={q} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{q}</span>
                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-medium text-gray-700 dark:text-gray-300">{t('queue_count', { n })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {redis && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('redis_title')}</h2>
            <button
              onClick={flushCache}
              disabled={flushingCache}
              className="text-xs bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-400 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {flushingCache ? t('flushing') : t('flush_cache')}
            </button>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('hit_rate')}</span>
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
              <span>{t('hits', { n: redis.hits.toLocaleString() })}</span>
              <span>{t('misses', { n: redis.misses.toLocaleString() })}</span>
            </div>
          </div>

          {redis.memory_usage_pct !== null && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('memory_usage')}</span>
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t('mem_used'),        value: redis.used_memory_human },
              { label: t('total_keys'),      value: t('keys_unit', { n: redis.total_keys.toLocaleString() }) },
              { label: t('itsm_keys'),       value: t('keys_unit', { n: redis.itsm_cache_keys.toLocaleString() }) },
              { label: t('connections'),     value: t('conn_unit', { n: redis.connected_clients }) },
              { label: t('expired'),         value: redis.expired_keys.toLocaleString() },
              { label: t('evicted'),         value: redis.evicted_keys.toLocaleString() },
              { label: t('redis_version'),   value: redis.redis_version },
              { label: t('uptime'),          value: formatUptime(redis.uptime_seconds) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{t('external_title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: t('tool_flower_name'),     desc: t('tool_flower_desc'),     icon: '🌸', url: FLOWER_URL,
              color: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40' },
            { name: t('tool_grafana_name'),    desc: t('tool_grafana_desc'),    icon: '📊', url: GRAFANA_URL,
              color: 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40' },
            { name: t('tool_prometheus_name'), desc: t('tool_prometheus_desc'), icon: '🔥', url: '/prometheus/',
              color: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40' },
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
          {t('external_note')}
        </p>
      </div>
    </div>
  )
}
