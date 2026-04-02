'use client'

interface ReportExportButtonProps {
  from?: string
  to?: string
  className?: string
}

export default function ReportExportButton({ from, to, className = '' }: ReportExportButtonProps) {
  const handlePrint = () => {
    const prev = document.title
    if (from && to) {
      document.title = `ZENITH ITSM 리포트 (${from} ~ ${to})`
    }
    window.print()
    document.title = prev
  }

  return (
    <button
      onClick={handlePrint}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 transition-colors ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      PDF 내보내기
    </button>
  )
}
