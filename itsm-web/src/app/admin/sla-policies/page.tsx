'use client'

import { useEffect, useState } from 'react'
import { fetchSLAPolicies, updateSLAPolicy } from '@/lib/api'
import type { SLAPolicy } from '@/types'
import { useAuth } from '@/context/AuthContext'

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']

const PRIORITY_META: Record<string, {
  label: string; icon: string; color: string; bg: string; border: string; bar: string; desc: string
}> = {
  critical: { label: '긴급', icon: '🔴', color: 'text-red-700 dark:text-red-300',    bg: 'bg-red-50 dark:bg-red-900/20',    border: 'border-red-200 dark:border-red-700',    bar: 'bg-red-400',    desc: '업무 전체 중단 · 즉시 대응' },
  high:     { label: '높음', icon: '🟠', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-700', bar: 'bg-orange-400', desc: '주요 기능 장애 · 빠른 처리 필요' },
  medium:   { label: '보통', icon: '🟡', color: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-700', bar: 'bg-yellow-400', desc: '일부 불편 · 업무 지속 가능' },
  low:      { label: '낮음', icon: '⚪', color: 'text-gray-600 dark:text-gray-400',   bg: 'bg-gray-50 dark:bg-gray-800/50',   border: 'border-gray-200 dark:border-gray-700',   bar: 'bg-gray-400',   desc: '사소한 개선 요청' },
}

function hoursDisplay(h: number) {
  if (h < 24) return `${h}시간`
  const d = Math.floor(h / 24)
  const rem = h % 24
  return rem ? `${d}일 ${rem}시간` : `${d}일`
}

function SLAPoliciesContent() {
  const { isAdmin } = useAuth()
  const [policies, setPolicies] = useState<SLAPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ response_hours: 0, resolve_hours: 0 })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    fetchSLAPolicies()
      .then(setPolicies)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500">관리자 권한이 필요합니다.</p>
      </div>
    )
  }

  function startEdit(policy: SLAPolicy) {
    setEditing(policy.priority)
    setEditValues({ response_hours: policy.response_hours, resolve_hours: policy.resolve_hours })
    setSaveError(null)
  }

  async function handleSave(priority: string) {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateSLAPolicy(priority, editValues)
      setPolicies((prev) => prev.map((p) => p.priority === priority ? updated : p))
      setEditing(null)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const maxResolve = Math.max(...policies.map((p) => p.resolve_hours), 1)
  const ordered = PRIORITY_ORDER
    .map((p) => policies.find((pol) => pol.priority === p))
    .filter((p): p is SLAPolicy => !!p)

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        우선순위별 SLA 목표 시간을 설정합니다. 변경 사항은 새로 등록되는 티켓부터 적용됩니다.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">⚠️ {error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {ordered.map((policy) => {
            const meta = PRIORITY_META[policy.priority]
            const isEditing = editing === policy.priority
            const resolveBarPct = Math.round((policy.resolve_hours / maxResolve) * 100)
            const responseBarPct = Math.round((policy.response_hours / maxResolve) * 100)

            return (
              <div key={policy.priority} className={`rounded-xl border ${meta.border} ${meta.bg} p-5 flex flex-col gap-4`}>
                {/* Header */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xl">{meta.icon}</span>
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(policy)}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-0.5 rounded hover:bg-white/60 dark:hover:bg-white/10"
                      >
                        수정
                      </button>
                    )}
                  </div>
                  <div className={`text-base font-bold ${meta.color}`}>{meta.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{meta.desc}</div>
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">최초 응답 (시간)</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={editValues.response_hours}
                        onChange={(e) => setEditValues((v) => ({ ...v, response_hours: Number(e.target.value) }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-200"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">해결 시간 (시간)</label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={editValues.resolve_hours}
                        onChange={(e) => setEditValues((v) => ({ ...v, resolve_hours: Number(e.target.value) }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-200"
                      />
                    </div>
                    {saveError && <p className="text-xs text-red-600">{saveError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(policy.priority)}
                        disabled={saving}
                        className="flex-1 text-sm bg-blue-600 text-white py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? '저장...' : '저장'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-3"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Response time */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-gray-500 dark:text-gray-400">최초 응답</span>
                        <span className={`font-bold ${meta.color}`}>{hoursDisplay(policy.response_hours)}</span>
                      </div>
                      <div className="h-1.5 bg-white/70 dark:bg-black/20 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${responseBarPct}%` }} />
                      </div>
                    </div>
                    {/* Resolve time */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-gray-500 dark:text-gray-400">해결 시간</span>
                        <span className={`font-bold ${meta.color}`}>{hoursDisplay(policy.resolve_hours)}</span>
                      </div>
                      <div className="h-1.5 bg-white/70 dark:bg-black/20 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${resolveBarPct}%` }} />
                      </div>
                    </div>
                    {/* Last modified */}
                    {(policy.updated_by || policy.updated_at) && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 pt-1 border-t border-white/60 dark:border-white/10">
                        {policy.updated_by && <span>{policy.updated_by}</span>}
                        {policy.updated_at && (
                          <span> · {new Date(policy.updated_at).toLocaleDateString('ko-KR')}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function SLAPoliciesPage() {
  return <SLAPoliciesContent />
}
