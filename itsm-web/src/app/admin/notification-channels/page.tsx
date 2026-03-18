'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface ChannelState {
  email_enabled: boolean
  telegram_enabled: boolean
  email_configured: boolean
  telegram_configured: boolean
}

function ToggleRow({
  icon,
  label,
  description,
  enabled,
  configured,
  configuredLabel,
  unconfiguredLabel,
  onToggle,
  loading,
}: {
  icon: string
  label: string
  description: string
  enabled: boolean
  configured: boolean
  configuredLabel: string
  unconfiguredLabel: string
  onToggle: (v: boolean) => void
  loading: boolean
}) {
  return (
    <div className="flex items-start gap-4 p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div className="text-3xl pt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-gray-900 dark:text-white">{label}</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              configured
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
            }`}
          >
            {configured ? configuredLabel : unconfiguredLabel}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        {!configured && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            환경 변수가 설정되지 않아 실제 발송은 비활성 상태입니다. 활성화하더라도 발송되지 않습니다.
          </p>
        )}
      </div>
      <button
        disabled={loading}
        onClick={() => onToggle(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
          enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export default function NotificationChannelsPage() {
  const [state, setState] = useState<ChannelState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/admin/notification-channels`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setState)
      .catch(() => setError('설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async (field: 'email_enabled' | 'telegram_enabled', value: boolean) => {
    if (!state) return
    setSaving(field)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/notification-channels`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
      setState(prev => prev ? { ...prev, [field]: value } : prev)
      setSuccessMsg(`${field === 'email_enabled' ? '이메일' : '텔레그램'} 알림이 ${value ? '활성화' : '비활성화'}되었습니다.`)
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
        불러오는 중…
      </div>
    )
  }

  if (!state) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error || '오류가 발생했습니다.'}</div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">알림 채널 설정</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          이메일 및 텔레그램 발송을 런타임에 켜거나 끌 수 있습니다.
          SMTP / Bot Token 등 인프라 환경 변수 설정은 별도로 필요합니다.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error}</div>
      )}
      {successMsg && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="space-y-3">
        <ToggleRow
          icon="📧"
          label="이메일 알림"
          description="티켓 생성·상태 변경·댓글·SLA 경고 등 이벤트 발생 시 관련 사용자에게 이메일을 발송합니다."
          enabled={state.email_enabled}
          configured={state.email_configured}
          configuredLabel="SMTP 설정됨"
          unconfiguredLabel="SMTP 미설정"
          onToggle={v => toggle('email_enabled', v)}
          loading={saving === 'email_enabled'}
        />
        <ToggleRow
          icon="✈️"
          label="텔레그램 알림"
          description="IT 팀 채널로 티켓 생성·SLA 위반 등 주요 이벤트를 텔레그램 메시지로 전송합니다."
          enabled={state.telegram_enabled}
          configured={state.telegram_configured}
          configuredLabel="Bot 설정됨"
          unconfiguredLabel="Bot 미설정"
          onToggle={v => toggle('telegram_enabled', v)}
          loading={saving === 'telegram_enabled'}
        />
      </div>

      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p className="font-medium text-gray-600 dark:text-gray-300 mb-2">📋 동작 방식</p>
        <p>• 환경 변수(NOTIFICATION_ENABLED / TELEGRAM_ENABLED)가 비활성화된 경우 이 설정과 무관하게 발송되지 않습니다.</p>
        <p>• 환경 변수가 활성화된 경우 이 토글로 런타임에 발송을 제어할 수 있습니다.</p>
        <p>• 변경 사항은 즉시 반영되며 최대 60초 내에 모든 서버에 적용됩니다.</p>
        <p>• 이메일 템플릿별 개별 비활성화는 <a href="/admin/email-templates" className="text-blue-600 underline">이메일 템플릿</a> 메뉴에서 설정하세요.</p>
      </div>
    </div>
  )
}
