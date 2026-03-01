import type { Ticket, TicketCreate, Comment, Rating, RatingCreate, GitLabProject } from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
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
  return res.json()
}

export function fetchProjects(): Promise<GitLabProject[]> {
  return request<GitLabProject[]>('/projects/')
}

export function fetchTickets(params?: {
  state?: string
  category?: string
  search?: string
  project_id?: string
}): Promise<Ticket[]> {
  const qs = new URLSearchParams()
  if (params?.state) qs.set('state', params.state)
  if (params?.category) qs.set('category', params.category)
  if (params?.search) qs.set('search', params.search)
  if (params?.project_id) qs.set('project_id', params.project_id)
  const query = qs.toString() ? `?${qs}` : ''
  return request<Ticket[]>(`/tickets/${query}`)
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

export function updateTicket(
  iid: number,
  data: { status?: string; priority?: string },
  projectId?: string,
): Promise<Ticket> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Ticket>(`/tickets/${iid}${qs}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function addComment(iid: number, body: string, projectId?: string): Promise<Comment> {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return request<Comment>(`/tickets/${iid}/comments${qs}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function createRating(iid: number, data: RatingCreate): Promise<Rating> {
  return request<Rating>(`/tickets/${iid}/ratings`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
