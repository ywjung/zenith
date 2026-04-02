'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'
import { ROLE_LABELS } from '@/lib/constants'
import SessionManager from '@/components/SessionManager'
import { uploadAvatar, deleteAvatar, fetchPushVapidKey, fetchPushStatus, subscribePush, unsubscribePush, listNotificationRules, createNotificationRule, updateNotificationRule, deleteNotificationRule } from '@/lib/api'
import type { NotificationRule, NotificationRuleCreate } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MyStats {
  created: number
  resolved: number
}

interface NotifPrefs {
  ticket_created?: { email?: boolean; inapp?: boolean }
  status_changed?: { email?: boolean; inapp?: boolean }
  comment_added?: { email?: boolean; inapp?: boolean }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoleBadgeClass(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
    case 'agent':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400'
    case 'developer':
      return 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400'
    case 'pl':
      return 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
  }
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function ProfileContent() {
  const { user } = useAuth()
  const router = useRouter()
  const t = useTranslations('profile')

  const [stats, setStats] = useState<MyStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [prefs, setPrefs] = useState<NotifPrefs>({})
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)

  const [error, setError] = useState('')

  // 아바타 업로드
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url ?? null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) setAvatarUrl(user.avatar_url ?? null)
  }, [user])

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    setError('')
    try {
      const result = await uploadAvatar(file)
      setAvatarUrl(result.avatar_url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '아바타 업로드 실패')
    } finally {
      setAvatarUploading(false)
      // input 초기화 (같은 파일 재선택 허용)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }, [])

  // 내 활동 통계 로드
  useEffect(() => {
    if (!user) return
    const username = user.username
    // 티켓 목록에서 내가 만든 것과 내가 종료한 것을 집계
    // /tickets/ 응답은 X-Total 헤더가 아닌 JSON body의 total 필드를 사용함
    Promise.all([
      fetch(`${API_BASE}/tickets/?created_by_username=${encodeURIComponent(username)}&per_page=1`, {
        credentials: 'include',
      }),
      fetch(`${API_BASE}/tickets/?created_by_username=${encodeURIComponent(username)}&state=closed&per_page=1`, {
        credentials: 'include',
      }),
    ])
      .then(async ([createdRes, resolvedRes]) => {
        const createdData = createdRes.ok ? await createdRes.json().catch(() => ({})) : {}
        const resolvedData = resolvedRes.ok ? await resolvedRes.json().catch(() => ({})) : {}
        setStats({
          created: createdData.total ?? 0,
          resolved: resolvedData.total ?? 0,
        })
      })
      .catch(() => setStats({ created: 0, resolved: 0 }))
      .finally(() => setStatsLoading(false))
  }, [user])

  // 알림 설정 로드
  useEffect(() => {
    fetch(`${API_BASE}/notifications/prefs`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : {}))
      .then((data: NotifPrefs) => setPrefs(data))
      .catch(() => setPrefs({}))
      .finally(() => setPrefsLoading(false))
  }, [])

  // 알림 설정 토글
  const togglePref = useCallback(
    (event: string, channel: 'email' | 'inapp') => {
      setPrefs(prev => {
        const current = prev[event as keyof NotifPrefs] ?? {}
        return {
          ...prev,
          [event]: {
            ...current,
            [channel]: !current[channel as keyof typeof current],
          },
        }
      })
    },
    [],
  )

  // Web Push 구독 상태
  const [pushEnabled, setPushEnabled] = useState(false)   // 서버에서 VAPID 설정됨
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushError, setPushError] = useState('')

  // 커스텀 알림 규칙
  const [notifRules, setNotifRules] = useState<NotificationRule[]>([])
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editRule, setEditRule] = useState<NotificationRule | null>(null)
  const [ruleForm, setRuleForm] = useState<NotificationRuleCreate>({
    name: '', enabled: true,
    match_priorities: [], match_categories: [], match_states: [],
    match_sla_warning: false,
    notify_in_app: true, notify_email: false, notify_push: false,
  })
  const [ruleSaving, setRuleSaving] = useState(false)

  useEffect(() => {
    fetchPushStatus()
      .then(s => {
        setPushEnabled(s.enabled)
        setPushSubscribed(s.subscriptions > 0)
      })
      .catch(() => {})
    listNotificationRules()
      .then(res => setNotifRules(res.rules))
      .catch(() => {})
  }, [])

  const togglePushSubscription = useCallback(async () => {
    setPushLoading(true)
    setPushError('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushError('이 브라우저는 Web Push를 지원하지 않습니다.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      if (pushSubscribed) {
        // 구독 해제
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          const keys = sub.toJSON().keys as { p256dh: string; auth: string }
          await unsubscribePush({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth })
          await sub.unsubscribe()
        }
        setPushSubscribed(false)
      } else {
        // 구독 등록
        const { publicKey } = await fetchPushVapidKey()
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          setPushError('알림 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.')
          return
        }
        const urlBase64ToUint8Array = (base64: string) => {
          const padding = '='.repeat((4 - (base64.length % 4)) % 4)
          const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
          const raw = atob(b64)
          return Uint8Array.from(Array.from(raw).map(c => c.charCodeAt(0)))
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
        const json = sub.toJSON()
        const keys = json.keys as { p256dh: string; auth: string }
        await subscribePush({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth })
        setPushSubscribed(true)
      }
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Web Push 오류가 발생했습니다.')
    } finally {
      setPushLoading(false)
    }
  }, [pushSubscribed])

  // 알림 설정 저장
  const savePrefs = useCallback(async () => {
    setPrefsSaving(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/notifications/prefs`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (!r.ok) throw new Error('저장 실패')
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2500)
    } catch {
      setError(t('save_error'))
    } finally {
      setPrefsSaving(false)
    }
  }, [prefs])

  if (!user) return null

  const roleLabel = (ROLE_LABELS as Record<string, string>)[user.role] ?? user.role

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        >
          ←
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
      </div>

      {/* 에러 */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 프로필 카드 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-center gap-4">
          {/* 아바타 (업로드 가능) */}
          <div className="relative group shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user.name}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
                {(user.name || user.username).charAt(0).toUpperCase()}
              </div>
            )}

            {/* 호버 오버레이 */}
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
              title="아바타 변경"
            >
              {avatarUploading ? (
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>

            {/* 숨겨진 파일 input */}
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>

          {/* 이름 · 이메일 · 역할 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {user.name || user.username}
              </h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeClass(user.role)}`}
              >
                {roleLabel}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              @{user.username}
            </p>
            {user.email && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {user.email}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 내 활동 통계 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('stats_title')}</h3>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-700">
          <div className="px-6 py-5 text-center">
            {statsLoading ? (
              <div className="h-8 w-12 mx-auto bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {stats?.created ?? 0}
              </p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('created_tickets')}</p>
          </div>
          <div className="px-6 py-5 text-center">
            {statsLoading ? (
              <div className="h-8 w-12 mx-auto bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {stats?.resolved ?? 0}
              </p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('resolved_tickets')}</p>
          </div>
        </div>
      </div>

      {/* 알림 설정 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('notif_settings')}</h3>
          {prefsSaved && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              {t('saved')}
            </span>
          )}
        </div>

        {prefsLoading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            {t('loading')}
          </div>
        ) : (
          <>
            {/* 헤더 행 */}
            <div className="grid grid-cols-3 gap-2 px-5 py-2 text-xs text-gray-500 dark:text-gray-400 font-medium border-b border-gray-50 dark:border-gray-800">
              <span>{t('col_event')}</span>
              <span className="text-center">{t('col_email')}</span>
              <span className="text-center">{t('col_inapp')}</span>
            </div>

            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {(['ticket_created', 'status_changed', 'comment_added'] as const).map((eventKey) => {
                const ev = prefs[eventKey as keyof NotifPrefs] ?? {}
                return (
                  <div
                    key={eventKey}
                    className="grid grid-cols-3 gap-2 items-center px-5 py-3"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">{t(('event_' + eventKey) as Parameters<typeof t>[0])}</span>
                    {(['email', 'inapp'] as const).map(channel => (
                      <div key={channel} className="flex justify-center">
                        <button
                          role="switch"
                          aria-checked={!!ev[channel]}
                          onClick={() => togglePref(eventKey, channel)}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            ev[channel]
                              ? 'bg-blue-600'
                              : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                              ev[channel] ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <button
                onClick={savePrefs}
                disabled={prefsSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {prefsSaving ? t('saving') : t('save')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Web Push 알림 */}
      {pushEnabled && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">브라우저 푸시 알림</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            티켓 상태 변경 시 이 브라우저로 알림을 받습니다.
          </p>
          {pushError && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{pushError}</p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${pushSubscribed ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {pushSubscribed ? '구독 중' : '구독 안 함'}
              </span>
            </div>
            <button
              onClick={togglePushSubscription}
              disabled={pushLoading}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50
                ${pushSubscribed
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
            >
              {pushLoading ? '처리 중...' : pushSubscribed ? '구독 해제' : '구독하기'}
            </button>
          </div>
        </div>
      )}

      {/* 커스텀 알림 규칙 */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">🔔 커스텀 알림 규칙</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">조건에 맞는 티켓 이벤트에만 알림을 받도록 설정합니다.</p>
          </div>
          <button
            onClick={() => {
              setEditRule(null)
              setRuleForm({ name: '', enabled: true, match_priorities: [], match_categories: [], match_states: [], match_sla_warning: false, notify_in_app: true, notify_email: false, notify_push: false })
              setShowRuleModal(true)
            }}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
          >
            + 규칙 추가
          </button>
        </div>
        {notifRules.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">설정된 규칙이 없습니다. 기본 알림 설정만 적용됩니다.</p>
        ) : (
          <div className="space-y-2">
            {notifRules.map(rule => (
              <div key={rule.id} className={`flex items-center gap-3 p-3 rounded-lg border ${rule.enabled ? 'border-blue-200 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30'}`}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={async e => {
                    const updated = await updateNotificationRule(rule.id, { enabled: e.target.checked })
                    setNotifRules(prev => prev.map(r => r.id === rule.id ? updated : r))
                  }}
                  className="rounded text-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{rule.name}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {rule.match_priorities.map(p => <span key={p} className="text-[10px] px-1 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded">{p}</span>)}
                    {rule.match_categories.map(c => <span key={c} className="text-[10px] px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">{c}</span>)}
                    {rule.match_sla_warning && <span className="text-[10px] px-1 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">SLA임박</span>}
                    <span className="text-[10px] text-gray-400 dark:text-gray-600 ml-1">→ {[rule.notify_in_app && '앱', rule.notify_email && '이메일', rule.notify_push && '푸시'].filter(Boolean).join(' ')}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setEditRule(rule)
                      setRuleForm({ name: rule.name, enabled: rule.enabled, match_priorities: rule.match_priorities, match_categories: rule.match_categories, match_states: rule.match_states, match_sla_warning: rule.match_sla_warning, notify_in_app: rule.notify_in_app, notify_email: rule.notify_email, notify_push: rule.notify_push })
                      setShowRuleModal(true)
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >수정</button>
                  <button
                    onClick={async () => {
                      await deleteNotificationRule(rule.id)
                      setNotifRules(prev => prev.filter(r => r.id !== rule.id))
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 알림 규칙 편집 모달 */}
      {showRuleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{editRule ? '알림 규칙 수정' : '새 알림 규칙'}</h3>
            </div>
            <div className="p-5 space-y-4">
              <input
                placeholder="규칙 이름 *"
                value={ruleForm.name}
                onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
                className="w-full text-sm border dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">우선순위 조건 (비어있으면 모두)</p>
                <div className="flex flex-wrap gap-1.5">
                  {['critical', 'high', 'medium', 'low'].map(p => (
                    <label key={p} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={ruleForm.match_priorities.includes(p)} onChange={e => setRuleForm(f => ({ ...f, match_priorities: e.target.checked ? [...f.match_priorities, p] : f.match_priorities.filter(x => x !== p) }))} className="rounded text-blue-600" />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={ruleForm.match_sla_warning} onChange={e => setRuleForm(f => ({ ...f, match_sla_warning: e.target.checked }))} className="rounded text-red-500" />
                  SLA 임박 시에만
                </label>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">알림 채널</p>
                <div className="flex gap-3">
                  {[['notify_in_app', '앱 내'], ['notify_email', '이메일'], ['notify_push', 'Web Push']].map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={ruleForm[k as keyof NotificationRuleCreate] as boolean} onChange={e => setRuleForm(f => ({ ...f, [k]: e.target.checked }))} className="rounded text-blue-600" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-5 border-t dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setShowRuleModal(false)} className="text-sm px-4 py-2 border dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">취소</button>
              <button
                disabled={!ruleForm.name.trim() || ruleSaving}
                onClick={async () => {
                  setRuleSaving(true)
                  try {
                    if (editRule) {
                      const updated = await updateNotificationRule(editRule.id, ruleForm)
                      setNotifRules(prev => prev.map(r => r.id === editRule.id ? updated : r))
                    } else {
                      const created = await createNotificationRule(ruleForm)
                      setNotifRules(prev => [...prev, created])
                    }
                    setShowRuleModal(false)
                  } catch (err) {
                    alert(err instanceof Error ? err.message : '저장 실패')
                  } finally {
                    setRuleSaving(false)
                  }
                }}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >{ruleSaving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 활성 세션 */}
      <SessionManager />
    </div>
  )
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  )
}
