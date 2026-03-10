'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import RequireAuth from '@/components/RequireAuth'
import { API_BASE } from '@/lib/constants'
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge'

/* ─── 알림 설정 데이터 ─────────────────────────────────── */

const EVENTS = [
  { key: 'ticket_created', label: '티켓 생성',     desc: '새 티켓이 접수되었을 때',          icon: '🎫' },
  { key: 'status_changed', label: '상태 변경',     desc: '담당 티켓 상태가 바뀌었을 때',     icon: '🔄' },
  { key: 'comment_added',  label: '댓글 추가',     desc: '담당 티켓에 새 댓글이 달렸을 때',  icon: '💬' },
  { key: 'assigned',       label: '담당자 배정',   desc: '내게 티켓이 배정되었을 때',        icon: '👤' },
  { key: 'sla_warning',    label: 'SLA 임박 경고', desc: 'SLA 기한 1시간 전 알림',           icon: '⏰' },
  { key: 'sla_breach',     label: 'SLA 위반',      desc: 'SLA 기한이 초과되었을 때',         icon: '🚨' },
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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}>
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

/* ─── 탭: 알림 수신 설정 ────────────────────────────────── */

function TabPrefs() {
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
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 bg-gray-50 border-b">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">이벤트</span>
        <span className="text-xs font-semibold text-gray-500 w-16 text-center"><span className="mr-1">📧</span>이메일</span>
        <span className="text-xs font-semibold text-gray-500 w-16 text-center"><span className="mr-1">🔔</span>인앱</span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400 text-sm animate-pulse">설정을 불러오는 중...</div>
      ) : (
        <ul>
          {EVENTS.map((ev, idx) => (
            <li key={ev.key}
              className={`grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors ${idx < EVENTS.length - 1 ? 'border-b' : ''}`}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl shrink-0">{ev.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{ev.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{ev.desc}</p>
                </div>
              </div>
              <div className="w-16 flex justify-center">
                <Toggle checked={prefs[`${ev.key}_email`] ?? true}
                  onChange={() => setPrefs(p => ({ ...p, [`${ev.key}_email`]: !p[`${ev.key}_email`] }))}
                  label={`${ev.label} 이메일`} />
              </div>
              <div className="w-16 flex justify-center">
                <Toggle checked={prefs[`${ev.key}_inapp`] ?? true}
                  onChange={() => setPrefs(p => ({ ...p, [`${ev.key}_inapp`]: !p[`${ev.key}_inapp`] }))}
                  label={`${ev.label} 인앱`} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 py-4 bg-gray-50 border-t flex items-center justify-between gap-4">
        <div className="text-sm">
          {status === 'success' && <span className="text-green-600 font-medium">✅ 저장됐습니다.</span>}
          {status === 'error'   && <span className="text-red-600 font-medium">저장 실패. 다시 시도해주세요.</span>}
        </div>
        <button type="button" onClick={handleSave} disabled={saving || loading}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  )
}

/* ─── 탭: 구독 중인 티켓 ────────────────────────────────── */

function TabWatches() {
  const [watches, setWatches] = useState<WatchedTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [unwatching, setUnwatching] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    fetch(`${API_BASE}/notifications/my-watches`, { credentials: 'include', cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setWatches)
      .catch(() => setError('구독 목록을 불러오지 못했습니다.'))
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
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {[1,2,3,4].map(i => (
          <div key={i} className="grid grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-4 border-b last:border-0 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-10" />
            <div className="space-y-1.5">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
            <div className="flex justify-center"><div className="h-5 bg-gray-200 rounded-full w-14" /></div>
            <div className="flex justify-center"><div className="h-5 bg-gray-100 rounded-full w-10" /></div>
            <div className="h-3 bg-gray-100 rounded w-20" />
            <div className="flex justify-center"><div className="h-7 bg-gray-100 rounded-lg w-16" /></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-500 py-6 text-center">{error}</p>

  if (watches.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm py-16 text-center">
        <p className="text-4xl mb-3">🔕</p>
        <p className="text-gray-500 text-sm">구독 중인 티켓이 없습니다.</p>
        <p className="text-gray-400 text-xs mt-2">
          티켓 상세 화면 사이드바의 <strong>"🔕 이 티켓 구독"</strong> 버튼으로 구독할 수 있습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="hidden sm:grid grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-3 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <span>#</span>
        <span>제목 / 담당자</span>
        <span className="text-center">상태</span>
        <span className="text-center">우선순위</span>
        <span className="hidden lg:block">구독일</span>
        <span className="text-center">구독 취소</span>
      </div>

      <ul className="divide-y divide-gray-100">
        {watches.map(w => {
          const isClosed = w.state === 'closed'
          const isUnwatching = unwatching.has(w.ticket_iid)
          const href = w.project_id
            ? `/tickets/${w.ticket_iid}?project_id=${w.project_id}`
            : `/tickets/${w.ticket_iid}`

          return (
            <li key={w.watch_id}
              className={`grid grid-cols-[56px_1fr] sm:grid-cols-[56px_1fr_96px_80px_128px_96px] items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors ${isClosed ? 'opacity-60' : ''}`}>
              {/* # */}
              <Link href={href} className="font-mono text-xs text-gray-400 hover:text-blue-600 truncate">
                #{w.ticket_iid}
              </Link>

              {/* 제목 + 담당자 */}
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Link href={href} className="block text-sm font-medium text-gray-800 hover:text-blue-600 truncate leading-snug flex-1 min-w-0">
                    {w.title}
                  </Link>
                  {/* 모바일: 구독 취소 버튼 */}
                  <button
                    onClick={() => handleUnwatch(w.ticket_iid, w.project_id)}
                    disabled={isUnwatching}
                    className="sm:hidden shrink-0 text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors text-base leading-none mt-0.5"
                    title="구독 취소"
                  >
                    {isUnwatching ? '⏳' : '🔕'}
                  </button>
                </div>
                {w.assignee_name && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">담당: {w.assignee_name}</p>
                )}
                {/* 모바일: 상태·우선순위·구독일 인라인 */}
                <div className="flex gap-1.5 mt-1.5 sm:hidden flex-wrap items-center">
                  <StatusBadge status={w.status} />
                  <PriorityBadge priority={w.priority} />
                  <span className="text-xs text-gray-300 ml-1">{formatDate(w.subscribed_at ?? '')}</span>
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
              <div className="hidden lg:flex items-center text-xs text-gray-400 whitespace-nowrap">
                {formatDate(w.subscribed_at ?? '')}
              </div>

              {/* 구독 취소 버튼 */}
              <div className="hidden sm:flex justify-center">
                <button
                  onClick={() => handleUnwatch(w.ticket_iid, w.project_id)}
                  disabled={isUnwatching}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="구독 취소"
                >
                  {isUnwatching ? (
                    <span className="animate-spin text-xs">⏳</span>
                  ) : (
                    <><span>🔕</span><span className="hidden sm:inline">취소</span></>
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="px-5 py-3 bg-gray-50 border-t text-xs text-gray-400 flex items-center justify-between">
        <span>총 <strong className="text-gray-700">{watches.length}</strong>개 구독 중</span>
        <span>구독 티켓의 상태 변경·댓글 발생 시 이메일로 알림을 받습니다.</span>
      </div>
    </div>
  )
}

/* ─── 메인 페이지 ───────────────────────────────────────── */

type TabId = 'prefs' | 'watches'

function NotificationsContent() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabId>(
    searchParams.get('tab') === 'prefs' ? 'prefs' : 'watches'
  )

  // 이미 페이지가 열린 상태에서 URL 파라미터 변경 시 탭 동기화
  useEffect(() => {
    setTab(searchParams.get('tab') === 'prefs' ? 'prefs' : 'watches')
  }, [searchParams])

  return (
    <div className="w-full">
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">알림 & 구독 관리</h1>
        <p className="text-sm text-gray-500 mt-1">알림 수신 설정과 구독 중인 티켓을 관리합니다.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b mb-6">
        {([
          { id: 'watches', label: '🔔 구독 중인 티켓' },
          { id: 'prefs',   label: '⚙️ 알림 수신 설정' },
        ] as { id: TabId; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
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
