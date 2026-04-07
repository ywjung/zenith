'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import FilePreview from './FilePreview'
import DOMPurify from 'dompurify'

// M-6: 허용된 URL 스킴 — http, https, mailto, / (상대경로), # (앵커)만 허용
const ALLOWED_URL_PATTERN = /^(https?:|mailto:|\/|#)/i

interface Props {
  content: string
  className?: string
}

function isHtml(text: string): boolean {
  return /^\s*<\/?[a-zA-Z]/.test(text) || /<[a-zA-Z][^>]*>/.test(text)
}

// C-1: 커스텀 정규식 sanitizer를 isomorphic-dompurify로 교체
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'i', 'strong', 'em', 'u', 's', 'strike',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'a', 'img', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    // M-6: 허용되지 않는 URL 스킴 차단 (javascript:, data: 등)
    ALLOWED_URI_REGEXP: /^(https?:|mailto:|\/|#)/i,
  })
}

/** 첨부파일 프록시 URL 여부 */
function isAttachmentUrl(href: string): boolean {
  return href.includes('/uploads/proxy') || href.includes('/-/project/')
}

/** GitLab 업로드 경로를 내부 프록시 URL로 변환
 *  - /uploads/{32hex}/{file}              → proxy (GitLab 기본 markdown 형식)
 *  - /-/project/{id}/uploads/{hash}/{file} → proxy
 *  - 이미 proxy URL이거나 외부 URL        → 그대로 반환
 */
function toProxyUrl(src: string): string {
  if (!src) return src
  if (src.includes('/uploads/proxy')) return src
  if (/^\/-\/project\/\d+\/uploads\/[0-9a-f]+\//.test(src)) {
    return `/api/tickets/uploads/proxy?path=${encodeURIComponent(src)}`
  }
  // GitLab 기본 markdown: /uploads/{32hex}/{filename}
  if (/^\/uploads\/[0-9a-f]{32}\//.test(src)) {
    return `/api/tickets/uploads/proxy?path=${encodeURIComponent('/-/project/1' + src)}`
  }
  return src
}

/** URL 또는 링크 텍스트에서 파일명 추출 */
function extractFilename(href: string, linkText: string): string {
  // 링크 텍스트에서 📎 이모지 접두사 제거
  const fromText = linkText.replace(/^[📎\s]+/, '').trim()
  if (fromText) return fromText

  // URL path 파라미터에서 마지막 세그먼트
  try {
    const path = new URL(href, 'http://x').searchParams.get('path') ?? href
    return decodeURIComponent(path.split('/').pop() ?? 'file')
  } catch {
    return 'file'
  }
}

/** ReactMarkdown 커스텀 컴포넌트 */
const markdownComponents: Components = {
  // 인라인 이미지 — GitLab 업로드 경로를 프록시로 변환 후 FilePreview로 렌더링
  img({ src, alt }) {
    if (!src) return null

    // 외부 이미지(https://)는 그대로 렌더링
    if (/^https?:\/\//.test(src)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt={alt ?? ''} className="max-w-full rounded" loading="lazy" />
    }

    const proxyUrl = toProxyUrl(src)
    const name = alt || src.split('/').pop() || 'image'
    return (
      <span className="block my-2">
        <FilePreview url={proxyUrl} name={name} />
      </span>
    )
  },

  a({ href, children }) {
    if (!href) return <a href={href}>{children}</a>

    // M-6: 허용되지 않는 URL 스킴 차단
    if (!ALLOWED_URL_PATTERN.test(href)) {
      return <span>{children}</span>
    }

    if (isAttachmentUrl(href)) {
      const linkText = typeof children === 'string'
        ? children
        : Array.isArray(children)
          ? children.map(c => (typeof c === 'string' ? c : '')).join('')
          : ''
      const name = extractFilename(href, linkText)
      return (
        <span className="block my-1">
          <FilePreview url={href} name={name} />
        </span>
      )
    }

    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
}

/** HTML 콘텐츠에서 첨부파일 링크 클릭을 인터셉트해 FilePreview 모달 표시 */
function HtmlContent({ html, className }: { html: string; className: string }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href') ?? ''
    if (!isAttachmentUrl(href)) return
    e.preventDefault()
    const name = extractFilename(href, target.textContent ?? '')
    setPreview({ url: href, name })
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleClick}
      />
      {/* FilePreview 모달 — 첨부파일 링크 클릭 시 표시 */}
      {preview && (
        <div className="mt-2">
          <FilePreview url={preview.url} name={preview.name} />
        </div>
      )}
    </>
  )
}

export default function MarkdownRenderer({ content, className = '' }: Props) {
  const proseClass = `prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert ${className}`

  if (isHtml(content)) {
    return (
      <HtmlContent html={sanitizeHtml(content)} className={proseClass} />
    )
  }

  return (
    <div className={proseClass}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
