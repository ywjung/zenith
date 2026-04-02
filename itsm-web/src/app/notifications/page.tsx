'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import { API_BASE } from '@/lib/constants'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'
import { useTranslations } from 'next-intl'

/* ─── 알림 설정 데이터 ─────────────────────────────────── */

const EVENTS = [
  { key: 'ticket_created', icon: '🎫' },
  { key: 'status_changed', icon: '🔄' },
  { key: 'comment_added',  icon: '💬' },
  { key: 'assigned',       icon: '👤' },
  { key: 'sla_warning',    icon: '⏰' },
  { key: 'sla_breach',     icon: '🚨' },
] as const

type PrefsRecord = Record<string, boolean>

function buildDefaultPrefs(): PrefsRecord {
  const prefs: PrefsRecord = {}
  for (const ev of EVENTS) {
    prefs[`${ev.key}_email`] = true
    prefs[`${ev.key}_inapp`] = true
  }
  return prefs
}

/* ─── 구독 티켓 타입 ────────────────────────────────────── */

interface WatchedTicket {
  watch_id: number
  ticket_iid: number
  subscribed_at: string | null
  title: string
  status: string
  priority: string
  state: string
  web_url: string
  assignee_name: string | null
  updated_at: string
  project_id: string
}

/* ─── 공통 토글 컴포넌트 ────────────────────────────────── */

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

/* ─── 탭: 알림 수신 설정 ────────────────────────────────── */

