'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { fetchAuditLogs, downloadAuditLogs } from '@/lib/api'
import type { AuditLogEntry } from '@/types'
import { useAuth } from '@/context/AuthContext'

const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  'ticket.create':              { label: '티켓 생성',       icon: '✚', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  'ticket.update':              { label: '티켓 수정',       icon: '✎', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  'ticket.delete':              { label: '티켓 삭제',       icon: '✕', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  'ticket.merge':               { label: '티켓 병합',       icon: '⇢', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' },
  'ticket.pipeline_trigger':    { label: '파이프라인 실행',  icon: '▶', color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400' },
  'ticket.custom_fields.update':{ label: '커스텀필드 수정',  icon: '✎', color: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400' },
  'ticket.bulk.close':          { label: '일괄 종료',       icon: '⊗', color: 'bg-slate-100 dark:bg-slate-700/40 text-slate-700 dark:text-slate-300' },
  'ticket.bulk.assign':         { label: '일괄 배정',       icon: '⇒', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  'ticket.bulk.set_priority':   { label: '우선순위 변경',   icon: '↑', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
  'user.role_change':           { label: '역할 변경',       icon: '🔑', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  'kb.create':                  { label: 'KB 생성',         icon: '✚', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400' },
  'kb.update':                  { label: 'KB 수정',         icon: '✎', color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400' },
  'kb.delete':                  { label: 'KB 삭제',         icon: '✕', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  'custom_field.create':        { label: '커스텀필드 생성',  icon: '✚', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  'custom_field.update':        { label: '커스텀필드 수정',  icon: '✎', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  'custom_field.delete':        { label: '커스텀필드 삭제',  icon: '✕', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  'business_hours.update':      { label: '업무시간 수정',   icon: '🕐', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  'holiday.add':                { label: '휴일 추가',       icon: '✚', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  'holiday.delete':             { label: '휴일 삭제',       icon: '✕', color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  'update':                     { label: '설정 수정',       icon: '✎', color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
}

const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:     { label: '관리자',   color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  agent:     { label: 'IT담당자', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  developer: { label: '개발자',   color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' },
  user:      { label: '사용자',   color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' },
}

function resourceHref(type: string, id: string): string | null {
  if (type === 'ticket') return `/tickets/${id}`
  if (type === 'kb_article') return `/kb/${id}`
  if (type === 'user') return `/admin/users`
  return null
}

function ResourceLink({ type, id }: { type: string; id: string }) {
  const href = resourceHref(type, id)
  const inner = (
    <>
      <span className="text-gray-400">{type}</span>
      {' '}
      <span className="font-mono">#{id}</span>
    </>
  )
  if (!href) return <span className="text-xs text-gray-600 dark:text-gray-400">{inner}</span>
  return (
    <a
      href={href}
      className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </a>
  )
}

function pageNumbers(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const nums: (number | '…')[] = [1]
  if (page > 3) nums.push('…')
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) nums.push(i)
  if (page < totalPages - 2) nums.push('…')
  nums.push(totalPages)
  return nums
}

const PER_PAGE = 50

function AuditContent() {
  const { isAgent } = useAuth()

  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const [actionFilter, setActionFilter] = useState('')
  const [actorSearch, setActorSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const load = useCallback(() => {
    if (!isAgent) return
    setLoading(true)
    fetchAuditLogs({
      page,
      per_page: PER_PAGE,
      action: actionFilter || undefined,
      actor_username: actorSearch || undefined,
      from_date: fromDate ? new Date(fromDate).toISOString() : undefined,
      to_date: toDate ? new Date(toDate + 'T23:59:59').toISOString() : undefined,
    })
      .then((data) => { setLogs(data.logs); setTotal(data.total) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAgent, page, actionFilter, actorSearch, fromDate, toDate])

  useEffect(() => { load() }, [load])

  if (!isAgent) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500">에이전트 이상 권한이 필요합니다.</p>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const hasFilter = !!(actionFilter || actorSearch || fromDate || toDate)

  // actor_username은 서버사이드 필터로 처리 — logs가 이미 필터링된 결과
  const filtered = logs

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadAuditLogs({
        action: actionFilter || undefined,
        from_date: fromDate ? new Date(fromDate).toISOString() : undefined,
        to_date: toDate ? new Date(toDate + 'T23:59:59').toISOString() : undefined,
      })
    } catch {
      setError('CSV 다운로드에 실패했습니다.')
    } finally {
      setDownloading(false)
    }
  }

  function clearFilters() {
    setActionFilter(''); setActorSearch(''); setFromDate(''); setToDate(''); setPage(1)
  }

  function formatTimestamp(iso: string) {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">기간</label>
          <input
            type="date" value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1) }}
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date" value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1) }}
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
          />
        </div>

        <div className="hidden sm:block w-px h-5 bg-gray-200 dark:bg-gray-600" />

        <div className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 dark:bg-gray-700">
          <span className="text-gray-400 text-xs">🔍</span>
          <input
            type="text" placeholder="행위자 검색…" value={actorSearch}
            onChange={(e) => setActorSearch(e.target.value)}
            className="text-xs focus:outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 w-28 dark:bg-gray-700"
          />
        </div>

        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        >
          <option value="">전체 액션</option>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {hasFilter && (
          <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-800">초기화</button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {hasFilter ? `${filtered.length}건 (전체 ${total}건)` : `총 ${total}건`}
          </span>
          <button
            onClick={handleDownload} disabled={downloading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap"
          >
            ⬇ {downloading ? '다운로드 중…' : 'CSV 다운로드'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-gray-400">불러오는 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">시간</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">행위자</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">역할</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">액션</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">대상</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((log) => {
                  const meta = ACTION_META[log.action]
                  const role = ROLE_META[log.actor_role] ?? { label: log.actor_role, color: 'bg-gray-100 text-gray-600' }
                  const isExpanded = expanded === log.id
                  const hasDetail = !!(log.old_value || log.new_value)
                  const initial = ((log.actor_name ?? log.actor_username)[0] ?? '?').toUpperCase()

                  return (
                    <Fragment key={log.id}>
                      <tr
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${hasDetail ? 'cursor-pointer' : ''}`}
                        onClick={() => hasDetail && setExpanded(isExpanded ? null : log.id)}
                      >
                        {/* 시간 */}
                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono">
                          {formatTimestamp(log.created_at)}
                        </td>

                        {/* 행위자 — 이름 + @username */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                              {initial}
                            </div>
                            <div className="min-w-0">
                              {log.actor_name && (
                                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight truncate max-w-[120px]">
                                  {log.actor_name}
                                </div>
                              )}
                              <div className={`font-mono truncate max-w-[120px] ${log.actor_name ? 'text-[10px] text-gray-400 dark:text-gray-500' : 'text-xs text-gray-700 dark:text-gray-300'}`}>
                                @{log.actor_username}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 역할 */}
                        <td className="px-4 py-2.5">
                          <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${role.color}`}>
                            {role.label}
                          </span>
                        </td>

                        {/* 액션 */}
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${meta?.color ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                            <span className="leading-none">{meta?.icon}</span>
                            {meta?.label ?? log.action}
                          </span>
                        </td>

                        {/* 대상 링크 */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <ResourceLink type={log.resource_type} id={log.resource_id} />
                            {hasDetail && (
                              <span className="text-gray-300 dark:text-gray-600 text-[10px] ml-1">{isExpanded ? '▴' : '▾'}</span>
                            )}
                          </div>
                        </td>

                        {/* IP */}
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-400 whitespace-nowrap">
                          {log.ip_address ?? <span className="text-gray-200 dark:text-gray-700">—</span>}
                        </td>
                      </tr>

                      {/* 변경 상세 */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                            <div className="grid grid-cols-2 gap-3">
                              {log.old_value && (
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">변경 전</div>
                                  <pre className="text-xs font-mono bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-x-auto max-h-40 text-gray-600 dark:text-gray-300">
                                    {JSON.stringify(log.old_value, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {log.new_value && (
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">변경 후</div>
                                  <pre className="text-xs font-mono bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-x-auto max-h-40 text-gray-600 dark:text-gray-300">
                                    {JSON.stringify(log.new_value, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center text-gray-400">
                      <div className="text-3xl mb-2">📋</div>
                      감사 로그가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => setPage(1)} disabled={page === 1}
            className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
          >«</button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
          >‹ 이전</button>

          {pageNumbers(page, totalPages).map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="px-2 text-xs text-gray-400">…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n as number)}
                className={`w-8 h-8 text-xs rounded-lg border transition-colors ${
                  page === n
                    ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >{n}</button>
            )
          )}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
          >다음 ›</button>
          <button
            onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30"
          >»</button>
        </div>
      )}
    </div>
  )
}

export default function AuditPage() {
  return <AuditContent />
}
