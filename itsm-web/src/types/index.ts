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
}

export interface TicketCreate {
  title: string
  description: string
  category: string
  priority: string
  employee_name: string
  employee_email: string
  project_id?: string
}

export interface Comment {
  id: number
  body: string
  author_name: string
  author_avatar?: string
  created_at: string
}

export interface Rating {
  id: number
  gitlab_issue_iid: number
  employee_name: string
  score: number
  comment?: string
  created_at: string
}

export interface RatingCreate {
  employee_name: string
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
