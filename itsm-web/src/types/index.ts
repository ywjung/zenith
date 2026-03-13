export interface Ticket {
  iid: number
  title: string
  description: string
  state: 'opened' | 'closed'
  labels: string[]
  created_at: string
  updated_at: string
  web_url: string
  employee_name?: string
  employee_email?: string
  category?: string
  priority?: string
  status?: string
  project_id?: string
  department?: string
  location?: string
  assignee_id?: number
  assignee_name?: string
  assignee_username?: string
  project_path?: string
  sla_deadline?: string
  sla_breached?: boolean
  created_by_username?: string
}

export interface TicketCreate {
  title: string
  description: string
  category: string
  priority: string
  employee_name: string
  employee_email: string
  project_id?: string
  assignee_id?: number
  department?: string
  location?: string
  sla_due_date?: string
}

export interface Comment {
  id: number
  body: string
  author_name: string
  author_avatar?: string
  created_at: string
  internal?: boolean
}

export interface Rating {
  id: number
  gitlab_issue_iid: number
  username: string
  employee_name: string
  score: number
  comment?: string
  created_at: string
  updated_at?: string
}

export interface RatingCreate {
  employee_name?: string
  employee_email?: string
  score: number
  comment?: string
}

export interface GitLabProject {
  id: string
  name: string
  name_with_namespace: string
  path_with_namespace: string
}

export interface ProjectMember {
  id: number
  name: string
  username: string
  avatar_url?: string
}

export interface TicketStats {
  all: number
  open: number
  approved: number
  in_progress: number
  waiting: number
  resolved: number
  testing: number
  ready_for_release: number
  released: number
  closed: number
}

export interface TicketListResponse {
  tickets: Ticket[]
  total: number
  page: number
  per_page: number
}

export interface KBArticle {
  id: number
  title: string
  slug: string
  content?: string
  category?: string
  tags: string[]  // F-8
  author_id: string
  author_name: string
  published: boolean
  view_count: number
  created_at: string
  updated_at: string
}

export interface KBArticleCreate {
  title: string
  slug?: string
  content: string
  category?: string
  published?: boolean
  tags?: string[]  // F-8
}

export interface UserRole {
  id: number
  gitlab_user_id: number
  username: string
  name?: string
  email?: string
  organization?: string
  role: 'admin' | 'agent' | 'pl' | 'developer' | 'user'
  created_at: string
  updated_at: string
}

export interface AuditLogEntry {
  id: number
  actor_id: string
  actor_username: string
  actor_name: string | null
  actor_role: string
  action: string
  resource_type: string
  resource_id: string
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  ip_address?: string
  created_at: string
}

export interface AssignmentRule {
  id: number
  name: string
  enabled: boolean
  priority: number
  match_category?: string
  match_priority?: string
  match_keyword?: string
  assignee_gitlab_id: number
  assignee_name: string
  created_by: string
  created_at: string
}

export interface SLARecord {
  gitlab_issue_iid: number
  project_id: string
  priority: string
  sla_deadline: string
  first_response_at?: string
  resolved_at?: string
  breached: boolean
}

export interface NotificationItem {
  id: number
  title: string
  body?: string
  link?: string
  is_read: boolean
  created_at: string
}

export interface TicketTemplate {
  id: number
  name: string
  category?: string
  description: string
  enabled: boolean
  created_by: string
  created_at: string
}

export interface TimeEntry {
  id: number
  issue_iid: number
  project_id: string
  agent_id: string
  agent_name: string
  minutes: number
  description?: string
  logged_at: string
}

export interface RatingStats {
  total: number
  average: number | null
  distribution: Record<number, number>
  recent: {
    id: number
    gitlab_issue_iid: number
    employee_name: string
    score: number
    comment?: string
    created_at: string
  }[]
}

export interface TicketLink {
  id: number
  source_iid: number
  target_iid: number
  project_id: string
  link_type: 'related' | 'blocks' | 'duplicate_of'
  created_by: string
  created_at: string
}

export interface DevProject {
  id: string
  name: string
  name_with_namespace: string
}

export interface ProjectForward {
  id: number
  source_iid: number
  source_project_id: string
  target_project_id: string
  target_project_name: string
  target_iid: number
  target_web_url?: string
  note?: string
  created_by_name: string
  created_at: string
  // 전달 이슈 현재 상태 (실시간 조회)
  target_state?: string | null   // 'opened' | 'closed' | null
  target_status?: string | null  // 'open' | 'in_progress' | 'resolved' | 'closed' | null
  target_title?: string | null
  target_assignee?: string | null
}

export interface ForwardsResponse {
  forwards: ProjectForward[]
  all_closed: boolean
}

export interface BreakdownStats {
  total: number
  by_status: Record<string, number>
  by_category: Record<string, number>
  by_priority: Record<string, number>
}

export interface RealtimeStats {
  new: number
  open: number
  in_progress: number
  resolved: number
  closed: number
  sla_breached: number
  fetched_at: string
}

// F-1: SLA Policy
export interface SLAPolicy {
  id: number
  priority: string
  response_hours: number
  resolve_hours: number
  updated_by?: string
  updated_at?: string
}

// F-7: Agent performance
export interface AgentPerformance {
  agent_name: string
  agent_username: string
  assigned: number
  resolved: number
  avg_rating: number | null
  sla_met_rate: number | null
}

// F-13: Saved filter
export interface SavedFilter {
  id: number
  name: string
  filters: Record<string, string>
  created_at: string
}

// G-2: Linked MR
export interface LinkedMR {
  iid: number
  title: string
  state: string
  web_url: string
  author_name?: string
  created_at: string
  merged_at?: string
}

// Dynamic service type (category)
export interface ServiceType {
  id: number
  value: string
  label: string
  description: string | null
  emoji: string
  color: string
  sort_order: number
  enabled: boolean
  context_label: string | null
  context_options: string[]
  created_at: string
}
