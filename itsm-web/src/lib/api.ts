import type {
  Ticket, TicketCreate, Comment, Rating, RatingCreate, GitLabProject, ProjectMember,
  TicketStats, TicketListResponse, KBArticle, KBArticleCreate, UserRole, AuditLogEntry,
  AssignmentRule, SLARecord, NotificationItem, TicketTemplate, TimeEntry, TicketLink,
  RatingStats, RealtimeStats, BreakdownStats, DevProject, ProjectForward, ForwardsResponse,
  SLAPolicy, AgentPerformance, SavedFilter, LinkedMR, ServiceType, Milestone,
  CustomFieldDef, TicketCustomFieldValue, DoraMetrics, GanttData,
} from '@/types'
import { API_BASE } from '@/lib/constants'

/** undefined/null/빈 값을 제외하고 URLSearchParams 쿼리 문자열을 생성한다. */
function buildQuery(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return ''
  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') qs.set(key, String(val))
  }
  return qs.toString() ? `?${qs}` : ''
}

/** API 요청 기본 타임아웃 (ms). 파일 업로드 등 장시간 작업은 직접 AbortController 사용. */
const REQUEST_TIMEOUT_MS = 30_000
/** AI 요청 타임아웃 — 대형 로컬 모델(35B+)은 응답에 60s 이상 소요될 수 있음 */
const AI_TIMEOUT_MS = 120_000

/** main.py 통합 에러 포맷 {error:{code,message,detail}} 및 FastAPI 기본 {detail} 모두 처리 */
async function parseErrorMessage(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({} as Record<string, unknown>))
  if (err.error && typeof err.error === 'object') {
    const e = err.error as Record<string, unknown>
    if (Array.isArray(e.detail)) return (e.detail as { msg: string }[]).map(x => x.msg).join('; ')
    return (e.message as string) || `HTTP ${res.status}`
  }
  if (Array.isArray(err.detail)) return (err.detail as { msg: string }[]).map(x => x.msg).join('; ')
  return (err.detail as string) || `HTTP ${res.status}`
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      cache: 'no-store',
      credentials: 'include',
      signal: init?.signal ?? controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`요청 시간이 초과되었습니다 (${timeoutMs / 1000}s)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  // 429 Too Many Requests — Retry-After 헤더 또는 1초 후 1회 재시도
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10)
    const waitMs = Math.min(Math.max(retryAfter, 1), 10) * 1000
    await new Promise(resolve => setTimeout(resolve, waitMs))
    const retryRes = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      cache: 'no-store',
      credentials: 'include',
    })
    if (retryRes.ok) {
      if (retryRes.status === 204 || retryRes.headers.get('content-length') === '0') return undefined as T
      return retryRes.json()
    }
    throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (res.status === 401) {
    // Try to refresh token before redirecting
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      // Retry original request (새 타임아웃 적용)
      const retryController = new AbortController()
      const retryTimer = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS)
      try {
        const retryRes = await fetch(`${API_BASE}${path}`, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...init?.headers },
          cache: 'no-store',
          credentials: 'include',
          signal: retryController.signal,
        })
        if (retryRes.ok) return retryRes.json()
      } finally {
        clearTimeout(retryTimer)
      }
    }
    // /help, /portal 같은 공개 페이지에서는 리다이렉트 하지 않음
    const PUBLIC_PATHS = ['/login', '/help', '/portal']
    if (typeof window !== 'undefined' && !PUBLIC_PATHS.some(p => window.location.pathname.startsWith(p))) {
      window.location.href = '/login'
    }
    throw new Error('로그인이 필요합니다.')
  }
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res))
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json()
}

// Prevent concurrent refresh attempts.
// Stored on window (not module scope) to avoid SSR singleton leaking across requests.
type _WinWithRefresh = typeof window & { __itsmRefreshPromise?: Promise<boolean> | null }

async function tryRefreshToken(): Promise<boolean> {
  // SSR: cookies unavailable, skip
  if (typeof window === 'undefined') return false
  const win = window as _WinWithRefresh
  if (win.__itsmRefreshPromise) return win.__itsmRefreshPromise
  win.__itsmRefreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      return res.ok
    } catch {
      return false
    } finally {
      win.__itsmRefreshPromise = null
    }
  })()
  return win.__itsmRefreshPromise
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function fetchProjects(): Promise<GitLabProject[]> {
  return request<GitLabProject[]>('/projects/')
}

export function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return request<ProjectMember[]>(`/projects/${projectId}/members`)
}

export function fetchMilestones(projectId: string, state = 'active'): Promise<Milestone[]> {
  const qs = new URLSearchParams({ state })
  return request<Milestone[]>(`/projects/${encodeURIComponent(projectId)}/milestones?${qs}`)
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export function fetchTicketStats(projectId?: string): Promise<TicketStats> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<TicketStats>(`/tickets/stats${qs}`)
}

export function fetchTickets(params?: {
  state?: string
  category?: string
  priority?: string
  sla?: string
  search?: string
  project_id?: string
  page?: number
  per_page?: number
  sort_by?: string
  order?: string
  created_by_username?: string
  created_after?: string
  created_before?: string
}): Promise<TicketListResponse> {
  return request<TicketListResponse>(`/tickets/${buildQuery(params)}`)
}

export function fetchTicketRequesters(projectId?: string): Promise<{ username: string; employee_name: string }[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/requesters${qs}`)
}

export function fetchTicket(iid: number, projectId?: string): Promise<Ticket> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Ticket>(`/tickets/${iid}${qs}`)
}

export function createTicket(data: TicketCreate): Promise<Ticket> {
  return request<Ticket>('/tickets/', { method: 'POST', body: JSON.stringify(data) })
}

