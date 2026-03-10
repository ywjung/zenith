'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { API_BASE } from '@/lib/constants'

interface LabelStatus {
  name: string
  color: string
  in_project: boolean
  in_group: boolean
  synced: boolean
  service_label: string | null   // cat:: 라벨의 서비스 유형 한글명
  service_emoji: string | null   // 서비스 유형 이모지
  service_value: string | null   // DB value (숫자 키)
  enabled: boolean
}

interface StatusData {
  labels: LabelStatus[]
  project_label_count: number
  group_label_count: number
}

const LABEL_GROUPS = [
  { prefix: 'status::', title: '상태 라벨', desc: '워크플로우 고정값 — 코드와 연동됨', readonly: true, icon: '🔄' },
  { prefix: 'prio::',   title: '우선순위 라벨', desc: 'SLA 정책과 연동됨', readonly: true, icon: '🎯' },
  { prefix: 'cat::',    title: '카테고리 라벨', desc: '서비스 유형 관리에서 추가·수정·삭제', readonly: false, icon: '🏷️' },
]

function LabelDot({ color }: { color: string }) {
  return <span className="inline-block w-3 h-3 rounded-full shrink-0 border border-black/10" style={{ background: color }} />
}

export default function AdminLabelsPage() {
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
      else setError('라벨 현황을 불러오지 못했습니다.')
    } catch { setError('네트워크 오류') }
    finally { setLoading(false) }
  }

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
        setError('동기화 실패')
      }
    } catch { setError('네트워크 오류') }
    finally { setSyncing(false) }
  }

  const allSynced = data?.labels.every(l => l.synced) ?? false
  const unsyncedCount = data?.labels.filter(l => !l.synced).length ?? 0

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">GitLab 라벨 동기화 관리</h2>
            <p className="text-sm text-gray-500 mt-1">
              ITSM에서 사용하는 모든 라벨이 GitLab 프로젝트·그룹에 존재하는지 확인하고 동기화합니다.
            </p>
            {data && (
              <div className="flex gap-3 mt-3 text-sm flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                  전체 <strong className="text-gray-900">{data.labels.length}개</strong>
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${allSynced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {allSynced ? '✅ 전체 동기화됨' : `⚠️ 미동기화 ${unsyncedCount}개`}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
                  프로젝트 {data.project_label_count}개
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">
                  그룹 {data.group_label_count}개
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || loading}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2"
          >
            {syncing ? (
              <><span className="animate-spin">⏳</span> 동기화 중...</>
            ) : (
              <><span>🔄</span> 전체 동기화</>
            )}
          </button>
        </div>

        {/* 동기화 결과 */}
        {syncResult && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
            <p className="font-semibold text-green-800 mb-1">동기화 완료</p>
            <p className="text-green-700">
              성공 {syncResult.synced.length}개
              {syncResult.failed.length > 0 && (
                <span className="text-red-600 ml-2">실패 {syncResult.failed.length}개: {syncResult.failed.join(', ')}</span>
              )}
            </p>
          </div>
        )}
        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">⚠️ {error}</div>
        )}
      </div>

      {/* 구조 설명 */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
        <p className="font-semibold mb-2">📌 라벨 관리 구조</p>
        <ul className="space-y-1.5 text-xs leading-relaxed">
          <li>• <strong>status:: / prio::</strong> — 워크플로우·SLA 고정값. 이 페이지에서 현황만 확인 가능합니다.</li>
          <li>• <strong>cat::</strong> — <Link href="/admin/service-types" className="underline text-amber-900 hover:text-amber-700">서비스 유형 관리</Link>에서 추가·수정·삭제 시 GitLab에 자동 동기화됩니다.</li>
          <li>• <strong>동기화 원칙</strong> — 라벨은 <strong>생성·색상 업데이트만</strong> 수행합니다. 절대 삭제하지 않습니다 (삭제 시 GitLab이 이슈 라벨을 자동 제거).</li>
          <li>• <strong>프로젝트 + 그룹</strong> — 양쪽에 모두 생성하여 전달된 개발 프로젝트에서도 동일 라벨을 사용할 수 있습니다.</li>
        </ul>
      </div>

      {/* 라벨 그룹별 현황 */}
      {loading ? (
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center text-gray-400 animate-pulse">불러오는 중...</div>
      ) : data && LABEL_GROUPS.map(group => {
        const groupLabels = data.labels.filter(l => l.name.startsWith(group.prefix))
        if (groupLabels.length === 0) return null
        const groupSynced = groupLabels.every(l => l.synced)
        return (
          <div key={group.prefix} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b">
              <div className="flex items-center gap-3">
                <span className="text-xl">{group.icon}</span>
                <div>
                  <h3 className="font-semibold text-gray-800">{group.title}</h3>
                  <p className="text-xs text-gray-500">{group.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {groupSynced ? (
                  <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full font-medium">✅ 동기화됨</span>
                ) : (
                  <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full font-medium">⚠️ 미동기화</span>
                )}
                {!group.readonly && (
                  <Link href="/admin/service-types"
                    className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2.5 py-1 rounded-full hover:bg-blue-50 transition-colors">
                    서비스 유형 관리 →
                  </Link>
                )}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2.5 text-left">라벨 이름</th>
                  <th className="px-5 py-2.5 text-left">색상</th>
                  <th className="px-4 py-2.5 text-center">프로젝트</th>
                  <th className="px-4 py-2.5 text-center">그룹</th>
                  <th className="px-4 py-2.5 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groupLabels.map(label => (
                  <tr key={label.name} className={`hover:bg-gray-50 ${!label.synced ? 'bg-red-50/30' : ''} ${!label.enabled ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <LabelDot color={label.color} />
                        <code className="font-mono text-sm text-gray-800">{label.name}</code>
                        {/* cat:: 라벨: 서비스 유형 이름 표시 */}
                        {label.service_label && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {label.service_emoji} {label.service_label}
                            {!label.enabled && <span className="text-gray-400">(비활성)</span>}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <LabelDot color={label.color} />
                        <span className="text-xs font-mono text-gray-500">{label.color}</span>
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
                        <span className="text-xs text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">정상</span>
                      ) : (
                        <span className="text-xs text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">누락</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
