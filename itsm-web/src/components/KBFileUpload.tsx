'use client'

import { useRef, useState } from 'react'
import { API_BASE } from '@/lib/constants'

export interface KBUploadedFile {
  name: string
  markdown: string
  url: string
  proxy_path: string
  size: number
  mime: string
}

interface Props {
  /** 업로드 완료 시 호출 — 에디터에 마크다운 삽입하는 용도 */
  onInsert: (markdown: string) => void
  /** 현재 업로드된 파일 목록 (외부 상태로 관리) */
  files: KBUploadedFile[]
  onFilesChange: (files: KBUploadedFile[]) => void
  projectId?: string
}

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.pdf', '.txt', '.csv', '.zip',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📄'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📊'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime === 'text/csv') return '📊'
  if (mime === 'application/zip' || mime.includes('zip')) return '🗜️'
  return '📎'
}

export default function KBFileUpload({ onInsert, files, onFilesChange, projectId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const upload = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const url = new URL(`${API_BASE}/kb/articles/upload`)
      if (projectId) url.searchParams.set('project_id', projectId)

      const res = await fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        body,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`)
      }
      const data: KBUploadedFile = await res.json()
      onFilesChange([...files, data])
      // proxy URL로 삽입 — GitLab 네이티브 경로(/uploads/...)는 nginx가 Next.js로 라우팅해 404됨
      const proxyPath = data.proxy_path || data.url
      const proxyUrl = proxyPath
        ? `/api/tickets/uploads/proxy?path=${encodeURIComponent(proxyPath)}`
        : data.url
      const insertMarkdown = data.mime.startsWith('image/')
        ? `![${data.name}](${proxyUrl})`
        : `[📎 ${data.name}](${proxyUrl})`
      onInsert(insertMarkdown)
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const file = fileList[0]
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`허용되지 않는 파일 형식입니다. (${ALLOWED_EXTENSIONS.join(', ')})`)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('파일 크기는 10MB를 초과할 수 없습니다.')
      return
    }
    upload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const removeFile = (idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      {/* 드래그앤드롭 영역 */}
      <div
        ref={dropRef}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl px-6 py-5 cursor-pointer transition-colors select-none ${
          dragOver
            ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={e => handleFiles(e.target.files)}
        />
        {uploading ? (
          <>
            <svg className="w-6 h-6 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm text-blue-600 dark:text-blue-400">업로드 중...</span>
          </>
        ) : (
          <>
            <svg className="w-7 h-7 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="text-blue-600 dark:text-blue-400 font-medium">클릭</span>하거나 파일을 드래그하세요
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                이미지, PDF, 문서, 스프레드시트, ZIP — 최대 10MB
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-300">×</button>
        </div>
      )}

      {/* 업로드된 파일 목록 */}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-600">
              <span className="text-lg shrink-0">{fileIcon(f.mime)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{f.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{formatSize(f.size)}</p>
              </div>
              {/* 에디터에 다시 삽입 */}
              <button
                type="button"
                onClick={() => {
                  const proxyPath = f.proxy_path || f.url
                  const proxyUrl = proxyPath
                    ? `/api/tickets/uploads/proxy?path=${encodeURIComponent(proxyPath)}`
                    : f.url
                  const insertMarkdown = f.mime.startsWith('image/')
                    ? `![${f.name}](${proxyUrl})`
                    : `[📎 ${f.name}](${proxyUrl})`
                  onInsert(insertMarkdown)
                }}
                title="에디터에 삽입"
                className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 shrink-0"
              >
                삽입
              </button>
              {/* 링크 복사 */}
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(f.markdown)}
                title="마크다운 복사"
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 shrink-0"
              >
                복사
              </button>
              <button
                type="button"
                onClick={() => removeFile(i)}
                title="목록에서 제거"
                className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 shrink-0 text-lg leading-none"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