export function fetchComments(iid: number, projectId?: string): Promise<Comment[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Comment[]>(`/tickets/${iid}/comments${qs}`)
}

export async function fetchRating(iid: number): Promise<Rating | null> {
  try {
    return await request<Rating>(`/tickets/${iid}/ratings`)
  } catch {
    return null
  }
}

export async function deleteTicket(iid: number, projectId?: string): Promise<void> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  let res = await fetch(`${API_BASE}/tickets/${iid}${qs}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (res.status === 401) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      res = await fetch(`${API_BASE}/tickets/${iid}${qs}`, {
        method: 'DELETE',
        credentials: 'include',
      })
    }
    if (res.status === 401) {
      const PUBLIC_PATHS = ['/login', '/help', '/portal']
      if (typeof window !== 'undefined' && !PUBLIC_PATHS.some(p => window.location.pathname.startsWith(p))) {
        window.location.href = '/login'
      }
      throw new Error('로그인이 필요합니다.')
    }
  }
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res))
  }
}

export async function updateTicket(
  iid: number,
  data: {
    status?: string; priority?: string; assignee_id?: number;
    title?: string; description?: string; category?: string;
    resolution_note?: string; resolution_type?: string; change_reason?: string;
    milestone_id?: number;
  },
  projectId?: string,
  etag?: string,  // 낙관적 락용 If-Match 헤더
): Promise<Ticket & { _etag?: string }> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  const url = `${API_BASE}/tickets/${iid}${qs}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (etag) headers['If-Match'] = etag
  const init: RequestInit = { method: 'PATCH', headers, body: JSON.stringify(data), credentials: 'include', cache: 'no-store' }

  const doFetch = async (fetchInit: RequestInit) => fetch(url, fetchInit)

  let res = await doFetch(init)

  // 401 → 토큰 리프레시 후 재시도 (request<T> 헬퍼와 동일한 로직)
  if (res.status === 401) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      res = await doFetch(init)
    } else {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
      throw new Error('로그인이 필요합니다.')
    }
  }

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res))
  }
  const ticket = await res.json() as Ticket
  // ETag 헤더에서 updated_at 추출 (낙관적 락용)
  const responseEtag = res.headers.get('ETag')?.replace(/"/g, '')
  return { ...ticket, _etag: responseEtag ?? undefined }
}

export function addComment(
  iid: number,
  body: string,
  projectId?: string,
  internal = false,
): Promise<Comment> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Comment>(`/tickets/${iid}/comments${qs}`, {
    method: 'POST',
    body: JSON.stringify({ body, internal }),
  })
}

export function updateComment(iid: number, noteId: number, body: string, projectId?: string): Promise<Comment> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Comment>(`/tickets/${iid}/comments/${noteId}${qs}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  })
}

export function deleteComment(iid: number, noteId: number, projectId?: string): Promise<void> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/${iid}/comments/${noteId}${qs}`, { method: 'DELETE' })
}

/** 파일 업로드 전용 타임아웃 (ms). 10MB 파일 기준 느린 네트워크(1Mbps)에서 약 80s. */
const UPLOAD_TIMEOUT_MS = 300_000 // 5분

export async function uploadFile(
  file: File,
  projectId?: string,
): Promise<{ markdown: string; url: string; full_path: string; proxy_path: string; name: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const qs = projectId ? `?project_id=${projectId}` : ''

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${API_BASE}/tickets/upload${qs}`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`파일 업로드 시간이 초과되었습니다 (${UPLOAD_TIMEOUT_MS / 60000}분)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    // /help, /portal 같은 공개 페이지에서는 리다이렉트 하지 않음
    const PUBLIC_PATHS = ['/login', '/help', '/portal']
    if (typeof window !== 'undefined' && !PUBLIC_PATHS.some(p => window.location.pathname.startsWith(p))) {
      window.location.href = '/login'
    }
    throw new Error('로그인이 필요합니다.')
  }
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res))
  }
  return res.json()
}

export function createRating(iid: number, data: RatingCreate): Promise<Rating> {
  return request<Rating>(`/tickets/${iid}/ratings`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateRating(iid: number, data: { score: number; comment?: string }): Promise<Rating> {
  return request<Rating>(`/tickets/${iid}/ratings`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export function getMyRating(iid: number): Promise<Rating | null> {
  return request<Rating | null>(`/tickets/${iid}/ratings/me`)
}

export function mergeTicket(iid: number, targetIid: number, projectId?: string): Promise<{ merged: true; target_iid: number }> {
  const qs = new URLSearchParams({ target_iid: String(targetIid), ...(projectId ? { project_id: projectId } : {}) }).toString()
  return request<{ merged: true; target_iid: number }>(`/tickets/${iid}/merge?${qs}`, { method: 'POST' })
}

export function fetchTicketSLA(iid: number, projectId?: string): Promise<SLARecord> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<SLARecord>(`/tickets/${iid}/sla${qs}`)
}

export function updateTicketSLA(iid: number, slaDueDate: string, projectId?: string): Promise<SLARecord> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<SLARecord>(`/tickets/${iid}/sla${qs}`, {
    method: 'PATCH',
    body: JSON.stringify({ sla_due_date: slaDueDate }),
  })
}

export function fetchSLAPrediction(iid: number, projectId?: string): Promise<import('@/types').SLAPrediction> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<import('@/types').SLAPrediction>(`/tickets/${iid}/sla-prediction${qs}`)
}

export interface AISummaryResult {
  iid: number
  summary: string
  key_points: string[]
  suggested_action: string
  comment_count: number
}

export function fetchTicketAISummary(iid: number, projectId?: string): Promise<AISummaryResult> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<AISummaryResult>(`/tickets/${iid}/ai-summary${qs}`, { method: 'POST', timeoutMs: AI_TIMEOUT_MS })
}

