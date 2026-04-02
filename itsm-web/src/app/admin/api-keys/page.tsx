'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

interface ApiKey {
  id: number
  name: string
  key_prefix: string
  scopes: string[]
  created_by: string
  created_at: string | null
  expires_at: string | null
  last_used_at: string | null
  revoked: boolean
}

const SCOPES = [
  { value: 'tickets:read', label: '티켓 조회' },
  { value: 'tickets:write', label: '티켓 생성/수정' },
  { value: 'kb:read', label: 'KB 조회' },
  { value: 'kb:write', label: 'KB 작성' },
  { value: 'webhooks:write', label: '웹훅 등록' },
]

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  if (res.status === 204) return null
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`)
  }
  return res.json()
}

function ApiKeysContent() {
  const { isAdmin } = useAuth()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', scopes: [] as string[], expires_days: '' })
  const [saving, setSaving] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    apiFetch('/admin/api-keys')
      .then(data => setKeys(data ?? []))
      .catch(() => setError('로드 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const toggleScope = (s: string) => {
    setForm(f => ({ ...f, scopes: f.scopes.includes(s) ? f.scopes.filter(x => x !== s) : [...f.scopes, s] }))
  }

  const handleCreate = async () => {
    if (!form.name) { setError('이름은 필수입니다.'); return }
    if (form.scopes.length === 0) { setError('스코프를 하나 이상 선택하세요.'); return }
    setSaving(true); setError(null)
    const body = {
      name: form.name,
      scopes: form.scopes,
      expires_days: form.expires_days ? parseInt(form.expires_days) : null,
    }
    try {
      const res = await apiFetch('/admin/api-keys', { method: 'POST', body: JSON.stringify(body) })
      setNewKey(res.key)
      setShowForm(false)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : '생성 실패') }
    finally { setSaving(false) }
  }

  const handleRevoke = async (id: number, name: string) => {
    if (!confirm(`"${name}" API 키를 폐기할까요? 이 작업은 되돌릴 수 없습니다.`)) return
    await apiFetch(`/admin/api-keys/${id}`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  const copyKey = () => {
    if (newKey) navigator.clipboard?.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isAdmin) return <div className="p-8 text-center text-gray-500">관리자 권한이 필요합니다.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            API 키 관리
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">외부 시스템이 ITSM API에 접근할 수 있는 인증 키를 관리합니다.</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm({ name: '', scopes: [], expires_days: '' }); setError(null) }}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium">
          + 새 API 키
        </button>
      </div>

      {/* 생성된 키 표시 (한 번만) */}
      {newKey && (
        <div className="mb-6 p-5 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">API 키가 생성됐습니다 — 지금만 표시됩니다!</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">이 키는 다시 조회할 수 없습니다. 안전한 곳에 즉시 저장하세요.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-100 break-all">
                  {newKey}
                </code>
                <button onClick={copyKey} className={`shrink-0 px-3 py-2 text-sm rounded-lg border font-medium transition-colors ${
                  copied ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400' : 'bg-white dark:bg-gray-800 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                }`}>
                  {copied ? '✅ 복사됨' : '복사'}
                </button>
              </div>
              <p className="text-xs text-amber-600 mt-2">
                사용법: <code className="bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200 px-1 rounded">Authorization: Bearer {newKey.slice(0, 20)}...</code>
              </p>
            </div>
            <button onClick={() => setNewKey(null)} className="text-amber-400 hover:text-amber-600 text-xl shrink-0">×</button>
          </div>
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}

      {/* 사용 가이드 */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl text-sm text-blue-800 dark:text-blue-300">
        <p className="font-medium mb-1">📖 API 키 사용 방법</p>
        <code className="text-xs bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200 px-2 py-1 rounded block font-mono">
          curl -H &quot;Authorization: Bearer itsm_live_xxxx&quot; http://itsm.company.com/api/tickets/
        </code>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">로딩 중...</div>
      ) : keys.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
          <div className="text-4xl mb-3">🔑</div>
          <p className="text-gray-500 font-medium">등록된 API 키가 없습니다.</p>
          <p className="text-sm text-gray-400 mt-1">CI/CD 파이프라인이나 외부 시스템 연동에 활용하세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(k => (
            <div key={k.id} className={`bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm p-5 ${k.revoked ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${k.revoked ? 'bg-red-400' : 'bg-green-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{k.name}</span>
                    {k.revoked && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded">폐기됨</span>}
                  </div>
                  <div className="text-xs text-gray-400 font-mono mt-0.5">{k.key_prefix}••••••••••••••••••••••••</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {k.scopes.map(s => (
                      <span key={s} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded px-2 py-0.5">
                        {SCOPES.find(sc => sc.value === s)?.label ?? s}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-1.5 text-xs text-gray-400">
                    <span>생성: {k.created_at ? new Date(k.created_at).toLocaleDateString('ko-KR') : '-'}</span>
                    {k.expires_at && <span>만료: {new Date(k.expires_at).toLocaleDateString('ko-KR')}</span>}
                    {k.last_used_at && <span>마지막 사용: {new Date(k.last_used_at).toLocaleString('ko-KR')}</span>}
                  </div>
                </div>
                {!k.revoked && (
                  <button onClick={() => handleRevoke(k.id, k.name)}
                    className="shrink-0 text-xs px-3 py-1.5 border border-red-200 dark:border-red-700 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                    폐기
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">새 API 키 생성</h2>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm rounded-lg">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">키 이름 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: GitLab CI 파이프라인" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">권한 스코프 *</label>
                <div className="space-y-2">
                  {SCOPES.map(s => (
                    <label key={s.value} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      form.scopes.includes(s.value) ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}>
                      <input type="checkbox" checked={form.scopes.includes(s.value)} onChange={() => toggleScope(s.value)} className="w-4 h-4 text-blue-600" />
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-200">{s.label}</div>
                        <div className="text-xs text-gray-400 font-mono">{s.value}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">유효 기간 (일, 비워두면 무기한)</label>
                <input type="number" min={1} value={form.expires_days}
                  onChange={e => setForm(f => ({ ...f, expires_days: e.target.value }))}
                  placeholder="예: 90" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100" />
              </div>
            </div>
            <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">취소</button>
              <button onClick={handleCreate} disabled={saving || !form.name || form.scopes.length === 0}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                {saving ? '생성 중...' : '키 생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ApiKeysPage() {
  return <RequireAuth><ApiKeysContent /></RequireAuth>
}