function TabPrefs() {
  const t = useTranslations()
  const [prefs, setPrefs] = useState<PrefsRecord>(buildDefaultPrefs)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    fetch(`${API_BASE}/notifications/prefs`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : {})
      .then(data => setPrefs(prev => ({ ...prev, ...data })))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setStatus('idle')
    try {
      const r = await fetch(`${API_BASE}/notifications/prefs`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      setStatus(r.ok ? 'success' : 'error')
      if (r.ok) setTimeout(() => setStatus('idle'), 2000)
    } catch { setStatus('error') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('notifications.col_event')}</span>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 w-16 text-center"><span className="mr-1">📧</span>{t('notifications.col_email')}</span>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 w-16 text-center"><span className="mr-1">🔔</span>{t('notifications.col_inapp')}</span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm animate-pulse">{t('notifications.loading_prefs')}</div>
      ) : (
        <ul>
          {EVENTS.map((ev, idx) => (
            <li key={ev.key}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${idx < EVENTS.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl shrink-0">{ev.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t(`notifications.event_${ev.key}`)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t(`notifications.event_${ev.key}_desc`)}</p>
                </div>
              </div>
              <div className="w-16 flex justify-center">
                <Toggle checked={prefs[`${ev.key}_email`] ?? true}
                  onChange={() => setPrefs(p => ({ ...p, [`${ev.key}_email`]: !p[`${ev.key}_email`] }))}
                  label={`${t(`notifications.event_${ev.key}`)} ${t('notifications.col_email')}`} />
              </div>
              <div className="w-16 flex justify-center">
                <Toggle checked={prefs[`${ev.key}_inapp`] ?? true}
                  onChange={() => setPrefs(p => ({ ...p, [`${ev.key}_inapp`]: !p[`${ev.key}_inapp`] }))}
                  label={`${t(`notifications.event_${ev.key}`)} ${t('notifications.col_inapp')}`} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
        <div className="text-sm">
          {status === 'success' && <span className="text-green-600 dark:text-green-400 font-medium">{t('notifications.save_success')}</span>}
          {status === 'error'   && <span className="text-red-600 dark:text-red-400 font-medium">{t('notifications.save_error')}</span>}
        </div>
        <button type="button" onClick={handleSave} disabled={saving || loading}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? t('notifications.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

/* ─── 탭: 구독 중인 티켓 ────────────────────────────────── */

function TabWatches() {
  const t = useTranslations()
  const [watches, setWatches] = useState<WatchedTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [unwatching, setUnwatching] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    fetch(`${API_BASE}/notifications/my-watches`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setWatches)
      .catch(() => setError(t('notifications.watch_load_error')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleUnwatch(iid: number, projectId: string) {
    setUnwatching(prev => new Set(prev).add(iid))
    try {
      const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
      const r = await fetch(`${API_BASE}/tickets/${iid}/watch${params}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (r.ok || r.status === 404) {
        setWatches(prev => prev.filter(w => w.ticket_iid !== iid))
      }
    } catch { /* ignore */ }
    finally {
      setUnwatching(prev => { const s = new Set(prev); s.delete(iid); return s })
    }
  }

  function formatDate(iso: string) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {[1,2,3,4].map(i => (
          <div key={i} className="grid grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-700/60 last:border-0 animate-pulse">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-10" />
            <div className="space-y-1.5">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
            </div>
            <div className="flex justify-center"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-14" /></div>
            <div className="flex justify-center"><div className="h-5 bg-gray-100 dark:bg-gray-800 rounded-full w-10" /></div>
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-20" />
            <div className="flex justify-center"><div className="h-7 bg-gray-100 dark:bg-gray-800 rounded-lg w-16" /></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 dark:text-red-400 py-6 text-center">{error}</p>

  if (watches.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm py-16 text-center">
        <p className="text-4xl mb-3">🔕</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm">{t('notifications.no_watches')}</p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          {t('notifications.no_watches_hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="hidden sm:grid grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        <span>#</span>
        <span>{t('notifications.col_title_assignee')}</span>
        <span className="text-center">{t('ticket.fields.status')}</span>
        <span className="text-center">{t('ticket.fields.priority')}</span>
        <span className="hidden lg:block">{t('notifications.col_subscribed_at')}</span>
        <span className="text-center">{t('notifications.col_unwatch')}</span>
      </div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
        {watches.map(w => {
          const isClosed = w.state === 'closed'
          const isUnwatching = unwatching.has(w.ticket_iid)
          const href = w.project_id
            ? `/tickets/${w.ticket_iid}?project_id=${w.project_id}`
            : `/tickets/${w.ticket_iid}`

          return (
            <li key={w.watch_id}
              className={`grid grid-cols-[56px_1fr] sm:grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors ${isClosed ? 'opacity-60' : ''}`}>
              {/* # */}
              <Link href={href} className="font-mono text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 truncate">
                #{w.ticket_iid}
              </Link>

              {/* 제목 + 담당자 */}
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Link href={href} className="block text-sm font-medium text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 truncate leading-snug flex-1 min-w-0">
                    {w.title}
                  </Link>
                  {/* 모바일: 구독 취소 버튼 */}
                  <button
                    onClick={() => handleUnwatch(w.ticket_iid, w.project_id)}
                    disabled={isUnwatching}
                    className="sm:hidden shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors text-base leading-none mt-0.5"
                    title={t('notifications.col_unwatch')}
                  >
                    {isUnwatching ? '⏳' : '🔕'}
                  </button>
                </div>
                {w.assignee_name && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{t('notifications.assignee_label')}: {w.assignee_name}</p>
                )}
                {/* 모바일: 상태·우선순위·구독일 인라인 */}
                <div className="flex gap-1.5 mt-1.5 sm:hidden flex-wrap items-center">
                  <StatusBadge status={w.status} />
                  <PriorityBadge priority={w.priority} />
                  <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">{formatDate(w.subscribed_at ?? '')}</span>
                </div>
              </div>

              {/* 상태 */}
              <div className="hidden sm:flex items-center justify-center">
                <StatusBadge status={w.status} />
              </div>

              {/* 우선순위 */}
              <div className="hidden sm:flex items-center justify-center">
                <PriorityBadge priority={w.priority} />
              </div>

              {/* 구독일 */}
              <div className="hidden lg:flex items-center text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                {formatDate(w.subscribed_at ?? '')}
              </div>

              {/* 구독 취소 버튼 */}
              <div className="hidden sm:flex justify-center">
                <button
                  onClick={() => handleUnwatch(w.ticket_iid, w.project_id)}
                  disabled={isUnwatching}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-red-300 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={t('notifications.col_unwatch')}
                >
                  {isUnwatching ? (
                    <span className="animate-spin text-xs">⏳</span>
                  ) : (
                    <><span>🔕</span><span className="hidden sm:inline">{t('notifications.unwatch')}</span></>
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-between">
        <span>{t('notifications.total_watches', { count: watches.length })}</span>
        <span>{t('notifications.watches_hint')}</span>
      </div>
    </div>
  )
}

/* ─── 메인 페이지 ───────────────────────────────────────── */

type TabId = 'prefs' | 'watches'

function NotificationsContent() {
  const t = useTranslations()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabId>(
    searchParams.get('tab') === 'prefs' ? 'prefs' : 'watches'
  )

  useEffect(() => {
    setTab(searchParams.get('tab') === 'prefs' ? 'prefs' : 'watches')
  }, [searchParams])

  return (
    <div className="w-full">
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('notifications.pref_title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('notifications.pref_desc')}</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {([
          { id: 'watches', label: t('notifications.tab_watches') },
          { id: 'prefs',   label: t('notifications.tab_prefs') },
        ] as { id: TabId; label: string }[]).map(tabItem => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tabItem.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === 'watches' && <TabWatches />}
      {tab === 'prefs'   && <TabPrefs />}
    </div>
  )
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  )
}
