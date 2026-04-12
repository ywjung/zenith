'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useConfirm } from '@/components/ConfirmProvider'
import { useAuth } from '@/context/AuthContext'
import { API_BASE } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'

interface Entry {
  id: number
  cidr: string
  label: string | null
  is_active: boolean
  created_by: string
  created_at: string
}

export default function IpAllowlistPage() {
  const t = useTranslations('admin.ip_allowlist')
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [myIp, setMyIp] = useState<string>('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // 추가 폼
  const [newCidr, setNewCidr] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    loadEntries()
    // 현재 접속 IP 확인
    fetch(`${API_BASE}/admin/ip-allowlist/my-ip`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ip) setMyIp(d.ip) })
      .catch(() => {})
  }, [isAdmin])

  function loadEntries() {
    setLoading(true)
    fetch(`${API_BASE}/admin/ip-allowlist`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then(data => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setMsg({ type: 'err', text: t('load_failed') }))
      .finally(() => setLoading(false))
  }

  async function addEntry() {
    if (!newCidr.trim()) return
    setAdding(true)
    setMsg(null)
    try {
      const r = await fetch(`${API_BASE}/admin/ip-allowlist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr: newCidr.trim(), label: newLabel.trim() || null }),
      })
      if (!r.ok) {
        const e = await r.json()
        throw new Error(e.detail ?? t('add_failed'))
      }
      const added: Entry = await r.json()
      setEntries(prev => [...prev, added])
      setNewCidr('')
      setNewLabel('')
      setMsg({ type: 'ok', text: t('added', { cidr: added.cidr }) })
    } catch (e: unknown) {
      setMsg({ type: 'err', text: errorMessage(e, t('add_failed')) })
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(entry: Entry) {
    try {
      const r = await fetch(`${API_BASE}/admin/ip-allowlist/${entry.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !entry.is_active }),
      })
      if (!r.ok) throw new Error()
      const updated: Entry = await r.json()
      setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
    } catch {
      setMsg({ type: 'err', text: t('toggle_failed') })
    }
  }

  async function deleteEntry(id: number, cidr: string) {
    if (!(await confirm({ title: t('delete_confirm', { cidr }), variant: 'danger' }))) return
    try {
      const r = await fetch(`${API_BASE}/admin/ip-allowlist/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok && r.status !== 204) throw new Error()
      setEntries(prev => prev.filter(e => e.id !== id))
      setMsg({ type: 'ok', text: t('deleted', { cidr }) })
    } catch {
      setMsg({ type: 'err', text: t('delete_failed') })
    }
  }

  const activeEntries = entries.filter(e => e.is_active)
  const myIpAllowed = !myIp || activeEntries.length === 0 ||
    activeEntries.some(e => isCidrMatch(myIp, e.cidr))

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500 dark:text-gray-400">{t('no_permission')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {t('title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('subtitle_pre')}<code className="font-mono bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">/admin/*</code>){t('subtitle_post')}
            </p>
            <div className="flex flex-wrap gap-3 mt-3">
              <span className="inline-flex items-center gap-1.5 text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700 px-2.5 py-1 rounded-full font-medium">
                {t('localhost_always')}
              </span>
              {myIp && (
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${
                  myIpAllowed
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700'
                }`}>
                  {t('my_ip', { status: myIpAllowed ? '🌐' : '⛔', ip: myIp })}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              activeEntries.length > 0
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700'
                : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
            }`}>
              {activeEntries.length > 0 ? t('limited', { n: activeEntries.length }) : t('unrestricted')}
            </div>
          </div>
        </div>
      </div>

      {/* 현재 IP가 차단될 경우 경고 */}
      {myIp && activeEntries.length > 0 && !myIpAllowed && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-xl p-4 text-sm text-red-800 dark:text-red-300">
          <div className="font-semibold mb-1">{t('my_ip_blocked_title', { ip: myIp })}</div>
          <p>{t('my_ip_blocked_desc')}</p>
        </div>
      )}

      {/* 메시지 */}
      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          msg.type === 'ok'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700'
        }`}>
          {msg.type === 'ok' ? '✅ ' : '❌ '}{msg.text}
        </div>
      )}

      {/* 추가 폼 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">{t('add_title')}</h3>
        </div>
        <div className="p-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newCidr}
              onChange={e => setNewCidr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addEntry()}
              placeholder={t('cidr_placeholder')}
              className="flex-1 font-mono text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addEntry()}
              placeholder={t('label_placeholder')}
              className="sm:w-48 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addEntry}
              disabled={adding || !newCidr.trim()}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {adding ? t('adding') : t('add')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{t('examples')}</span>
            {['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '203.0.113.0/24'].map(ex => (
              <button
                key={ex}
                onClick={() => setNewCidr(ex)}
                className="font-mono bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2 py-0.5 rounded transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">
            {t('allowlist_title')}
            <span className="ml-2 text-xs font-normal text-gray-400">{t('allowlist_count', { n: entries.length })}</span>
          </h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('auto_reload')}</span>
        </div>

        {/* localhost 고정 행 */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-4 bg-green-50/50 dark:bg-green-900/10">
          <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-white" />
          </span>
          <code className="font-mono text-sm text-gray-800 dark:text-gray-200 flex-1">127.0.0.0/8 · ::1/128</code>
          <span className="text-xs text-gray-500 dark:text-gray-400">{t('localhost_row')}</span>
          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700 px-2 py-0.5 rounded-full">{t('always_allowed')}</span>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">{t('loading')}</div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <div className="text-3xl mb-2">🔓</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('empty_title')}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('empty_hint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {entries.map(entry => (
              <div key={entry.id} className={`px-6 py-3 flex items-center gap-4 ${
                !entry.is_active ? 'opacity-50' : ''
              }`}>
                {/* 활성 토글 */}
                <button
                  onClick={() => toggleActive(entry)}
                  title={entry.is_active ? t('click_to_disable') : t('click_to_enable')}
                  className="shrink-0"
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                    entry.is_active ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}>
                    <span className="w-2.5 h-2.5 rounded-full bg-white" />
                  </span>
                </button>

                <code className="font-mono text-sm text-gray-800 dark:text-gray-200 min-w-[160px]">{entry.cidr}</code>

                <span className="flex-1 text-sm text-gray-500 dark:text-gray-400 truncate">
                  {entry.label ?? <span className="italic text-gray-300 dark:text-gray-600">{t('no_memo')}</span>}
                </span>

                {myIp && entry.is_active && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                    isCidrMatch(myIp, entry.cidr)
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700'
                  }`}>
                    {isCidrMatch(myIp, entry.cidr) ? t('my_ip_included') : ''}
                  </span>
                )}

                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{entry.created_by}</span>

                <button
                  onClick={() => deleteEntry(entry.id, entry.cidr)}
                  className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors text-lg leading-none"
                  title={t('delete_title')}
                 aria-label={t('remove_aria')}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 안내 */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
        <div className="font-semibold mb-1">{t('warn_title')}</div>
        <ul className="space-y-1 list-disc list-inside text-amber-700 dark:text-amber-400">
          <li>{t('warn_1_prefix')}<strong>{t('warn_1_strong')}</strong>{t('warn_1_suffix')}</li>
          <li>{t('warn_2_prefix')}<strong>{t('warn_2_strong')}</strong>{t('warn_2_suffix')}</li>
          <li>{t('warn_3_prefix')}<strong>{t('warn_3_strong')}</strong>{t('warn_3_suffix')}</li>
          <li>{t('warn_4_prefix')}<code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 rounded">X-Forwarded-For</code>{t('warn_4_suffix')}</li>
        </ul>
      </div>
    </div>
  )
}

/** 클라이언트 측 간이 CIDR 매칭 — 서브넷 마스크 기준 prefix 비교 */
function isCidrMatch(ip: string, cidr: string): boolean {
  try {
    const [base, prefix] = cidr.split('/')
    const bits = parseInt(prefix ?? '32')
    if (isNaN(bits)) return false
    // IPv4 only client-side check
    const ipNum = ipToNum(ip)
    const baseNum = ipToNum(base)
    if (ipNum === null || baseNum === null) return false
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (ipNum & mask) === (baseNum & mask)
  } catch {
    return false
  }
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}