export interface AIClassifyResult {
  category: string | null
  priority: string | null
  confidence: number
  reasoning: string
}

export function aiSuggestTicket(title: string, description: string): Promise<AIClassifyResult> {
  return request<AIClassifyResult>('/tickets/ai-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description }),
    timeoutMs: AI_TIMEOUT_MS,
  })
}

export function aiReclassifyTicket(iid: number, projectId?: string): Promise<AIClassifyResult & { iid: number }> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<AIClassifyResult & { iid: number }>(`/tickets/${iid}/ai-classify${qs}`, { method: 'POST', timeoutMs: AI_TIMEOUT_MS })
}

export interface AISettingsData {
  enabled: boolean
  provider: string
  openai_api_key_set: boolean
  openai_model: string
  ollama_base_url: string
  ollama_model: string
  feature_classify: boolean
  feature_summarize: boolean
  feature_kb_suggest: boolean
}

export interface AIStatusResult {
  enabled: boolean
  provider: string | null
  features: { classify: boolean; summarize: boolean; kb_suggest: boolean }
}

export function fetchAISettings(): Promise<AISettingsData> {
  return request<AISettingsData>('/admin/ai-settings')
}

export function updateAISettings(data: Partial<AISettingsData> & { openai_api_key?: string }): Promise<AISettingsData> {
  return request<AISettingsData>('/admin/ai-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function testAIConnection(params?: {
  provider: string
  openai_api_key?: string
  openai_model: string
  ollama_base_url: string
  ollama_model: string
}): Promise<{ ok: boolean; provider: string; sample_result: AIClassifyResult }> {
  return request('/admin/ai-settings/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
    timeoutMs: AI_TIMEOUT_MS,
  })
}

export function fetchAIStatus(): Promise<AIStatusResult> {
  return request<AIStatusResult>('/admin/ai-settings/status')
}

export interface OllamaModel {
  name: string
  size_gb: number
  modified_at: string
  family: string
  parameter_size: string
}

export function fetchOllamaModels(baseUrl: string): Promise<{ base_url: string; models: OllamaModel[] }> {
  return request('/admin/ai-settings/ollama-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_url: baseUrl }),
  })
}

