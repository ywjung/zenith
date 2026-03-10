/**
 * 애플리케이션 전역 상수 모음.
 * 여러 페이지에서 동일하게 사용되는 값들의 단일 진실 원천(Single Source of Truth).
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost/api'

// ---------------------------------------------------------------------------
// 우선순위
// ---------------------------------------------------------------------------

export const PRIORITY_OPTIONS = [
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
  { value: 'critical', label: '긴급' },
] as const

export type Priority = 'low' | 'medium' | 'high' | 'critical'

export const PRIORITY_LABELS: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
}

export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// ---------------------------------------------------------------------------
// 티켓 상태
// ---------------------------------------------------------------------------

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'resolved'
  | 'closed'
  | 'reopened'

export const STATUS_LABELS: Record<string, string> = {
  open: '접수됨',
  in_progress: '처리중',
  waiting: '대기중',
  resolved: '처리완료',
  closed: '종료',
  reopened: '재개됨',
}

/** 포털 추적 화면에서 사용하는 상세 상태 정보 */
export const STATUS_INFO: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  open: {
    label: '접수됨',
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    icon: '📥',
  },
  in_progress: {
    label: '처리 중',
    color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    icon: '⚙️',
  },
  waiting: {
    label: '대기 중',
    color: 'text-purple-600 bg-purple-50 border-purple-200',
    icon: '⏳',
  },
  resolved: {
    label: '해결됨',
    color: 'text-green-700 bg-green-50 border-green-200',
    icon: '✅',
  },
  closed: {
    label: '종료됨',
    color: 'text-gray-600 bg-gray-50 border-gray-200',
    icon: '🔒',
  },
}

// ---------------------------------------------------------------------------
// 사용자 역할
// ---------------------------------------------------------------------------

export const ROLES = ['admin', 'agent', 'developer', 'user'] as const

export type UserRole = (typeof ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '시스템 관리자',
  agent: 'IT 담당자',
  developer: '개발자',
  user: '일반 사용자',
}

// ---------------------------------------------------------------------------
// 페이지네이션
// ---------------------------------------------------------------------------

export const DEFAULT_PER_PAGE = 20
