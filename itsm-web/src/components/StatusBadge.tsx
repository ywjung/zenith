const STATUS_STYLES: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  resolved: 'bg-purple-100 text-purple-800 border-purple-200',
  closed: 'bg-green-100 text-green-800 border-green-200',
}

const STATUS_LABELS: Record<string, string> = {
  open: '접수됨',
  in_progress: '처리중',
  resolved: '처리완료',
  closed: '종료',
}

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 border-gray-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
}

const CATEGORY_LABELS: Record<string, string> = {
  hardware: '🖥️ 하드웨어',
  software: '💻 소프트웨어',
  network: '🌐 네트워크',
  account: '👤 계정/권한',
  other: '📋 기타',
}

export function StatusBadge({ status }: { status?: string }) {
  const key = status ?? 'open'
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[key] ?? STATUS_STYLES.open}`}
    >
      {STATUS_LABELS[key] ?? key}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const key = priority ?? 'medium'
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_STYLES[key] ?? PRIORITY_STYLES.medium}`}
    >
      {PRIORITY_LABELS[key] ?? key}
    </span>
  )
}

export function CategoryBadge({ category }: { category?: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
      {category ? (CATEGORY_LABELS[category] ?? category) : '📋 기타'}
    </span>
  )
}
