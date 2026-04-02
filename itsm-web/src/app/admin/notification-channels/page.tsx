'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useTranslations } from 'next-intl'

interface ChannelState {
  email_enabled: boolean
  telegram_enabled: boolean
  slack_enabled: boolean
  email_configured: boolean
  telegram_configured: boolean
  slack_configured: boolean
}

function ToggleRow({
  icon,
  label,
  description,
  enabled,
  configured,
  configuredLabel,
  unconfiguredLabel,
  unconfiguredHint,
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
  unconfiguredHint: string
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
            {unconfiguredHint}
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
  const t = useTranslations('admin')
  const [state, setState] = useState<ChannelState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/admin/notification-channels`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setState)
      .catch(() => setError(t('notification_channels.load_error')))
      .finally(() => setLoading(false))
  }, [t])

  const CHANNEL_LABELS: Record<string, string> = {
    email_enabled: '이메일',
    telegram_enabled: '텔레그램',
    slack_enabled: 'Slack',
  }

  const toggle = async (field: 'email_enabled' | 'telegram_enabled' | 'slack_enabled', value: boolean) => {
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
      setSuccessMsg(t('notification_channels.toggle_success', {
        channel: CHANNEL_LABELS[field] ?? field,
        status: value ? t('notification_channels.toggle_activated') : t('notification_channels.toggle_deactivated'),
      }))
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('notification_channels.save_failed'))
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
        {t('common.loading')}
      </div>
    )
  }

  if (!state) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg text-sm">{error || t('common.error')}</div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {t('notification_channels.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('notification_channels.description')}
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
          label={t('notification_channels.email_label')}
          description={t('notification_channels.email_description')}
          enabled={state.email_enabled}
          configured={state.email_configured}
          configuredLabel={t('notification_channels.email_configured')}
          unconfiguredLabel={t('notification_channels.email_unconfigured')}
          unconfiguredHint={t('notification_channels.unconfigured_hint')}
          onToggle={v => toggle('email_enabled', v)}
          loading={saving === 'email_enabled'}
        />
        <ToggleRow
          icon="✈️"
          label={t('notification_channels.telegram_label')}
          description={t('notification_channels.telegram_description')}
          enabled={state.telegram_enabled}
          configured={state.telegram_configured}
          configuredLabel={t('notification_channels.telegram_configured')}
          unconfiguredLabel={t('notification_channels.telegram_unconfigured')}
          unconfiguredHint={t('notification_channels.unconfigured_hint')}
          onToggle={v => toggle('telegram_enabled', v)}
          loading={saving === 'telegram_enabled'}
        />
        <ToggleRow
          icon="💬"
          label={t('notification_channels.slack_label')}
          description={t('notification_channels.slack_description')}
          enabled={state.slack_enabled}
          configured={state.slack_configured}
          configuredLabel={t('notification_channels.slack_configured')}
          unconfiguredLabel={t('notification_channels.slack_unconfigured')}
          unconfiguredHint={t('notification_channels.unconfigured_hint')}
          onToggle={v => toggle('slack_enabled', v)}
          loading={saving === 'slack_enabled'}
        />
      </div>

      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p className="font-medium text-gray-600 dark:text-gray-300 mb-2">{t('notification_channels.how_it_works')}</p>
        <p>• {t('notification_channels.how_1')}</p>
        <p>• {t('notification_channels.how_2')}</p>
        <p>• {t('notification_channels.how_3')}</p>
        <p>• Slack은 <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">SLACK_WEBHOOK_URL</code> 환경 변수에 Incoming Webhook URL을 설정해야 합니다.</p>
        <p>• 이메일 템플릿별 개별 비활성화는 <a href="/admin/email-templates" className="text-blue-600 underline">이메일 템플릿</a> 메뉴에서 설정하세요.</p>
      </div>
    </div>
  )
}
