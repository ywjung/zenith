'use client'

import { useState, useEffect, useRef } from 'react'

interface FilePreviewProps {
  url: string        // 실제 파일 URL (proxy 경로)
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const blobRef = useRef<string | null>(null)

  // Blob URL 해제 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    }
  }, [])

  const openPdf = async () => {
    setPdfLoading(true)
    setPdfModal(true)
    try {
      // frame-ancestors 'none' CSP 우회: 인증된 fetch로 Blob URL 생성
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      if (blobRef.current) URL.revokeObjectURL(blobRef.current)
      blobRef.current = objectUrl
      setBlobUrl(objectUrl)
    } catch {
      setBlobUrl(null)
    } finally {
      setPdfLoading(false)
    }
  }

  const closePdf = () => {
    setPdfModal(false)
  }

  if (isImage(name, mime)) {
    return (
      <>
        {/* 썸네일 */}
        <button
          onClick={() => setLightbox(true)}
          className="group relative block rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors cursor-zoom-in"
          title="클릭하여 원본 보기"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-48 max-w-xs object-contain bg-gray-50"
            loading="lazy"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-xs px-2 py-1 rounded">
              확대 보기
            </span>
          </div>
        </button>

        {/* 라이트박스 */}
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
        {/* PDF 미리보기 버튼 */}
        <button
          onClick={openPdf}
          className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-sm text-red-700"
        >
          <span className="text-lg">📄</span>
          <span className="font-medium truncate max-w-xs">{name}</span>
          <span className="text-xs text-red-500 shrink-0">미리보기</span>
        </button>

        {/* PDF 모달 — Blob URL 사용으로 frame-ancestors CSP 우회 */}
        {pdfModal && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
                <span className="font-medium text-gray-800 truncate">{name}</span>
                <div className="flex gap-2 shrink-0">
                  <a href={url} download={name} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                    ⬇ 다운로드
                  </a>
                  <button onClick={closePdf} className="text-xs px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200">
                    ✕ 닫기
                  </button>
                </div>
              </div>
              {pdfLoading ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                  PDF 불러오는 중...
                </div>
              ) : blobUrl ? (
                <iframe
                  src={`${blobUrl}#toolbar=1`}
                  className="flex-1 w-full rounded-b-2xl"
                  title={name}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 text-sm">
                  <p>PDF를 불러올 수 없습니다.</p>
                  <a href={url} download={name} className="text-blue-600 underline">파일 다운로드</a>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  // 기타 파일 — 다운로드 링크
  return null
}
