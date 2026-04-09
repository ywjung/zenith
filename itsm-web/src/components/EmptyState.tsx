'use client'

import React from 'react'
import Link from 'next/link'

interface EmptyStateProps {
  /** 이모지 또는 SVG 노드 */
  icon?: React.ReactNode
  /** 큰 제목 */
  title: string
  /** 부연 설명 */
  description?: string
  /** CTA 버튼 — 텍스트 */
  actionLabel?: string
  /** CTA 버튼 — 링크 */
  actionHref?: string
  /** CTA 버튼 — 클릭 핸들러 */
  onAction?: () => void
  /** 컴팩트 모드 (작은 패딩) */
  compact?: boolean
  className?: string
}

/**
 * 친근한 빈 상태 컴포넌트.
 * 아이콘 + 제목 + 설명 + 선택적 CTA로 구성.
 *
 * 사용 예:
 * <EmptyState
 *   icon="📋"
 *   title="아직 등록된 티켓이 없습니다"
 *   description="새 IT 지원 요청을 등록해보세요."
 *   actionLabel="+ 새 티켓"
 *   actionHref="/tickets/new"
 * />
 */
export default function EmptyState({
  icon = '📭',
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  compact = false,
  className = '',
}: EmptyStateProps) {
  const padding = compact ? 'py-8 px-4' : 'py-16 px-6'
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${padding} ${className}`}
      role="status"
    >
      <div className={`${compact ? 'text-4xl' : 'text-6xl'} mb-4 select-none`} aria-hidden="true">
        {icon}
      </div>
      <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold text-gray-800 dark:text-gray-200 mb-2`}>
        {title}
      </h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md whitespace-pre-line">
          {description}
        </p>
      )}
      {actionLabel && (actionHref || onAction) && (
        <div className="mt-6">
          {actionHref ? (
            <Link
              href={actionHref}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              {actionLabel}
            </Link>
          ) : (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
