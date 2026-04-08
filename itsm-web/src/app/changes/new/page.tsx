'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import { createChange } from '@/lib/api'

const CHANGE_TYPES = [
  {
    value: 'standard',
    label: '정형',
    sub: 'Standard',
    desc: '사전 승인된 절차',
    icon: '✅',
    color: 'border-slate-400 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300',
    active: 'border-slate-500 bg-slate-100 dark:bg-slate-700 ring-2 ring-slate-400',
  },
  {
    value: 'normal',
    label: '일반',
    sub: 'Normal',
    desc: 'CAB 심의 필요',
    icon: '📋',
    color: 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    active: 'border-blue-500 bg-blue-100 dark:bg-blue-900/50 ring-2 ring-blue-400',
  },
  {
    value: 'emergency',
    label: '긴급',
    sub: 'Emergency',
    desc: '즉시 처리 필요',
    icon: '🚨',
    color: 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    active: 'border-red-500 bg-red-100 dark:bg-red-900/50 ring-2 ring-red-400',
  },
]

const RISK_LEVELS = [
  { value: 'low',      label: '낮음',    color: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',  active: 'ring-2 ring-green-400 bg-green-200 dark:bg-green-800/50' },
  { value: 'medium',   label: '중간',    color: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700', active: 'ring-2 ring-yellow-400 bg-yellow-200 dark:bg-yellow-800/50' },
  { value: 'high',     label: '높음',    color: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700', active: 'ring-2 ring-orange-400 bg-orange-200 dark:bg-orange-800/50' },
  { value: 'critical', label: '치명적',  color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',       active: 'ring-2 ring-red-500 bg-red-200 dark:bg-red-800/50' },
]

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
    if (!form.title.trim()) { setError('제목을 입력해주세요.'); return }
    if (form.scheduled_start_at && form.scheduled_end_at && form.scheduled_end_at <= form.scheduled_start_at) {
      setError('종료 예정 시각은 시작 예정 시각 이후여야 합니다.')
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
      router.push(`/changes/${cr.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedType = CHANGE_TYPES.find(t => t.value === form.change_type)!
  const selectedRisk = RISK_LEVELS.find(r => r.value === form.risk_level)!

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-1">
        <Link href="/changes" className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
          변경관리
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm text-gray-600 dark:text-gray-300">새 요청</span>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span className="text-2xl">🔄</span> 새 변경 요청
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            ITIL 기반 RFC — 초안 저장 후 제출하면 심의가 시작됩니다
          </p>
        </div>
        {/* 워크플로 힌트 */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-1.5">
          {['초안', '제출', '심의', '승인', '구현'].map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span>→</span>}
              <span className={i === 0 ? 'font-semibold text-blue-500' : ''}>{s}</span>
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

          {/* ── 왼쪽 메인 영역 ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* 제목 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <Field label="제목" hint="*필수">
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="변경 사항을 간략히 설명하세요"
                  className={inputCls + ' text-base py-3'}
                  autoFocus
                />
              </Field>
            </div>

            {/* 변경 유형 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <p className={labelCls}>변경 유형</p>
              <div className="grid grid-cols-3 gap-3">
                {CHANGE_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, change_type: t.value }))}
                    className={`rounded-xl border p-3 text-left transition-all ${t.color} ${form.change_type === t.value ? t.active : 'opacity-70 hover:opacity-100'}`}
                  >
                    <div className="text-xl mb-1">{t.icon}</div>
                    <div className="font-semibold text-sm">{t.label}</div>
                    <div className="text-xs opacity-75">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 위험도 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
              <p className={labelCls}>위험도</p>
              <div className="flex flex-wrap gap-2">
                {RISK_LEVELS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, risk_level: r.value }))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${r.color} ${form.risk_level === r.value ? r.active : 'opacity-60 hover:opacity-90'}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {form.risk_level === 'critical' && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
                  <span>⚠️</span> 치명적 위험도는 긴급 CAB 소집이 필요할 수 있습니다
                </p>
              )}
            </div>

            {/* 내용 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <span>📝</span> 변경 내용
              </h2>

              <Field label="상세 설명">
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={4}
                  placeholder="변경 이유, 목적, 세부 내용을 설명하세요"
                  className={inputCls}
                />
              </Field>

              <Field label="영향 범위" hint="(선택)">
                <textarea
                  value={form.impact}
                  onChange={e => setForm(f => ({ ...f, impact: e.target.value }))}
                  rows={2}
                  placeholder="영향받는 시스템·서비스·사용자를 기술하세요"
                  className={inputCls}
                />
              </Field>

              <Field label="롤백 계획" hint="(선택)">
                <textarea
                  value={form.rollback_plan}
                  onChange={e => setForm(f => ({ ...f, rollback_plan: e.target.value }))}
                  rows={2}
                  placeholder="변경 실패 시 원복 절차를 기술하세요"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {/* ── 오른쪽 사이드바 ── */}
          <div className="space-y-5">

            {/* 요약 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">선택 요약</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">유형</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${selectedType.color}`}>
                    {selectedType.icon} {selectedType.label}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">위험도</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${selectedRisk.color}`}>
                    {selectedRisk.label}
                  </span>
                </div>
              </div>
            </div>

            {/* 일정 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                <span>📅</span> 구현 일정
              </h3>
              <Field label="시작 예정">
                <input
                  type="datetime-local"
                  value={form.scheduled_start_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_start_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="종료 예정">
                <input
                  type="datetime-local"
                  value={form.scheduled_end_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_end_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
            </div>

            {/* 연결 카드 */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                <span>🔗</span> 연결
              </h3>
              <Field label="관련 티켓 번호" hint="(선택)">
                <input
                  type="number"
                  value={form.related_ticket_iid}
                  onChange={e => setForm(f => ({ ...f, related_ticket_iid: e.target.value }))}
                  placeholder="관련 티켓 번호"
                  className={inputCls}
                  min={1}
                />
              </Field>
            </div>

            {/* 액션 버튼 */}
            <div className="space-y-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <><span className="animate-spin">⏳</span> 제출 중...</>
                ) : (
                  <><span>🚀</span> 변경 요청 제출</>
                )}
              </button>
              <button
                type="button"
                onClick={e => handleSubmit(e as unknown as React.FormEvent, true)}
                disabled={submitting}
                className="w-full py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <span>💾</span> 초안으로 저장
              </button>
              <Link
                href="/changes"
                className="block w-full py-2.5 text-sm font-medium text-center text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors"
              >
                취소
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
