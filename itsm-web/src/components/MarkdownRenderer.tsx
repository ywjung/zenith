'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import FilePreview from './FilePreview'

interface Props {
  content: string
  className?: string
}

function isHtml(text: string): boolean {
  return /^\s*<\/?[a-zA-Z]/.test(text) || /<[a-zA-Z][^>]*>/.test(text)
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|link|meta|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|form|link|meta|base)[^>]*\/?>/gi, '')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
    .replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'src=""')
    .replace(/src\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi, 'src=""')
    .replace(/href\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi, 'href="#"')
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
