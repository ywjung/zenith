'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

interface ReportExportButtonProps {
  from?: string
  to?: string
  className?: string
  /** CSV로 내보낼 행 데이터 — [헤더, ...rows] 형식 */
  csvRows?: (string | number)[][]
  /** CSV 파일명 (확장자 제외) */
  csvFilename?: string
}

function escapeCsv(v: string | number): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n')
  // BOM for Excel UTF-8
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ReportExportButton({ from, to, className = '', csvRows, csvFilename = 'report' }: ReportExportButtonProps) {
  const t = useTranslations('common')
  const [open, setOpen] = useState(false)

  const handlePrint = () => {
    setOpen(false)
    const prev = document.title
    if (from && to) {
      document.title = t('report_print_title', { from, to })
    }
    window.print()
    document.title = prev
  }

  const handleCsv = () => {
    setOpen(false)
    if (!csvRows || csvRows.length === 0) {
      toast.error(t('export_no_data'))
      return
    }
    const range = from && to ? `_${from}_${to}` : ''
    downloadCsv(csvRows, `${csvFilename}${range}`)
    toast.success(t('export_csv_success', { rows: csvRows.length - 1 }))
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {t('export_button')}
        <span className="text-xs opacity-70">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-fadeIn">
          <button
            type="button"
            onClick={handlePrint}
            role="menuitem"
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('export_pdf')}
          </button>
          <button
            type="button"
            onClick={handleCsv}
            disabled={!csvRows || csvRows.length === 0}
            role="menuitem"
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('export_csv')}
          </button>
        </div>
      )}
    </div>
  )
}
