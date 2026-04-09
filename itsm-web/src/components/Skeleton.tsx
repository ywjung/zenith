'use client'

import React from 'react'

interface SkeletonProps {
  className?: string
  /** 너비 — Tailwind 클래스 또는 픽셀 값 */
  width?: string | number
  /** 높이 — Tailwind 클래스 또는 픽셀 값 */
  height?: string | number
  /** 둥근 정도 — full|lg|md|sm|none */
  rounded?: 'full' | 'lg' | 'md' | 'sm' | 'none'
}

/**
 * 스켈레톤 로더 — 데이터 로딩 중 placeholder.
 * Tailwind animate-pulse + 회색 배경으로 부드러운 깜빡임 효과.
 */
export default function Skeleton({
  className = '',
  width,
  height,
  rounded = 'md',
}: SkeletonProps) {
  const roundedCls = {
    full: 'rounded-full',
    lg: 'rounded-lg',
    md: 'rounded-md',
    sm: 'rounded-sm',
    none: '',
  }[rounded]
  const style: React.CSSProperties = {}
  if (typeof width === 'number') style.width = `${width}px`
  else if (typeof width === 'string') style.width = width
  if (typeof height === 'number') style.height = `${height}px`
  else if (typeof height === 'string') style.height = height
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 ${roundedCls} ${className}`}
      style={style}
      aria-hidden="true"
    />
  )
}

/** 텍스트 1줄 스켈레톤 */
export function SkeletonText({ width = '100%', className = '' }: { width?: string | number; className?: string }) {
  return <Skeleton width={width} height={16} className={className} />
}

/** 카드 스켈레톤 (제목 + 본문 2줄) */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 ${className}`}>
      <Skeleton width="60%" height={20} />
      <Skeleton width="100%" height={14} />
      <Skeleton width="80%" height={14} />
    </div>
  )
}

/** 테이블 행 스켈레톤 */
export function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} width={i === 0 ? '40px' : i === 1 ? '40%' : '12%'} height={14} />
      ))}
    </div>
  )
}

/** 통계 위젯 스켈레톤 */
export function SkeletonStat() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <Skeleton width="50%" height={12} />
      <Skeleton width="40%" height={32} />
    </div>
  )
}
