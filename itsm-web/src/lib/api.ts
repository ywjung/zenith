import type {
  Ticket, TicketCreate, Comment, Rating, RatingCreate, GitLabProject, ProjectMember,
  TicketStats, TicketListResponse, KBArticle, KBArticleCreate, UserRole, AuditLogEntry,
  AssignmentRule, SLARecord, NotificationItem, TicketTemplate, TimeEntry, TicketLink,
  RatingStats, RealtimeStats, BreakdownStats, DevProject, ProjectForward, ForwardsResponse,
  SLAPolicy, AgentPerformance, SavedFilter, LinkedMR, ServiceType,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
    credentials: 'include',
  })
  if (res.status === 401) {
    // Try to refresh token before redirecting
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      // Retry original request
      const retryRes = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init?.headers },
        cache: 'no-store',
        credentials: 'include',
      })
      if (retryRes.ok) return retryRes.json()
    }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    throw new Error('로그인이 필요합니다.')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join('; ')
      : (err.detail || `HTTP ${res.status}`)
    throw new Error(detail)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json()
}

// Prevent concurrent refresh attempts — only one request proceeds at a time
let _refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      return res.ok
    } catch {
      return false
    } finally {
      _refreshPromise = null
    }
  })()
  return _refreshPromise
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
  const res = await fetch(`${API_BASE}/tickets/${iid}/ratings`, {
    cache: 'no-store',
  })
  if (res.status === 404 || !res.ok) return null
  const data = await res.json()
  return data ?? null
}

export async function deleteTicket(iid: number, projectId?: string): Promise<void> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  const res = await fetch(`${API_BASE}/tickets/${iid}${qs}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('로그인이 필요합니다.')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
}

export async function updateTicket(
  iid: number,
  data: {
    status?: string; priority?: string; assignee_id?: number;
    title?: string; description?: string; category?: string;
    resolution_note?: string; resolution_type?: string; change_reason?: string;
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
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join('; ')
      : (err.detail || `HTTP ${res.status}`)
    throw new Error(detail)
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

export async function uploadFile(
  file: File,
  projectId?: string,
): Promise<{ markdown: string; url: string; full_path: string; proxy_path: string; name: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const qs = projectId ? `?project_id=${projectId}` : ''
  const res = await fetch(`${API_BASE}/tickets/upload${qs}`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    cache: 'no-store',
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('로그인이 필요합니다.')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
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

export function deleteTicketLink(iid: number, linkId: number): Promise<void> {
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

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function fetchAdminUsers(): Promise<UserRole[]> {
  return request('/admin/users')
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
  action?: string
  from_date?: string
  to_date?: string
}): Promise<{ total: number; page: number; per_page: number; logs: AuditLogEntry[] }> {
  return request(`/admin/audit${buildQuery(params)}`)
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
