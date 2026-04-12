'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'

interface LabelStatus {
  name: string
  color: string
  in_project: boolean
  in_group: boolean
  synced: boolean
  service_label: string | null
  service_emoji: string | null
  service_value: string | null
  enabled: boolean
}

interface StatusData {
  labels: LabelStatus[]
  project_label_count: number
  group_label_count: number
}

const LABEL_GROUPS = [
  { prefix: 'status::', titleKey: 'group_status_title', descKey: 'group_status_desc', readonly: true,  icon: '🔄' },
  { prefix: 'prio::',   titleKey: 'group_prio_title',   descKey: 'group_prio_desc',   readonly: true,  icon: '🎯' },
  { prefix: 'cat::',    titleKey: 'group_cat_title',    descKey: 'group_cat_desc',    readonly: false, icon: '🏷️' },
] as const

function LabelDot({ color }: { color: string }) {
  return <span className="inline-block w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: color }} />
}

export default function AdminLabelsPage() {
  const t = useTranslations('admin.labels')
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: string[]; failed: string[] } | null>(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/label-status`, { credentials: 'include' })
      if (r.ok) setData(await r.json())
      else setError(t('load_failed'))
    } catch { setError(t('network_error')) }
    finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/admin/sync-labels`, {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        const result = await r.json()
        setSyncResult(result)
        await load()
      } else {
        setError(t('sync_failed'))
      }
    } catch { setError(t('network_error')) }
    finally { setSyncing(false) }
  }

  const allSynced = data?.labels.every(l => l.synced) ?? false
  const unsyncedCount = data?.labels.filter(l => !l.synced).length ?? 0

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {t('title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('subtitle')}
            </p>
            {data && (
              <div className="flex gap-3 mt-3 text-sm flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {t('total')} <strong className="text-gray-900 dark:text-gray-100">{t('total_count', { n: data.labels.length })}</strong>
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${allSynced ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                  {allSynced ? t('all_synced') : t('unsynced_count', { n: unsyncedCount })}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                  {t('project_labels', { n: data.project_label_count })}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400">
                  {t('group_labels', { n: data.group_label_count })}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || loading}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2"
          >
            {syncing ? (
              <><span className="animate-spin">⏳</span> {t('syncing')}</>
            ) : (
              <><span>🔄</span> {t('sync_all')}</>
            )}
          </button>
        </div>

        {syncResult && (
          <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 text-sm">
            <p className="font-semibold text-green-800 dark:text-green-300 mb-1">{t('sync_done')}</p>
            <p className="text-green-700 dark:text-green-400">
              {t('sync_success', { n: syncResult.synced.length })}
              {syncResult.failed.length > 0 && (
                <span className="text-red-600 ml-2">{t('sync_failure', { n: syncResult.failed.length, list: syncResult.failed.join(', ') })}</span>
              )}
            </p>
          </div>
        )}
        {error && (
          <div className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">⚠️ {error}</div>
        )}
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-5 text-sm text-amber-800 dark:text-amber-300">
        <p className="font-semibold mb-2">{t('structure_title')}</p>
        <ul className="space-y-1.5 text-xs leading-relaxed">
          <li>• <strong>status:: / prio::</strong> — {t('structure_1')}</li>
          <li>• <strong>cat::</strong> — <Link href="/admin/service-types" className="underline text-amber-900 dark:text-amber-200 hover:text-amber-700 dark:hover:text-amber-400">{t('structure_2_prefix')}</Link>{t('structure_2_suffix')}</li>
          <li>• {t('structure_3')}</li>
          <li>• {t('structure_4')}</li>
        </ul>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border dark:border-gray-700 shadow-sm p-8 text-center text-gray-400 animate-pulse">{t('loading')}</div>
      ) : data && LABEL_GROUPS.map(group => {
        const groupLabels = data.labels.filter(l => l.name.startsWith(group.prefix))
        if (groupLabels.length === 0) return null
        const groupSynced = groupLabels.every(l => l.synced)
        return (
          <div key={group.prefix} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700">
              <div className="flex items-center gap-3">
                <span className="text-xl">{group.icon}</span>
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200">{t(group.titleKey as 'group_status_title')}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t(group.descKey as 'group_status_desc')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {groupSynced ? (
                  <span className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 px-2.5 py-1 rounded-full font-medium">{t('synced_badge')}</span>
                ) : (
                  <span className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 px-2.5 py-1 rounded-full font-medium">{t('unsynced_badge')}</span>
                )}
                {!group.readonly && (
                  <Link href="/admin/service-types"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 border border-blue-200 dark:border-blue-700 px-2.5 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                    {t('manage_service_types')}
                  </Link>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/30 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2.5 text-left">{t('col_name')}</th>
                  <th className="px-5 py-2.5 text-left">{t('col_color')}</th>
                  <th className="px-4 py-2.5 text-center">{t('col_project')}</th>
                  <th className="px-4 py-2.5 text-center">{t('col_group')}</th>
                  <th className="px-4 py-2.5 text-center">{t('col_status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {groupLabels.map(label => (
                  <tr key={label.name} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!label.synced ? 'bg-red-50/30 dark:bg-red-900/10' : ''} ${!label.enabled ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LabelDot color={label.color} />
                        <code className="font-mono text-sm text-gray-800 dark:text-gray-200">{label.name}</code>
                        {label.service_label && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            {label.service_emoji} {label.service_label}
                            {!label.enabled && <span className="text-gray-400">{t('inactive')}</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <LabelDot color={label.color} />
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{label.color}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {label.in_project ? (
                        <span className="text-green-600 text-base">✅</span>
                      ) : (
                        <span className="text-red-400 text-base">❌</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {label.in_group ? (
                        <span className="text-green-600 text-base">✅</span>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {label.synced ? (
                        <span className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 px-2 py-0.5 rounded-full">{t('ok')}</span>
                      ) : (
                        <span className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 px-2 py-0.5 rounded-full">{t('missing')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
