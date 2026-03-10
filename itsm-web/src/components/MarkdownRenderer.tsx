'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  className?: string
}

function isHtml(text: string): boolean {
  return /^\s*<\/?[a-zA-Z]/.test(text) || /<[a-zA-Z][^>]*>/.test(text)
}

export default function MarkdownRenderer({ content, className = '' }: Props) {
  if (isHtml(content)) {
    return (
      <div
        className={`prose prose-sm max-w-none text-gray-800 ${className}`}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  return (
    <div className={`prose prose-sm max-w-none text-gray-800 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