export function bulkUpdateTickets(data: {
  iids: number[]
  project_id: string
  action: string
  value?: string
}): Promise<{ success: number[]; errors: { iid: number; error: string }[] }> {
  return request('/tickets/bulk', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// Time Tracking
// ---------------------------------------------------------------------------

export function fetchTimeEntries(iid: number, projectId: string): Promise<{ total_minutes: number; entries: TimeEntry[] }> {
  return request(`/tickets/${iid}/time?project_id=${projectId}`)
}

export function logTime(iid: number, projectId: string, minutes: number, description?: string): Promise<TimeEntry> {
  return request(`/tickets/${iid}/time?project_id=${projectId}`, {
    method: 'POST',
    body: JSON.stringify({ minutes, description }),
  })
}

export function deleteTimeEntry(iid: number, projectId: string, entryId: number): Promise<void> {
  return request(`/tickets/${iid}/time/${entryId}?project_id=${projectId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Ticket Links
// ---------------------------------------------------------------------------

export function fetchTicketLinks(iid: number, projectId: string): Promise<TicketLink[]> {
  return request(`/tickets/${iid}/links?project_id=${projectId}`)
}

export function createTicketLink(iid: number, data: { target_iid: number; project_id: string; link_type: string }): Promise<TicketLink> {
  return request(`/tickets/${iid}/links`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteTicketLink(iid: number, linkId: number | string): Promise<void> {
  return request(`/tickets/${iid}/links/${linkId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Knowledge Base
// ---------------------------------------------------------------------------

export function fetchKBArticles(params?: {
  q?: string
  category?: string
  tags?: string
  page?: number
  per_page?: number
}): Promise<{ total: number; page: number; per_page: number; articles: KBArticle[] }> {
  return request(`/kb/articles${buildQuery(params)}`)
}

export function fetchKBArticle(idOrSlug: string | number): Promise<KBArticle> {
  return request(`/kb/articles/${idOrSlug}`)
}

export function createKBArticle(data: KBArticleCreate): Promise<KBArticle> {
  return request('/kb/articles', { method: 'POST', body: JSON.stringify(data) })
}

export function updateKBArticle(id: number, data: KBArticleCreate): Promise<KBArticle> {
  return request(`/kb/articles/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteKBArticle(id: number): Promise<void> {
  return request(`/kb/articles/${id}`, { method: 'DELETE' })
}

export function publishKBArticle(id: number, published: boolean): Promise<{ id: number; published: boolean }> {
  return request(`/kb/articles/${id}/publish?published=${published}`, { method: 'PATCH' })
}

export interface KBRevision {
  id: number
  revision_number: number
  title: string
  editor_name: string
  created_at: string
  change_summary?: string | null
}

export function fetchKBRevisions(articleId: number): Promise<KBRevision[]> {
  return request(`/kb/articles/${articleId}/revisions`)
}

export function fetchKBRevisionDetail(articleId: number, revisionId: number): Promise<KBRevision & { content: string; tags: string[] }> {
  return request(`/kb/articles/${articleId}/revisions/${revisionId}`)
}

export function restoreKBRevision(articleId: number, revisionId: number): Promise<{ ok: boolean }> {
  return request(`/kb/articles/${articleId}/revisions/${revisionId}/restore`, { method: 'POST' })
}

export function suggestKBArticles(q: string, limit = 3, category?: string, desc?: string): Promise<KBArticle[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  if (category) params.set('category', category)
  if (desc) params.set('desc', desc.slice(0, 300))
  return request(`/kb/suggest?${params}`)
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function fetchAdminUsers(): Promise<UserRole[]> {
  return request<{ items: UserRole[] }>('/admin/users').then(r => r.items ?? r)
}

/** 고위험 관리 작업 전 Sudo 재인증 — HttpOnly 쿠키 itsm_sudo 를 서버가 설정한다. */
export function triggerSudo(): Promise<{ ok: boolean; expires_in: number }> {
  return request('/auth/sudo', { method: 'POST' })
}

export function updateUserRole(gitlabUserId: number, role: string): Promise<{ gitlab_user_id: number; role: string }> {
  return request(`/admin/users/${gitlabUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function fetchAuditLogs(params?: {
  page?: number
  per_page?: number
  resource_type?: string
  actor_id?: string
  actor_username?: string
  action?: string
  from_date?: string
  to_date?: string
}): Promise<{ total: number; page: number; per_page: number; logs: AuditLogEntry[] }> {
  return request(`/admin/audit${buildQuery(params)}`)
}

/** 커서 기반 감사 로그 조회 — 무한 스크롤용 */
export function fetchAuditLogsCursor(params?: {
  cursor_id?: number
  limit?: number
  actor_username?: string
  resource_type?: string
  action?: string
}): Promise<{ items: AuditLogEntry[]; next_cursor: number | null; has_more: boolean }> {
  return request(`/admin/audit/cursor${buildQuery(params)}`)
}

export async function downloadAuditLogs(params?: {
  action?: string
  from_date?: string
  to_date?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/audit/download${buildQuery(params)}`, { credentials: 'include' })
  if (!res.ok) throw new Error('다운로드 실패')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const cd = res.headers.get('Content-Disposition') ?? ''
  const filename = cd.match(/filename=([^;]+)/)?.[1] ?? 'audit.csv'
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function fetchAssignmentRules(): Promise<AssignmentRule[]> {
  return request('/admin/assignment-rules')
}

export function createAssignmentRule(data: Omit<AssignmentRule, 'id' | 'created_by' | 'created_at'>): Promise<AssignmentRule> {
  return request('/admin/assignment-rules', { method: 'POST', body: JSON.stringify(data) })
}

export function updateAssignmentRule(id: number, data: Partial<AssignmentRule>): Promise<AssignmentRule> {
  return request(`/admin/assignment-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteAssignmentRule(id: number): Promise<void> {
  return request(`/admin/assignment-rules/${id}`, { method: 'DELETE' })
}

export function fetchBreachedSLA(): Promise<SLARecord[]> {
  return request('/admin/sla/breached')
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function fetchCurrentStats(params?: { from?: string; to?: string; project_id?: string }): Promise<RealtimeStats> {
  return request<RealtimeStats>(`/reports/current-stats${buildQuery(params)}`)
}

export function fetchRatingStats(params?: { from?: string; to?: string }): Promise<RatingStats> {
  return request<RatingStats>(`/reports/ratings${buildQuery(params)}`)
}

export function fetchBreakdown(params?: { from?: string; to?: string; project_id?: string }): Promise<BreakdownStats> {
  return request<BreakdownStats>(`/reports/breakdown${buildQuery(params)}`)
}

export function fetchTrends(params?: { from?: string; to?: string; project_id?: string }): Promise<Record<string, unknown>[]> {
  return request(`/reports/trends${buildQuery(params)}`)
}

export function exportReport(params?: { from?: string; to?: string; project_id?: string }): string {
  const query = buildQuery({ format: 'csv', ...params })
  return `${API_BASE}/reports/export${query}`
}

export function exportReportXlsx(params?: { from?: string; to?: string; project_id?: string }): string {
  const query = buildQuery({ format: 'xlsx', ...params })
  return `${API_BASE}/reports/export${query}`
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function fetchNotifications(limit = 30): Promise<{ unread_count: number; notifications: NotificationItem[] }> {
  return request(`/notifications/?limit=${limit}`)
}

export function markNotificationRead(id: number): Promise<void> {
  return request(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead(): Promise<void> {
  return request('/notifications/read-all', { method: 'PATCH' })
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function fetchTemplates(): Promise<TicketTemplate[]> {
  return request('/templates/')
}

export function createTemplate(data: Omit<TicketTemplate, 'id' | 'created_by' | 'created_at'>): Promise<TicketTemplate> {
  return request('/templates/', { method: 'POST', body: JSON.stringify(data) })
}

export function updateTemplate(id: number, data: Omit<TicketTemplate, 'id' | 'created_by' | 'created_at'>): Promise<TicketTemplate> {
  return request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteTemplate(id: number): Promise<void> {
  return request(`/templates/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Project Forwards
// ---------------------------------------------------------------------------

export function fetchDevProjects(): Promise<DevProject[]> {
  return request('/admin/dev-projects')
}

export function fetchForwards(iid: number, projectId?: string): Promise<ForwardsResponse> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/${iid}/forwards${qs}`)
}

export function createForward(
  iid: number,
  data: { target_project_id: string; target_project_name: string; note?: string },
  projectId?: string,
): Promise<ProjectForward> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/${iid}/forwards${qs}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function deleteForward(iid: number, forwardId: number): Promise<void> {
  return request(`/tickets/${iid}/forwards/${forwardId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// G-2: Linked MRs
// ---------------------------------------------------------------------------

export function fetchLinkedMRs(iid: number, projectId?: string): Promise<LinkedMR[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<LinkedMR[]>(`/tickets/${iid}/linked-mrs${qs}`)
}

// ---------------------------------------------------------------------------
// F-7: Agent performance
// ---------------------------------------------------------------------------

export function fetchAgentPerformance(params?: { from?: string; to?: string; project_id?: string }): Promise<AgentPerformance[]> {
  return request<AgentPerformance[]>(`/reports/agent-performance${buildQuery(params)}`)
}

export function fetchDoraMetrics(params?: { days?: number; project_id?: string }): Promise<DoraMetrics> {
  return request<DoraMetrics>(`/reports/dora${buildQuery(params)}`)
}

export function fetchSLAHeatmap(params?: { weeks?: number }): Promise<{ date: string; breached: number; total: number }[]> {
  return request(`/reports/sla/heatmap${buildQuery(params)}`)
}

export function fetchCsatTrend(params?: { from?: string; to?: string; granularity?: 'weekly' | 'monthly' }): Promise<import('@/types').CsatTrendItem[]> {
  return request(`/reports/csat-trend${buildQuery(params)}`)
}

// ---------------------------------------------------------------------------
// F-1: SLA Policies
// ---------------------------------------------------------------------------

export function fetchSLAPolicies(): Promise<SLAPolicy[]> {
  return request<SLAPolicy[]>('/admin/sla-policies')
}

export function updateSLAPolicy(priority: string, data: { response_hours: number; resolve_hours: number }): Promise<SLAPolicy> {
  return request<SLAPolicy>(`/admin/sla-policies/${priority}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ---------------------------------------------------------------------------
// F-13: Saved filters
// ---------------------------------------------------------------------------

export function fetchSavedFilters(): Promise<SavedFilter[]> {
  return request<SavedFilter[]>('/filters/')
}

export function createSavedFilter(name: string, filters: Record<string, string>): Promise<SavedFilter> {
  return request<SavedFilter>('/filters/', {
    method: 'POST',
    body: JSON.stringify({ name, filters }),
  })
}

export function deleteSavedFilter(id: number): Promise<void> {
  return request(`/filters/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Service types (dynamic categories)
// ---------------------------------------------------------------------------

export function fetchServiceTypes(): Promise<ServiceType[]> {
  return request('/admin/service-types')
}

// Custom Fields
export function fetchCustomFieldDefs(includeDisabled = false): Promise<CustomFieldDef[]> {
  return request(`/admin/custom-fields${includeDisabled ? '?include_disabled=true' : ''}`)
}

export function createCustomFieldDef(data: {
  name: string; label: string; field_type: string; options?: string[]; required?: boolean; sort_order?: number
}): Promise<CustomFieldDef> {
  return request('/admin/custom-fields', { method: 'POST', body: JSON.stringify(data) })
}

export function updateCustomFieldDef(id: number, data: Partial<{
  label: string; field_type: string; options: string[]; required: boolean; enabled: boolean; sort_order: number
}>): Promise<CustomFieldDef> {
  return request(`/admin/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteCustomFieldDef(id: number): Promise<void> {
  return request(`/admin/custom-fields/${id}`, { method: 'DELETE' })
}

export function fetchTicketCustomFields(iid: number, projectId?: string): Promise<TicketCustomFieldValue[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/${iid}/custom-fields${qs}`)
}

export function setTicketCustomFields(iid: number, values: Record<string, string | null>, projectId?: string): Promise<TicketCustomFieldValue[]> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request(`/tickets/${iid}/custom-fields${qs}`, { method: 'PUT', body: JSON.stringify(values) })
}

export interface FilterOption { key: string; label: string; emoji?: string; color?: string }
export interface FilterOptions {
  statuses:   FilterOption[]
  priorities: (FilterOption & { response_hours?: number; resolve_hours?: number })[]
  categories: FilterOption[]
}

export function fetchFilterOptions(): Promise<FilterOptions> {
  return request('/admin/filter-options')
}

export function createServiceType(data: {
  label: string; description?: string; emoji?: string; color?: string; sort_order?: number
  context_label?: string; context_options?: string[]
}): Promise<ServiceType> {
  return request('/admin/service-types', { method: 'POST', body: JSON.stringify(data) })
}

export function updateServiceType(id: number, data: Partial<Pick<ServiceType, 'label' | 'description' | 'emoji' | 'color' | 'sort_order' | 'enabled' | 'context_options'>> & { context_label?: string | null }): Promise<ServiceType> {
  return request(`/admin/service-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteServiceType(id: number): Promise<void> {
  return request(`/admin/service-types/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Ticket real-time SSE stream
// ---------------------------------------------------------------------------

export function subscribeTicketEvents(
  iid: string,
  projectId: string | undefined,
  onEvent: (data: unknown) => void,
): () => void {
  const params = projectId ? `?project_id=${projectId}` : ''
  const url = `${API_BASE}/tickets/${iid}/stream${params}`
  const es = new EventSource(url, { withCredentials: true })
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)) } catch { /* ignore */ }
  }
  return () => es.close()
}

// ---------------------------------------------------------------------------
// Ticket Watchers
// ---------------------------------------------------------------------------

export interface TicketWatcher {
  id: number
  ticket_iid: number
  user_id: string
  user_name: string | null
  user_email: string | null
  created_at: string | null
}

export function fetchWatchers(iid: number): Promise<TicketWatcher[]> {
  return request<TicketWatcher[]>(`/tickets/${iid}/watchers`)
}

export function watchTicket(iid: number): Promise<TicketWatcher> {
  return request<TicketWatcher>(`/tickets/${iid}/watch`, { method: 'POST' })
}

export function unwatchTicket(iid: number): Promise<void> {
  return request(`/tickets/${iid}/watch`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Quick Replies
// ---------------------------------------------------------------------------

export interface QuickReply {
  id: number
  name: string
  content: string
  category: string | null
  created_by: string
  created_at: string | null
}

export function fetchQuickReplies(category?: string): Promise<QuickReply[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : ''
  return request<QuickReply[]>(`/quick-replies${qs}`)
}

export function createQuickReply(data: { name: string; content: string; category?: string }): Promise<QuickReply> {
  return request<QuickReply>('/quick-replies', { method: 'POST', body: JSON.stringify(data) })
}

export function updateQuickReply(id: number, data: { name: string; content: string; category?: string }): Promise<QuickReply> {
  return request<QuickReply>(`/quick-replies/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteQuickReply(id: number): Promise<void> {
  return request(`/quick-replies/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export interface FaqItem {
  id: number
  question: string
  answer: string
  category: string | null
  order_num: number
  is_active: boolean
  created_by: string
  created_at: string | null
  updated_at: string | null
}

export async function fetchFaqItems(params?: { category?: string; active_only?: boolean }): Promise<FaqItem[]> {
  const qs = buildQuery({ category: params?.category, active_only: params?.active_only === false ? 'false' : undefined })
  // 공개 엔드포인트 — 미로그인 시 리다이렉트 없이 빈 배열 반환
  const res = await fetch(`${API_BASE}/faq${qs}`, { credentials: 'include', cache: 'no-store' })
  if (!res.ok) return []
  return res.json()
}

export function createFaqItem(data: { question: string; answer: string; category?: string | null; order_num?: number; is_active?: boolean }): Promise<FaqItem> {
  return request<FaqItem>('/faq', { method: 'POST', body: JSON.stringify(data) })
}

export function bulkCreateFaqItems(items: Array<{ question: string; answer: string; category?: string | null; order_num?: number; is_active?: boolean }>): Promise<{ created: number; skipped: number }> {
  return request('/faq/bulk', { method: 'POST', body: JSON.stringify({ items }) })
}

export function updateFaqItem(id: number, data: Partial<Pick<FaqItem, 'question' | 'answer' | 'category' | 'order_num' | 'is_active'>>): Promise<FaqItem> {
  return request<FaqItem>(`/faq/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteFaqItem(id: number): Promise<void> {
  return request(`/faq/${id}`, { method: 'DELETE' })
}

// Approvals
export function fetchApprovals(ticketIid?: number, status?: string): Promise<import('@/types').ApprovalRequest[]> {
  const qs = buildQuery({ ticket_iid: ticketIid, status })
  return request(`/approvals${qs}`)
}

export function createApproval(data: { ticket_iid: number; project_id: string; approver_username?: string }): Promise<import('@/types').ApprovalRequest> {
  return request('/approvals', { method: 'POST', body: JSON.stringify(data) })
}

export function approveApproval(id: number, reason?: string): Promise<import('@/types').ApprovalRequest> {
  return request(`/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) })
}

export function rejectApproval(id: number, reason?: string): Promise<import('@/types').ApprovalRequest> {
  return request(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) })
}

// Notification preferences
export function fetchNotificationPrefs(): Promise<Record<string, { email: boolean; inapp: boolean }>> {
  return request('/notifications/prefs')
}

export function updateNotificationPrefs(prefs: Record<string, { email: boolean; inapp: boolean }>): Promise<Record<string, { email: boolean; inapp: boolean }>> {
  return request('/notifications/prefs', { method: 'PUT', body: JSON.stringify(prefs) })
}

// ---------------------------------------------------------------------------
// Celery 모니터링 (Flower API 프록시)
// ---------------------------------------------------------------------------

export interface CeleryWorker {
  name: string
  status: 'online' | 'offline'
  active_tasks: number
  reserved_tasks: number
  processed: number
  concurrency: number
  prefetch_count: number
  heartbeat_expires: number
}

export interface CeleryTask {
  uuid: string
  name: string
  state: string
  received: number | null
  started: number | null
  succeeded: number | null
  failed: number | null
  retried: number | null
  runtime: number | null
  worker: string
  exception: string
  traceback: string
  args: string
  kwargs: string
}

export interface CeleryFlowerStats {
  workers: Array<{
    name: string
    status: 'online' | 'offline'
    active_tasks: number
    processed: number
  }>
  queues: Record<string, number>
  total_active: number
  total_processed: number
  total_failed_recent: number
}

export function fetchCeleryFlowerStats(): Promise<CeleryFlowerStats> {
  return request<CeleryFlowerStats>('/admin/celery/flower/stats')
}

export function fetchCeleryFlowerWorkers(): Promise<CeleryWorker[]> {
  return request<CeleryWorker[]>('/admin/celery/flower/workers')
}

export function fetchCeleryFlowerTasks(state: string = 'ALL', limit: number = 20): Promise<CeleryTask[]> {
  return request<CeleryTask[]>(`/admin/celery/flower/tasks?state=${state}&limit=${limit}`)
}

// ---------------------------------------------------------------------------
// Gantt
// ---------------------------------------------------------------------------

export function fetchGanttData(days: number): Promise<GanttData> {
  return request<GanttData>(`/tickets/gantt?days=${days}`)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function fetchSessions(): Promise<import('@/types').SessionInfo[]> {
  return request<import('@/types').SessionInfo[]>('/auth/sessions')
}

export function revokeSession(tokenId: number): Promise<void> {
  return request(`/auth/sessions/${tokenId}`, { method: 'DELETE' })
}

export function revokeOtherSessions(): Promise<void> {
  return request('/auth/sessions', { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Dashboard config
// ---------------------------------------------------------------------------

export function fetchDashboardConfig(): Promise<{ username: string; widgets: import('@/types').DashboardWidget[] }> {
  return request('/dashboard/config')
}

export function saveDashboardConfig(config: import('@/types').DashboardConfig): Promise<{ username: string; widgets: import('@/types').DashboardWidget[] }> {
  return request('/dashboard/config', {
    method: 'PUT',
    body: JSON.stringify({ widgets: config.widgets }),
  })
}

export interface DashboardExtraStats {
  sla_breached: { iid: number; sla_deadline: string | null }[]
  sla_breached_count: number
  team_workload: { username: string; count: number }[]
}

export function fetchDashboardExtraStats(): Promise<DashboardExtraStats> {
  return request<DashboardExtraStats>('/dashboard/widgets/extra-stats')
}

// ---------------------------------------------------------------------------
// 커스텀 알림 규칙
// ---------------------------------------------------------------------------

export interface NotificationRule {
  id: number
  name: string
  enabled: boolean
  match_priorities: string[]
  match_categories: string[]
  match_states: string[]
  match_sla_warning: boolean
  notify_in_app: boolean
  notify_email: boolean
  notify_push: boolean
  created_at: string | null
  updated_at: string | null
}

export type NotificationRuleCreate = Omit<NotificationRule, 'id' | 'created_at' | 'updated_at'>
export type NotificationRuleUpdate = Partial<NotificationRuleCreate>

export function listNotificationRules(): Promise<{ rules: NotificationRule[] }> {
  return request('/notification-rules/')
}

export function createNotificationRule(data: NotificationRuleCreate): Promise<NotificationRule> {
  return request('/notification-rules/', { method: 'POST', body: JSON.stringify(data) })
}

export function updateNotificationRule(id: number, data: NotificationRuleUpdate): Promise<NotificationRule> {
  return request(`/notification-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function deleteNotificationRule(id: number): Promise<void> {
  return request(`/notification-rules/${id}`, { method: 'DELETE' })
}

// SLA pause / resume / extend
export function pauseTicketSLA(iid: number, projectId?: string): Promise<import('@/types').SLARecord> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<import('@/types').SLARecord>(`/tickets/${iid}/sla/pause${qs}`, { method: 'POST' })
}

export function resumeTicketSLA(iid: number, projectId?: string): Promise<import('@/types').SLARecord> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<import('@/types').SLARecord>(`/tickets/${iid}/sla/resume${qs}`, { method: 'POST' })
}

export function extendTicketSLA(iid: number, minutes: number, projectId?: string): Promise<import('@/types').SLARecord> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<import('@/types').SLARecord>(`/tickets/${iid}/sla/extend${qs}`, {
    method: 'POST',
    body: JSON.stringify({ minutes }),
  })
}

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Problems (Problem Management)
// ---------------------------------------------------------------------------

export interface LinkedIncident {
  iid: number
  title: string
  state: string
  priority: string
}

export interface ProblemTicket {
  iid: number
  title: string
  description: string
  state: string
  priority: string
  assignee: { id: number; username: string; name: string; avatar_url: string } | null
  created_at: string
  updated_at: string
  web_url: string
  ticket_type: string
  linked_incident_iids?: number[]
  linked_incidents?: LinkedIncident[]
}

export function listProblems(params?: {
  state?: string
  search?: string
  page?: number
  per_page?: number
}): Promise<{ problems: ProblemTicket[]; total: number; page: number; per_page: number }> {
  return request(`/problems${buildQuery(params)}`)
}

export function createProblem(body: {
  title: string
  description?: string
  priority?: string
  assignee_id?: number
}): Promise<ProblemTicket> {
  return request('/problems', { method: 'POST', body: JSON.stringify(body) })
}

export function getProblem(iid: number): Promise<ProblemTicket> {
  return request(`/problems/${iid}`)
}

export function updateProblem(iid: number, body: {
  title: string
  description?: string
  priority?: string
  assignee_id?: number | null
}): Promise<ProblemTicket> {
  return request(`/problems/${iid}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function linkIncidentToProblem(problemIid: number, incidentIid: number): Promise<object> {
  return request(`/problems/${problemIid}/link-incident`, {
    method: 'POST',
    body: JSON.stringify({ incident_iid: incidentIid }),
  })
}

export function unlinkIncidentFromProblem(problemIid: number, incidentIid: number): Promise<object> {
  return request(`/problems/${problemIid}/link-incident/${incidentIid}`, { method: 'DELETE' })
}

export function getProblemStats(): Promise<{
  total_problems: number
  total_linked_incidents: number
  avg_incidents_per_problem: number
}> {
  return request('/problems/stats/summary')
}

export function fetchPushVapidKey(): Promise<{ publicKey: string }> {
  return request('/push/vapid-public-key')
}

export function fetchPushStatus(): Promise<{ enabled: boolean; subscriptions: number }> {
  return request('/push/status')
}

export function subscribePush(subscription: { endpoint: string; p256dh: string; auth: string }): Promise<{ status: string }> {
  return request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  })
}

export function unsubscribePush(subscription: { endpoint: string; p256dh: string; auth: string }): Promise<{ status: string }> {
  return request('/push/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify(subscription),
  })
}

// ---------------------------------------------------------------------------
// SLA Dashboard
// ---------------------------------------------------------------------------

export interface SLADashboardTicket {
  iid: number
  title: string
  status: string
  priority: string
  sla_deadline: string
  elapsed_pct: number
  remaining_seconds: number
  assignee: string | null
  breached: boolean
}

export interface SLADashboard {
  breach_count: number
  warning_count: number
  on_track_count: number
  tickets: SLADashboardTicket[]
  trend: { date: string; count: number }[]
}

export function fetchSLADashboard(projectId?: string): Promise<SLADashboard> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<SLADashboard>(`/reports/sla-dashboard${qs}`)
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarTicket {
  iid: number
  title: string
  status: string
  priority: string
  created_at: string
  closed_at: string | null
  sla_deadline: string | null
  web_url: string
}

export function fetchCalendarTickets(year: number, month: number, projectId?: string): Promise<CalendarTicket[]> {
  return request<CalendarTicket[]>(`/tickets/calendar${buildQuery({ year, month, project_id: projectId })}`)
}

export interface HolidayItem {
  id: number
  date: string  // "YYYY-MM-DD"
  name: string
}

export function fetchHolidays(year: number): Promise<HolidayItem[]> {
  return request<HolidayItem[]>(`/admin/holidays/public${buildQuery({ year })}`)
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------

export interface CSVImportResult {
  imported: number
  failed: { row: number; title: string; error: string }[]
}

export async function importTicketsCSV(file: File, projectId?: string): Promise<CSVImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  const res = await fetch(`${API_BASE}/tickets/import/csv${qs}`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join('; ')
      : (err.detail || `HTTP ${res.status}`)
    throw new Error(detail)
  }
  return res.json()
}

export function downloadImportTemplate(): void {
  const a = document.createElement('a')
  a.href = `${API_BASE}/tickets/import/template`
  a.download = 'itsm_import_template.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ---------------------------------------------------------------------------
// User Avatar
// ---------------------------------------------------------------------------

export async function uploadAvatar(file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/users/me/avatar`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join('; ')
      : (err.detail || `HTTP ${res.status}`)
    throw new Error(detail)
  }
  return res.json()
}

export async function deleteAvatar(): Promise<void> {
  await fetch(`${API_BASE}/users/me/avatar`, {
    method: 'DELETE',
    credentials: 'include',
    cache: 'no-store',
  })
}

// ---------------------------------------------------------------------------
// Change Management (RFC)
// ---------------------------------------------------------------------------

export interface ChangeRequest {
  id: number
  title: string
  description: string | null
  change_type: 'standard' | 'normal' | 'emergency'
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  status: string
  related_ticket_iid: number | null
  project_id: string
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  actual_start_at: string | null
  actual_end_at: string | null
  rollback_plan: string | null
  impact: string | null
  requester_username: string
  requester_name: string | null
  approver_username: string | null
  approver_name: string | null
  approved_at: string | null
  approval_comment: string | null
  implementer_username: string | null
  result_note: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ChangeCreate {
  title: string
  description?: string
  change_type: string
  risk_level: string
  related_ticket_iid?: number
  project_id: string
  scheduled_start_at?: string
  scheduled_end_at?: string
  rollback_plan?: string
  impact?: string
}

export async function listChanges(params?: {
  status?: string; change_type?: string; risk_level?: string
  requester_username?: string; page?: number; per_page?: number
}): Promise<{ changes: ChangeRequest[]; total: number; page: number; per_page: number }> {
  return request(`/changes${buildQuery(params)}`)
}

export async function createChange(body: ChangeCreate): Promise<ChangeRequest> {
  return request('/changes', { method: 'POST', body: JSON.stringify(body) })
}

export async function getChange(id: number): Promise<ChangeRequest> {
  return request(`/changes/${id}`)
}

export async function updateChange(id: number, body: Partial<ChangeCreate>): Promise<ChangeRequest> {
  return request(`/changes/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function transitionChange(
  id: number, status: string, comment?: string
): Promise<ChangeRequest> {
  return request(`/changes/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status, comment }),
  })
}

export async function getChangeStats(): Promise<Record<string, number>> {
  return request('/changes/stats/summary')
}

// ---------------------------------------------------------------------------
// Task 4: 시간 추적 리포트
// ---------------------------------------------------------------------------

export interface TimeTrackingByAgent {
  agent_id: string
  agent_name: string
  total_minutes: number
  total_hours: number
  ticket_count: number
}

export interface TimeTrackingEntry {
  id: number
  issue_iid: number
  project_id: string
  agent_id: string
  agent_name: string
  minutes: number
  description: string | null
  logged_at: string | null
}

export interface TimeTrackingReport {
  total_minutes: number
  total_hours: number
  entry_count: number
  agent_count: number
  by_agent: TimeTrackingByAgent[]
  by_date: { date: string; minutes: number }[]
  recent_entries: TimeTrackingEntry[]
}

export function fetchTimeTrackingReport(params?: {
  project_id?: string
  agent?: string
  start?: string
  end?: string
}): Promise<TimeTrackingReport> {
  return request<TimeTrackingReport>(`/reports/time-tracking${buildQuery(params)}`)
}

// ---------------------------------------------------------------------------
// Task 6: 멀티 프로젝트 통합 뷰
// ---------------------------------------------------------------------------

export interface MultiProjectStats {
  project_id: string
  project_name: string
  total_sla_records: number
  sla_breached: number
  sla_active: number
  sla_compliance_rate: number | null
  total_time_hours: number
}

export function fetchMultiProjectStats(): Promise<{ projects: MultiProjectStats[] }> {
  return request<{ projects: MultiProjectStats[] }>('/reports/multi-project')
}

// ---------------------------------------------------------------------------
// Task 9: SLA 준수율 트렌드 리포트
// ---------------------------------------------------------------------------

export interface SLAComplianceTrend {
  week: string
  total: number
  met: number
  breached: number
  compliance_rate: number | null
}

export interface SLAComplianceReport {
  period_weeks: number
  total: number
  met: number
  breached: number
  overall_compliance_rate: number | null
  trend: SLAComplianceTrend[]
  by_priority: { priority: string; total: number; breached: number; compliance_rate: number | null }[]
}

export function fetchSLAComplianceReport(params?: {
  project_id?: string
  weeks?: number
}): Promise<SLAComplianceReport> {
  return request<SLAComplianceReport>(`/reports/sla-compliance${buildQuery(params)}`)
}

