'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import FilePreview from './FilePreview'
import DOMPurify from 'dompurify'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

// SEC: 허용된 URL 스킴 — http, https, mailto, / (단일 상대경로, // protocol-relative 차단), # (앵커)
// 이전: /^(https?:|mailto:|\/|#)/i 는 //evil.com 같은 protocol-relative URL을 통과시킴 → reverse-tabnabbing
const ALLOWED_URL_PATTERN = /^(https?:|mailto:|\/(?!\/)|#)/i

interface Props {
  content: string
  className?: string
}

function isHtml(text: string): boolean {
  return /^\s*<\/?[a-zA-Z]/.test(text) || /<[a-zA-Z][^>]*>/.test(text)
}

// SEC: DOMPurify hook — 모든 외부 링크에 rel="noopener noreferrer" 강제 (reverse-tabnabbing 방지)
let dompurifyHookInstalled = false
function ensureDompurifyHook() {
  if (dompurifyHookInstalled) return
  if (typeof window === 'undefined') return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      // protocol-relative (//evil.com) 추가 방어
      if (/^\/\//.test(href)) {
        node.removeAttribute('href')
        return
      }
      // 외부 링크: target="_blank" 강제 + rel="noopener noreferrer"
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    }
  })
  dompurifyHookInstalled = true
}

// C-1: 커스텀 정규식 sanitizer를 isomorphic-dompurify로 교체
function sanitizeHtml(html: string): string {
  ensureDompurifyHook()
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
    // SEC: 허용 URI — protocol-relative (//) 차단
    ALLOWED_URI_REGEXP: /^(https?:|mailto:|\/(?!\/)|#)/i,
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

/** 코드 children에서 언어 감지 (className="language-XXX") */
function detectLanguage(children: React.ReactNode): string | null {
  if (children && typeof children === 'object' && 'props' in children) {
    const props = (children as { props?: { className?: string } }).props
    const cls = props?.className || ''
    const m = cls.match(/language-(\w+)/)
    if (m) return m[1]
  }
  return null
}

/** 코드블록 + 복사 버튼 + 언어 라벨 + 자동 syntax highlight */
function CodeBlockWithCopy({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLPreElement>(null)
  const language = detectLanguage(children)

  // 마운트 시 highlight.js로 syntax highlighting (동적 import — bundle 영향 최소화)
  useEffect(() => {
    let cancelled = false
    if (!codeRef.current) return
    const codeEl = codeRef.current.querySelector('code')
    if (!codeEl) return
    import('highlight.js/lib/common')
      .then((hljs) => {
        if (cancelled || !codeEl) return
        try {
          hljs.default.highlightElement(codeEl as HTMLElement)
        } catch {
          // ignore
        }
      })
      .catch(() => { /* highlight.js not installed; gracefully degrade */ })
    return () => { cancelled = true }
  }, [children])

  const handleCopy = async () => {
    let text = ''
    const extract = (node: React.ReactNode): void => {
      if (typeof node === 'string') text += node
      else if (Array.isArray(node)) node.forEach(extract)
      else if (node && typeof node === 'object' && 'props' in node) {
        const props = (node as { props?: { children?: React.ReactNode } }).props
        if (props?.children !== undefined) extract(props.children)
      }
    }
    extract(children)
    try {
      await navigator.clipboard.writeText(text.trim())
      setCopied(true)
      toast.success(t('code_copy_success'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('code_copy_failed'))
    }
  }

  return (
    <div className="relative group/code my-3">
      <pre ref={codeRef} className="overflow-x-auto rounded-lg bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 text-xs">{children}</pre>
      {language && (
        <span className="absolute top-2 left-3 text-[10px] uppercase font-mono tracking-wider text-gray-500 select-none">
          {language}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-600 text-gray-100 opacity-0 group-hover/code:opacity-100 transition-opacity"
        aria-label={t('code_copy_aria')}
      >
        {copied ? t('code_copied') : t('code_copy')}
      </button>
    </div>
  )
}

/** ReactMarkdown 커스텀 컴포넌트 */
const markdownComponents: Components = {
  pre({ children }) {
    return <CodeBlockWithCopy>{children}</CodeBlockWithCopy>
  },
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
