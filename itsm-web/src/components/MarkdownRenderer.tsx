'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import FilePreview from './FilePreview'
import DOMPurify from 'isomorphic-dompurify'

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

/** ReactMarkdown 커스텀 링크 렌더러 */
const markdownComponents: Components = {
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

export default function MarkdownRenderer({ content, className = '' }: Props) {
  if (isHtml(content)) {
    return (
      <div
        className={`prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert ${className}`}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    )
  }

  return (
    <div className={`prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
