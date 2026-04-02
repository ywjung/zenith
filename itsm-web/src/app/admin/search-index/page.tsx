'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface GinIndex {
  name: string
  definition: string
}

interface IndexStatus {
  total_indexed: number
  last_synced_at: string | null
  trgm_enabled: boolean
  gin_indexes: GinIndex[]
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

export default function SearchIndexPage() {
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/admin/search-index/status')
      setStatus(data as IndexStatus)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await apiFetch('/admin/search-index/sync', { method: 'POST' })
      setSyncResult({ ok: true, message: `동기화 태스크 등록됨 (ID: ${(res as { task_id: string }).task_id})` })
      setTimeout(load, 3000)
    } catch (e: unknown) {
      setSyncResult({ ok: false, message: e instanceof Error ? e.message : '실행 실패' })
    } finally {
      setSyncing(false)
    }
  }

  const fmtDate = (iso: string | null) => {
    if (!iso) return '없음'
    return new Date(iso).toLocaleString('ko-KR')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            전문검색 색인 관리
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            PostgreSQL pg_trgm GIN 색인 현황 및 수동 동기화
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm border dark:border-gray-600 px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
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
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 animate-pulse">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : status ? (
        <>
          {/* 상태 카드 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
              <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                {status.total_indexed.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">색인된 티켓 수</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                {fmtDate(status.last_synced_at)}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">마지막 동기화</div>
            </div>
          </div>

          {/* pg_trgm 확장 및 GIN 인덱스 상태 */}
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">pg_trgm 확장 상태</h3>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                status.trgm_enabled
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              }`}>
                {status.trgm_enabled ? '✓ 설치됨' : '✗ 미설치'}
              </span>
              {!status.trgm_enabled && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  CREATE EXTENSION pg_trgm; 실행 필요
                </span>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">GIN 인덱스 목록</p>
              {status.gin_indexes.length === 0 ? (
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  GIN 인덱스가 없습니다. 마이그레이션(0053, 0056)이 적용됐는지 확인하세요.
                </p>
              ) : (
                <div className="space-y-2">
                  {status.gin_indexes.map(idx => (
                    <div key={idx.name} className="flex items-start gap-2">
                      <span className="text-green-500 text-sm shrink-0 mt-0.5">✓</span>
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{idx.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate max-w-xl" title={idx.definition}>
                          {idx.definition}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 동작 방식 안내 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1.5">
            <p className="font-medium">동작 방식</p>
            <ul className="list-disc list-inside space-y-1 text-blue-600 dark:text-blue-400">
              <li>GitLab 웹훅 수신 시 이슈가 실시간으로 색인됩니다.</li>
              <li>Celery Beat가 30분마다 전체 동기화를 실행합니다.</li>
              <li>검색 요청 시 색인 → GitLab API 순서로 폴백합니다.</li>
              <li>수동 동기화는 색인이 비어있거나 누락이 의심될 때 사용하세요.</li>
            </ul>
          </div>

          {/* 수동 동기화 */}
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">수동 전체 동기화</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                모든 GitLab 이슈를 즉시 색인합니다. Celery가 실행 중이어야 합니다.
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? '동기화 요청 중...' : '🔎 지금 동기화'}
            </button>
            {syncResult && (
              <div className={`text-sm rounded-lg p-3 border ${
                syncResult.ok
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700'
              }`}>
                {syncResult.message}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
