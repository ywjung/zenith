'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import RequireAuth from '@/components/RequireAuth'
import { useAuth } from '@/context/AuthContext'
import {
  listProblems, createProblem, updateProblem, getProblemStats,
  linkIncidentToProblem, unlinkIncidentFromProblem,
  type ProblemTicket, type LinkedIncident,
} from '@/lib/api'

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface ProblemStats {
  total_problems: number
  total_linked_incidents: number
  avg_incidents_per_problem: number
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  critical: { pill: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',    dot: 'bg-red-500',    label: '긴급' },
  high:     { pill: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', dot: 'bg-orange-400', label: '높음' },
  medium:   { pill: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-400', label: '보통' },
  low:      { pill: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',   dot: 'bg-gray-400',   label: '낮음' },
}

const INCIDENT_STATE_STYLES: Record<string, string> = {
  opened: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  closed: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  unknown: 'bg-gray-100 dark:bg-gray-700 text-gray-400',
}

function PriorityPill({ priority }: { priority: string }) {
  const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.low
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// ── 메인 콘텐츠 ──────────────────────────────────────────────────────────────

const PER_PAGE_OPTIONS = [10, 20, 50] as const

function Pagination({
  page, totalPages, total, perPage, onPage, onPerPage,
}: {
  page: number; totalPages: number; total: number; perPage: number
  onPage: (p: number) => void; onPerPage: (n: number) => void
}) {
  const start = (page - 1) * perPage + 1
  const end   = Math.min(page * perPage, total)

  const pages: (number | '...')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
      <span className="text-xs text-gray-500 dark:text-gray-400 order-2 sm:order-1">
        전체 <strong className="text-gray-700 dark:text-gray-300">{total}</strong>건 중{' '}
        <strong className="text-gray-700 dark:text-gray-300">{start}–{end}</strong>번째
      </span>
      <div className="flex items-center gap-1 order-1 sm:order-2">
        <button
          onClick={() => onPage(page - 1)} disabled={page === 1}
          className="px-2.5 py-1.5 text-xs border dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >‹</button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-gray-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                p === page
                  ? 'bg-blue-600 text-white font-bold'
                  : 'border dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >{p}</button>
          )
        )}
        <button
          onClick={() => onPage(page + 1)} disabled={page === totalPages}
          className="px-2.5 py-1.5 text-xs border dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >›</button>
      </div>
      <div className="flex items-center gap-1.5 order-3 text-xs text-gray-500 dark:text-gray-400">
        <span>페이지당</span>
        {PER_PAGE_OPTIONS.map(n => (
          <button
            key={n}
            onClick={() => onPerPage(n)}
            className={`w-8 h-6 rounded text-xs transition-colors ${
              n === perPage
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}
          >{n}</button>
        ))}
      </div>
    </div>
  )
}

function ProblemsContent() {
  const { isAgent } = useAuth()

  const [problems, setProblems]       = useState<ProblemTicket[]>([])
  const [total, setTotal]             = useState(0)
  const [stats, setStats]             = useState<ProblemStats | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [expandedId, setExpandedId]   = useState<number | null>(null)
  const [page, setPage]               = useState(1)
  const [perPage, setPerPage]         = useState(10)

  // 생성 모달
  const [showCreate, setShowCreate]         = useState(false)
  const [createTitle, setCreateTitle]       = useState('')
  const [createDesc, setCreateDesc]         = useState('')
  const [createPriority, setCreatePriority] = useState('medium')
  const [creating, setCreating]             = useState(false)
  const [createError, setCreateError]       = useState('')

  // 수정 모달
  const [editTarget, setEditTarget]         = useState<ProblemTicket | null>(null)
  const [editTitle, setEditTitle]           = useState('')
  const [editDesc, setEditDesc]             = useState('')
  const [editPriority, setEditPriority]     = useState('medium')
  const [editing, setEditing]               = useState(false)
  const [editError, setEditError]           = useState('')

  // 인시던트 연결 모달
  const [linkTarget, setLinkTarget]     = useState<ProblemTicket | null>(null)
  const [linkIidInput, setLinkIidInput] = useState('')
  const [linking, setLinking]           = useState(false)
  const [linkError, setLinkError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [res, statsRes] = await Promise.allSettled([
        listProblems({ state: stateFilter, search: search || undefined, page, per_page: perPage }),
        getProblemStats(),
      ])
      if (res.status === 'fulfilled') {
        setProblems(res.value.problems)
        setTotal(res.value.total)
      }
      if (statsRes.status === 'fulfilled') setStats(statsRes.value)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '문제 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [stateFilter, search, page, perPage])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1); setExpandedId(null) }, [stateFilter, search])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!createTitle.trim()) { setCreateError('제목을 입력해주세요.'); return }
    setCreating(true); setCreateError('')
    try {
      await createProblem({ title: createTitle, description: createDesc, priority: createPriority })
      setShowCreate(false)
      setCreateTitle(''); setCreateDesc(''); setCreatePriority('medium')
      await load()
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : '생성 실패')
    } finally { setCreating(false) }
  }

  function openEdit(prob: ProblemTicket, e: React.MouseEvent) {
    e.stopPropagation()
    setEditTarget(prob)
    setEditTitle(prob.title)
    setEditDesc(prob.description ?? '')
    setEditPriority(prob.priority ?? 'medium')
    setEditError('')
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget || !editTitle.trim()) { setEditError('제목을 입력해주세요.'); return }
    setEditing(true); setEditError('')
    try {
      await updateProblem(editTarget.iid, { title: editTitle, description: editDesc, priority: editPriority })
      setEditTarget(null)
      await load()
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : '수정 실패')
    } finally { setEditing(false) }
  }

  async function handleLinkIncident(e: React.FormEvent) {
    e.preventDefault()
    if (!linkTarget) return
    const iid = parseInt(linkIidInput, 10)
    if (!Number.isInteger(iid) || iid <= 0) { setLinkError('올바른 티켓 번호를 입력해주세요.'); return }
    setLinking(true); setLinkError('')
    try {
      await linkIncidentToProblem(linkTarget.iid, iid)
      setLinkTarget(null); setLinkIidInput('')
      await load()
    } catch (e: unknown) {
      setLinkError(e instanceof Error ? e.message : '연결 실패')
    } finally { setLinking(false) }
  }

  async function handleUnlink(problemIid: number, incidentIid: number) {
    if (!confirm(`인시던트 #${incidentIid}의 연결을 해제하시겠습니까?`)) return
    try {
      await unlinkIncidentFromProblem(problemIid, incidentIid)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '연결 해제에 실패했습니다.')
    }
  }

  function toggleExpand(iid: number) {
    setExpandedId(prev => prev === iid ? null : iid)
  }

  const openCount     = problems.filter(p => p.state === 'opened').length
  const criticalCount = problems.filter(p => p.priority === 'critical').length
  const totalPages    = Math.max(1, Math.ceil(total / perPage))

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🔍 문제 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            인시던트의 근본 원인(Problem)을 식별하고 추적합니다.
          </p>
        </div>
        {isAgent && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 문제 등록
          </button>
        )}
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { value: stats.total_problems,        label: '전체 문제',       color: 'text-purple-600 dark:text-purple-400' },
            { value: openCount,                    label: '열린 문제',       color: 'text-green-600 dark:text-green-400' },
            { value: criticalCount,                label: '긴급',            color: 'text-red-600 dark:text-red-400' },
            { value: stats.total_linked_incidents, label: '연결된 인시던트', color: 'text-orange-600 dark:text-orange-400' },
          ].map(item => (
            <div key={item.label} className="bg-white dark:bg-gray-900 rounded-xl border dark:border-gray-700 shadow-sm p-4 text-center">
              <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-3 mb-4">
        <div className="flex bg-white dark:bg-gray-900 rounded-lg border dark:border-gray-700 overflow-hidden shadow-sm">
          {['all', 'open', 'closed'].map(s => (
            <button
              key={s}
              onClick={() => setStateFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors
                ${stateFilter === s
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
              {s === 'all' ? '전체' : s === 'open' ? '열림' : '닫힘'}
            </button>
          ))}
        </div>
        <form onSubmit={e => { e.preventDefault(); setSearch(searchInput) }} className="flex gap-2 flex-1">
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="문제 검색..."
            className="flex-1 px-3 py-1.5 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400"
          />
          <button type="submit" className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
            검색
          </button>
        </form>
      </div>

      {/* 에러 / 로딩 */}
      {error && (
        <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">{error}</div>
      )}
      {loading && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">불러오는 중...</div>
      )}

      {/* 빈 상태 */}
      {!loading && problems.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">등록된 문제가 없습니다.</p>
          {isAgent && (
            <button onClick={() => setShowCreate(true)} className="mt-3 text-blue-600 dark:text-blue-400 text-sm hover:underline">
              첫 번째 문제 등록하기
            </button>
          )}
        </div>
      )}

      {/* 문제 목록 — 아코디언 */}
      {!loading && problems.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {problems.map(prob => {
              const isOpen   = prob.state === 'opened'
              const expanded = expandedId === prob.iid
              const incidents: LinkedIncident[] = prob.linked_incidents ?? (prob.linked_incident_iids ?? []).map(iid => ({ iid, title: `#${iid}`, state: 'unknown', priority: 'medium' }))
              const incCount = incidents.length
              const hasDesc  = !!prob.description?.trim()

              return (
                <div key={prob.iid}>
                  {/* ── 요약 행 ── */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${expanded ? 'bg-gray-50 dark:bg-gray-800/40' : ''}`}
                    onClick={() => toggleExpand(prob.iid)}
                  >
                    <span className={`shrink-0 w-2 h-2 rounded-full ${isOpen ? 'bg-green-500' : 'bg-gray-400'}`} title={isOpen ? '열림' : '닫힘'} />
                    <span className="shrink-0 text-xs font-mono text-gray-400 dark:text-gray-500 w-10 text-right">
                      #{prob.iid}
                    </span>
                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                      {prob.title}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityPill priority={prob.priority} />
                      {incCount > 0 && (
                        <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full font-medium">
                          인시던트 {incCount}
                        </span>
                      )}
                      {isAgent && (
                        <>
                          <button
                            onClick={e => openEdit(prob, e)}
                            className="text-xs px-2 py-1 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 border dark:border-gray-700 transition-colors"
                          >
                            수정
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setLinkTarget(prob); setLinkIidInput(''); setLinkError('') }}
                            className="text-xs px-2 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors"
                          >
                            연결
                          </button>
                        </>
                      )}
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* ── 상세 패널 ── */}
                  {expanded && (
                    <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-800">
                      <div className="pl-5 space-y-3">

                        {/* 메타 정보 */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                          {prob.assignee && (
                            <span>담당자: <span className="text-gray-700 dark:text-gray-300">{prob.assignee.name || prob.assignee.username}</span></span>
                          )}
                          <span>등록일: {new Date(prob.created_at).toLocaleDateString('ko-KR')}</span>
                          <span>상태: <span className={isOpen ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}>{isOpen ? '열림' : '닫힘'}</span></span>
                          <Link
                            href={prob.web_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            GitLab →
                          </Link>
                        </div>

                        {/* 설명 */}
                        {hasDesc && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-lg p-3 border dark:border-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                            {prob.description}
                          </div>
                        )}

                        {/* 연결된 인시던트 */}
                        {incCount > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                              연결된 인시던트 ({incCount})
                            </p>
                            <div className="space-y-1.5">
                              {incidents.map(inc => (
                                <div
                                  key={inc.iid}
                                  className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-orange-100 dark:border-orange-800/40 rounded-lg px-3 py-2"
                                >
                                  {/* 상태 배지 */}
                                  <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full ${INCIDENT_STATE_STYLES[inc.state] ?? INCIDENT_STATE_STYLES.unknown}`}>
                                    {inc.state === 'opened' ? '열림' : inc.state === 'closed' ? '닫힘' : '?'}
                                  </span>
                                  {/* 우선순위 점 */}
                                  <span
                                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_STYLES[inc.priority]?.dot ?? 'bg-gray-400'}`}
                                    title={PRIORITY_STYLES[inc.priority]?.label}
                                  />
                                  {/* 번호 + 제목 */}
                                  <Link
                                    href={`/tickets/${inc.iid}`}
                                    onClick={e => e.stopPropagation()}
                                    className="flex-1 min-w-0 text-xs text-orange-700 dark:text-orange-400 hover:underline font-medium"
                                  >
                                    <span className="font-mono mr-1">#{inc.iid}</span>
                                    <span className="text-gray-600 dark:text-gray-400 font-normal truncate">{inc.title}</span>
                                  </Link>
                                  {/* 연결 해제 */}
                                  {isAgent && (
                                    <button
                                      onClick={e => { e.stopPropagation(); handleUnlink(prob.iid, inc.iid) }}
                                      className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 text-sm leading-none ml-1 transition-colors"
                                      title="연결 해제"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 페이지네이션 */}
      {!loading && total > perPage && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          perPage={perPage}
          onPage={p => { setPage(p); setExpandedId(null) }}
          onPerPage={n => { setPerPage(n); setPage(1); setExpandedId(null) }}
        />
      )}

      {/* 문제 등록 모달 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">문제 등록</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">제목 *</label>
                <input
                  value={createTitle}
                  onChange={e => setCreateTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="인시던트의 근본 원인을 설명해주세요"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">설명</label>
                <textarea
                  value={createDesc}
                  onChange={e => setCreateDesc(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                  placeholder="문제 설명, 재현 방법, 영향 범위 등"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">우선순위</label>
                <select
                  value={createPriority}
                  onChange={e => setCreatePriority(e.target.value)}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                  <option value="critical">긴급</option>
                </select>
              </div>
              {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
                  취소
                </button>
                <button type="submit" disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {creating ? '등록 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 문제 수정 모달 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">문제 수정</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">#{editTarget.iid}</p>
            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">제목 *</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">설명</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">우선순위</label>
                <select
                  value={editPriority}
                  onChange={e => setEditPriority(e.target.value)}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="low">낮음</option>
                  <option value="medium">보통</option>
                  <option value="high">높음</option>
                  <option value="critical">긴급</option>
                </select>
              </div>
              {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditTarget(null)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
                  취소
                </button>
                <button type="submit" disabled={editing}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
                  {editing ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 인시던트 연결 모달 */}
      {linkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">인시던트 연결</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              문제 #{linkTarget.iid}에 연결할 인시던트 번호를 입력해주세요.
            </p>
            <form onSubmit={handleLinkIncident} className="space-y-3">
              <input
                type="number" min={1}
                value={linkIidInput}
                onChange={e => setLinkIidInput(e.target.value)}
                placeholder="인시던트 번호 (예: 42)"
                className="w-full px-3 py-2 text-sm border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                autoFocus
              />
              {linkError && <p className="text-sm text-red-600 dark:text-red-400">{linkError}</p>}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setLinkTarget(null)}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">
                  취소
                </button>
                <button type="submit" disabled={linking}
                  className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-60">
                  {linking ? '연결 중...' : '연결'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProblemsPage() {
  return (
    <RequireAuth>
      <ProblemsContent />
    </RequireAuth>
  )
}
