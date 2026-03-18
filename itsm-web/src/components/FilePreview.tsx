'use client'

import { useState } from 'react'

interface FilePreviewProps {
  url: string
  name: string
  mime?: string
}

function isImage(name: string, mime?: string): boolean {
  if (mime?.startsWith('image/')) return true
  return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)
}
function isPdf(name: string, mime?: string): boolean {
  if (mime === 'application/pdf') return true
  return /\.pdf$/i.test(name)
}

export default function FilePreview({ url, name, mime }: FilePreviewProps) {
  const [lightbox, setLightbox] = useState(false)
  const [pdfModal, setPdfModal] = useState(false)

  if (isImage(name, mime)) {
    return (
      <>
        <button
          onClick={() => setLightbox(true)}
          className="group relative block rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-zoom-in"
          title="클릭하여 원본 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-48 max-w-xs object-contain bg-gray-50 dark:bg-gray-800"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-xs px-2 py-1 rounded">
              확대 보기
            </span>
          </div>
        </button>

        {lightbox && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setLightbox(false)}
          >
            <div className="relative max-w-5xl max-h-full" onClick={e => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={name}
                className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <a
                  href={url}
                  download={name}
                  className="bg-black/50 hover:bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg"
                  onClick={e => e.stopPropagation()}
                >
                  ⬇ 다운로드
                </a>
                <button
                  onClick={() => setLightbox(false)}
                  className="bg-black/50 hover:bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg"
                >
                  ✕ 닫기
                </button>
              </div>
              <p className="text-center text-white/70 text-xs mt-2 truncate">{name}</p>
            </div>
          </div>
        )}
      </>
    )
  }

  if (isPdf(name, mime)) {
    return (
      <>
        <button
          onClick={() => setPdfModal(true)}
          className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-sm text-red-700 dark:text-red-400"
        >
          <span className="text-lg">📄</span>
          <span className="font-medium truncate max-w-xs">{name}</span>
          <span className="text-xs text-red-500 dark:text-red-500 shrink-0">미리보기</span>
        </button>

        {pdfModal && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{name}</span>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={url.includes('?') ? `${url}&download=true` : `${url}?download=true`}
                    download={name}
                    className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    ⬇ 다운로드
                  </a>
                  <button
                    onClick={() => setPdfModal(false)}
                    className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300"
                  >
                    ✕ 닫기
                  </button>
                </div>
              </div>
              {/* proxy 엔드포인트는 frame-ancestors 'self' 허용 → 인증 쿠키 자동 전송 */}
              <iframe
                src={url}
                className="flex-1 w-full rounded-b-2xl bg-white dark:bg-gray-800"
                title={name}
              />
            </div>
          </div>
        )}
      </>
    )
  }

  // 기타 파일 — 다운로드 버튼
  const ext = name.split('.').pop()?.toUpperCase() ?? 'FILE'
  return (
    <a
      href={url}
      download={name}
      className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm text-gray-700 dark:text-gray-300 no-underline"
    >
      <span className="text-base">📎</span>
      <span className="font-medium truncate max-w-xs">{name}</span>
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 font-mono">{ext}</span>
      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">⬇</span>
    </a>
  )
}
