'use client'

/**
 * 사용자 아바타 — 이니셜 기반 + username 해시로 일관된 색상 생성.
 * 같은 username은 항상 같은 색상을 갖도록 deterministic.
 */

const COLOR_PALETTE = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-green-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-sky-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-fuchsia-500',
  'bg-pink-500',
  'bg-rose-500',
]

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function pickColor(seed: string): string {
  if (!seed) return COLOR_PALETTE[10] // default blue
  return COLOR_PALETTE[hashCode(seed) % COLOR_PALETTE.length]
}

function getInitials(name?: string | null, fallback = '?'): string {
  if (!name) return fallback
  const trimmed = name.trim()
  if (!trimmed) return fallback
  // 한글 1글자 또는 영문 첫 글자
  if (/[\uAC00-\uD7A3]/.test(trimmed[0])) {
    return trimmed[0]
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return trimmed[0].toUpperCase()
}

const SIZE_CLASSES: Record<string, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-14 h-14 text-base',
}

export default function Avatar({
  name,
  username,
  size = 'md',
  className = '',
  title,
}: {
  /** 표시할 이름 (이니셜 추출용) */
  name?: string | null
  /** 색상 해시 시드 — 보통 username (없으면 name 사용) */
  username?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  title?: string
}) {
  const seed = username || name || ''
  const color = pickColor(seed)
  const initials = getInitials(name || username)
  const sizeCls = SIZE_CLASSES[size]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-bold select-none shrink-0 ${color} ${sizeCls} ${className}`}
      title={title || name || username || undefined}
      aria-label={name || username || '사용자'}
    >
      {initials}
    </span>
  )
}
