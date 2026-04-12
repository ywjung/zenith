'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import RequireAuth from '@/components/RequireAuth'
import SpinnerIcon from '@/components/SpinnerIcon'
import { createChange } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

const CHANGE_TYPES = [
  {
    value: 'standard',
    labelKey: 'type_standard',
    descKey: 'type_standard_desc',
    sub: 'Standard',
    icon: '✅',
    color: 'border-slate-400 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300',
    active: 'border-slate-500 bg-slate-100 dark:bg-slate-700 ring-2 ring-slate-400',
  },
  {
    value: 'normal',
    labelKey: 'type_normal',
    descKey: 'type_normal_desc',
    sub: 'Normal',
    icon: '📋',
    color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    active: 'border-blue-500 bg-blue-100 dark:bg-blue-900/50 ring-2 ring-blue-400',
  },
  {
    value: 'emergency',
    labelKey: 'type_emergency',
    descKey: 'type_emergency_desc',
    sub: 'Emergency',
    icon: '🚨',
    color: 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    active: 'border-red-500 bg-red-100 dark:bg-red-900/50 ring-2 ring-red-400',
  },
] as const

const RISK_LEVELS = [
  { value: 'low',      labelKey: 'risk_low',      color: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',       active: 'ring-2 ring-green-400 bg-green-200 dark:bg-green-800/50' },
  { value: 'medium',   labelKey: 'risk_medium',   color: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700', active: 'ring-2 ring-yellow-400 bg-yellow-200 dark:bg-yellow-800/50' },
  { value: 'high',     labelKey: 'risk_high',     color: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700', active: 'ring-2 ring-orange-400 bg-orange-200 dark:bg-orange-800/50' },
  { value: 'critical', labelKey: 'risk_critical', color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',                   active: 'ring-2 ring-red-500 bg-red-200 dark:bg-red-800/50' },
] as const

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-500'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {hint && <span className="ml-1 text-xs font-normal text-gray-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function NewChangeContent() {
  const t = useTranslations('changes_new')
  const router = useRouter()

  const [form, setForm] = useState({
    title: '',
    description: '',
    change_type: 'normal',
    risk_level: 'medium',
    impact: '',
    rollback_plan: '',
    scheduled_start_at: '',
    scheduled_end_at: '',
    related_ticket_iid: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const projectId = process.env.NEXT_PUBLIC_GITLAB_PROJECT_ID ?? '1'

  const handleSubmit = async (e: React.FormEvent, asDraft: boolean) => {
    e.preventDefault()
    if (!form.title.trim()) { setError(t('title_required')); return }
    if (form.scheduled_start_at && form.scheduled_end_at && form.scheduled_end_at <= form.scheduled_start_at) {
      setError(t('schedule_order_error'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const cr = await createChange({
        title: form.title.trim(),
        description: form.description || undefined,
        change_type: form.change_type,
        risk_level: form.risk_level,
        impact: form.impact || undefined,
        rollback_plan: form.rollback_plan || undefined,
        scheduled_start_at: form.scheduled_start_at || undefined,
        scheduled_end_at: form.scheduled_end_at || undefined,
        related_ticket_iid: form.related_ticket_iid && !isNaN(Number(form.related_ticket_iid)) ? Number(form.related_ticket_iid) : undefined,
        project_id: projectId,
      })
      if (!asDraft) {
        const { transitionChange } = await import('@/lib/api')
        await transitionChange(cr.id, 'submitted')
      }
      toast.success(asDraft ? t('draft_saved') : t('submitted'))
      router.push(`/changes/${cr.id}`)
    } catch (err: unknown) {
      const msg = errorMessage(err, t('generic_error'))
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedType = CHANGE_TYPES.find(tp => tp.value === form.change_type)!
  const selectedRisk = RISK_LEVELS.find(r => r.value === form.risk_level)!
  const typeLabel = (v: string) => t(CHANGE_TYPES.find(tp => tp.value === v)!.labelKey as 'type_standard')
  const riskLabel = (v: string) => t(RISK_LEVELS.find(r => r.value === v)!.labelKey as 'risk_low')

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link href="/changes" className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
          {t('breadcrumb_changes')}
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm text-gray-600 dark:text-gray-300">{t('breadcrumb_new')}</span>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-2xl">🔄</span> {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-1.5">
          {(['wf_draft', 'wf_submit', 'wf_review', 'wf_approve', 'wf_implement'] as const).map((k, i) => (
            <span key={k} className="flex items-center gap-1">
              {i > 0 && <span>→</span>}
              <span className={i === 0 ? 'font-semibold text-blue-500' : ''}>{t(k)}</span>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}

      <form onSubmit={e => handleSubmit(e, false)}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          <div className="lg:col-span-2 space-y-5">

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <Field label={t('field_title')} hint={t('hint_required')}>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={t('title_placeholder')}
                  className={inputCls + ' text-base py-3'}
                  autoFocus
                />
              </Field>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <p className={labelCls}>{t('type_header')}</p>
              <div className="grid grid-cols-3 gap-3">
                {CHANGE_TYPES.map(tp => (
                  <button
                    key={tp.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, change_type: tp.value }))}
                    className={`rounded-xl border p-3 text-left transition-all ${tp.color} ${form.change_type === tp.value ? tp.active : 'opacity-70 hover:opacity-100'}`}
                  >
                    <div className="text-xl mb-1">{tp.icon}</div>
                    <div className="font-semibold text-sm">{t(tp.labelKey as 'type_standard')}</div>
                    <div className="text-xs opacity-75">{t(tp.descKey as 'type_standard_desc')}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <p className={labelCls}>{t('risk_header')}</p>
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, risk_level: r.value }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${r.color} ${form.risk_level === r.value ? r.active : 'opacity-60 hover:opacity-90'}`}
                  >
                    {t(r.labelKey as 'risk_low')}
                  </button>
                ))}
              </div>
              {form.risk_level === 'critical' && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
                  <span>⚠️</span> {t('critical_hint')}
                </p>
              )}
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                {t('content_header')}
              </h2>

              <Field label={t('field_description')}>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={6}
                  placeholder={t('desc_placeholder')}
                  className={inputCls}
                />
              </Field>

              <Field label={t('field_impact')} hint={t('hint_optional')}>
                <textarea
                  value={form.impact}
                  onChange={e => setForm(f => ({ ...f, impact: e.target.value }))}
                  rows={3}
                  placeholder={t('impact_placeholder')}
                  className={inputCls}
                />
              </Field>

              <Field label={t('field_rollback')} hint={t('hint_optional')}>
                <textarea
                  value={form.rollback_plan}
                  onChange={e => setForm(f => ({ ...f, rollback_plan: e.target.value }))}
                  rows={3}
                  placeholder={t('rollback_placeholder')}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-5">

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{t('summary_header')}</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{t('summary_type')}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${selectedType.color}`}>
                    {selectedType.icon} {typeLabel(selectedType.value)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{t('summary_risk')}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${selectedRisk.color}`}>
                    {riskLabel(selectedRisk.value)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                {t('schedule_header')}
              </h3>
              <Field label={t('field_start')}>
                <input
                  type="datetime-local"
                  value={form.scheduled_start_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_start_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label={t('field_end')}>
                <input
                  type="datetime-local"
                  value={form.scheduled_end_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_end_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                {t('link_header')}
              </h3>
              <Field label={t('field_related')} hint={t('hint_optional')}>
                <input
                  type="number"
                  value={form.related_ticket_iid}
                  onChange={e => setForm(f => ({ ...f, related_ticket_iid: e.target.value }))}
                  placeholder={t('related_placeholder')}
                  className={inputCls}
                  min={1}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <><SpinnerIcon className="w-4 h-4" /> {t('submitting')}</>
                ) : (
                  <>{t('submit')}</>
                )}
              </button>
              <button
                type="button"
                onClick={e => handleSubmit(e as unknown as React.FormEvent, true)}
                disabled={submitting}
                className="w-full py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {t('save_draft')}
              </button>
              <Link
                href="/changes"
                className="block w-full py-2.5 text-sm font-medium text-center text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                {t('cancel')}
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function NewChangePage() {
  return (
    <RequireAuth>
      <NewChangeContent />
    </RequireAuth>
  )
}
