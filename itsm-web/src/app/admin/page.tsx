'use client'

import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import RequireAuth from '@/components/RequireAuth'

const MENU_GROUPS = [
  {
    title: '👥 사용자 · 권한',
    items: [
      { href: '/admin/users', label: '사용자 관리', desc: '역할 배정 · 세션 관리' },
      { href: '/admin/role-labels', label: '역할 라벨 설정', desc: '커스텀 역할명 지정' },
      { href: '/admin/ip-allowlist', label: 'IP 허용 목록', desc: '관리자/에이전트 접근 제한' },
      { href: '/admin/api-keys', label: 'API 키', desc: '외부 연동용 인증 키' },
    ],
  },
  {
    title: '⚙️ 자동화 · 워크플로우',
    items: [
      { href: '/admin/automation-rules', label: '자동화 규칙', desc: '조건별 자동 배정/상태변경' },
      { href: '/admin/assignment-rules', label: '자동 배정 규칙', desc: '카테고리별 자동 담당자 배정' },
      { href: '/admin/recurring-tickets', label: '반복 티켓', desc: '정기 점검·예방 작업 자동 생성' },
      { href: '/admin/escalation-policies', label: '에스컬레이션', desc: 'SLA 위반 시 자동 알림 정책' },
      { href: '/admin/sla-policies', label: 'SLA 정책', desc: '우선순위별 SLA 목표 시간' },
      { href: '/admin/business-hours', label: '업무 시간', desc: 'SLA 계산 기준 · 공휴일' },
    ],
  },
  {
    title: '📢 커뮤니케이션',
    items: [
      { href: '/admin/outbound-webhooks', label: '아웃바운드 웹훅', desc: 'Slack·Teams 연동' },
      { href: '/admin/notification-channels', label: '알림 채널', desc: '이메일·Telegram·인앱' },
      { href: '/admin/email-templates', label: '이메일 템플릿', desc: '알림 이메일 문구 편집' },
      { href: '/admin/email-ingest', label: '이메일 수신 설정', desc: '메일→티켓 자동 변환' },
      { href: '/admin/announcements', label: '공지 배너', desc: '시스템 공지사항 관리' },
    ],
  },
  {
    title: '📋 콘텐츠 · 서비스',
    items: [
      { href: '/admin/service-types', label: '서비스 유형', desc: '티켓 카테고리 관리' },
      { href: '/admin/service-catalog', label: '서비스 카탈로그', desc: '포털 서비스 요청 항목' },
      { href: '/admin/templates', label: '티켓 템플릿', desc: '반복 양식 사전 정의' },
      { href: '/admin/quick-replies', label: '빠른 답변', desc: '자주 쓰는 답변 템플릿' },
      { href: '/admin/custom-fields', label: '커스텀 필드', desc: '티켓 추가 입력 항목' },
      { href: '/admin/faq', label: 'FAQ 관리', desc: '포털 자주 묻는 질문' },
      { href: '/admin/labels', label: '라벨 동기화', desc: 'GitLab 라벨 관리' },
    ],
  },
  {
    title: '🔧 시스템 · 모니터링',
    items: [
      { href: '/admin/ai-settings', label: 'AI 설정', desc: 'OpenAI·Ollama 연동' },
      { href: '/admin/monitoring', label: '시스템 모니터링', desc: '성능 지표 · 캐시 관리' },
      { href: '/admin/audit', label: '감사 로그', desc: '사용자 활동 추적' },
      { href: '/admin/failed-notifications', label: '실패 알림', desc: '발송 실패 재시도' },
      { href: '/admin/celery', label: '백그라운드 작업', desc: 'Celery 태스크 현황' },
      { href: '/admin/search-index', label: '검색 인덱스', desc: '전문 검색 재색인' },
      { href: '/admin/db-cleanup', label: 'DB 정리', desc: '오래된 데이터 정리' },
      { href: '/admin/workload', label: '팀 워크로드', desc: '에이전트별 업무 분배' },
    ],
  },
]

function AdminContent() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <div className="p-8 text-center text-gray-500">관리자 권한이 필요합니다.</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">⚙️ 관리자 설정</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">시스템 설정 및 관리 기능</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{group.title}</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">{item.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminPage() {
  return <RequireAuth><AdminContent /></RequireAuth>
}
