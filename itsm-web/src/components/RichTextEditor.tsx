'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import { markdownToHtml } from '@/lib/utils'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Mention from '@tiptap/extension-mention'
import tippy from 'tippy.js'
import { createLowlight } from 'lowlight'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

const lowlight = createLowlight()

export interface MentionUser {
  id: string      // gitlab username
  label: string   // display name
}

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
  onImageUpload?: (file: File) => Promise<string>
  /** 에디터에 마크다운/HTML 삽입 함수를 외부에 전달 (KB 파일 첨부 등) */
  onInsertRef?: (insertFn: (markdown: string) => void) => void
  /** @멘션 제안 목록 */
  mentionUsers?: MentionUser[]
}

type ToolbarButtonProps = {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={`px-2 py-0.5 text-xs rounded transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-semibold'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

// ── @멘션 제안 팝업 컴포넌트 ────────────────────────────────────────────────
interface MentionListProps extends SuggestionProps {
  items: MentionUser[]
}

function MentionList({ items, command }: MentionListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = useCallback((index: number) => {
    const item = items[index]
    if (item) command({ id: item.id, label: item.label })
  }, [items, command])

  useEffect(() => { setSelectedIndex(0) }, [items])

  // expose keyboard handler via ref on container div
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-lg overflow-hidden text-sm z-50 min-w-[160px]">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-gray-400 text-xs">멤버 없음</div>
      ) : items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); selectItem(index) }}
          className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${index === selectedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
        >
          <span className="font-medium text-gray-900 dark:text-gray-100">@{item.id}</span>
          {item.label !== item.id && (
            <span className="ml-2 text-gray-500 dark:text-gray-400 text-xs">{item.label}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '내용을 입력하세요...',
  minHeight = '200px',
  onImageUpload,
  onInsertRef,
  mentionUsers = [],
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function toHtml(v: string): string {
    if (!v) return ''
    // HTML이면 그대로, 마크다운이면 변환
    return /^\s*<[a-zA-Z]/.test(v) ? v : markdownToHtml(v)
  }

  const mentionUsersRef = useRef<MentionUser[]>(mentionUsers)
  useEffect(() => { mentionUsersRef.current = mentionUsers }, [mentionUsers])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderLabel({ options, node }) {
          return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`
        },
        suggestion: {
          char: '@',
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase()
            return mentionUsersRef.current.filter(
              u => u.id.toLowerCase().includes(q) || u.label.toLowerCase().includes(q)
            ).slice(0, 8)
          },
          render: () => {
            let component: ReactRenderer<MentionListProps> | null = null
            let popup: ReturnType<typeof tippy> | null = null

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(MentionList as React.ComponentType<MentionListProps>, {
                  props: props as MentionListProps,
                  editor: props.editor,
                })
                if (!props.clientRect) return
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps) => {
                component?.updateProps(props as MentionListProps)
                if (!props.clientRect) return
                popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide()
                  return true
                }
                return false
              },
              onExit: () => {
                popup?.[0]?.destroy()
                component?.destroy()
                popup = null
                component = null
              },
            }
          },
        },
      }),
    ],
    content: toHtml(value),
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    immediatelyRender: false,
  })

  // Sync external value changes (e.g. template apply)
  useEffect(() => {
    if (!editor) return
    const incoming = toHtml(value)
    const current = editor.getHTML()
    if (incoming !== current) {
      editor.commands.setContent(incoming, false)
    }
  }, [value, editor])

  // 외부에서 에디터에 콘텐츠 삽입할 수 있도록 함수 등록 (KB 파일 첨부 등)
  useEffect(() => {
    if (!editor || !onInsertRef) return
    onInsertRef((markdown: string) => {
      // 이미지 마크다운 패턴: ![alt](url)
      const imgMatch = markdown.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (imgMatch) {
        editor.chain().focus().setImage({ src: imgMatch[2], alt: imgMatch[1] }).run()
        return
      }
      // 파일 링크 패턴: [name](url) — HTML <a> 태그로 변환해 삽입
      // (insertContent에 markdown 문자열을 그대로 넣으면 plain text로 저장됨)
      const linkMatch = markdown.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch) {
        const [, text, href] = linkMatch
        // javascript: URL 차단 + HTML 이스케이프 (XSS 방지)
        if (/^\s*javascript:/i.test(href)) return
        const safeText = text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
        const safeHref = href.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
        editor.chain().focus().insertContent(
          `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`
        ).run()
        return
      }
      editor.chain().focus().insertContent(markdown).run()
    })
  }, [editor, onInsertRef])

  async function handleImageFile(file: File) {
    if (!editor) return
    if (!onImageUpload) return
    try {
      const url = await onImageUpload(file)
      editor.chain().focus().setImage({ src: url }).run()
    } catch {
      // silently ignore image upload errors
    }
  }

  function handleImageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
    e.target.value = ''
  }

  if (!editor) return null

  return (
    <div className="border dark:border-gray-600 rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 dark:bg-gray-800">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-0.5 px-2 py-1 bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-600">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="굵게 (Ctrl+B)"
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="기울임 (Ctrl+I)"
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="인라인 코드"
        >
          <span className="font-mono">`·`</span>
        </ToolbarButton>
        <span className="w-px bg-gray-300 dark:bg-gray-600 mx-1 self-stretch" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="글머리 목록"
        >
          ≡
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="번호 목록"
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="인용"
        >
          &ldquo;
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          title="코드 블록"
        >
          <span className="font-mono">{'{ }'}</span>
        </ToolbarButton>
        <span className="w-px bg-gray-300 dark:bg-gray-600 mx-1 self-stretch" />
        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          title="표 삽입"
        >
          ⊞
        </ToolbarButton>
        {onImageUpload && (
          <>
            <ToolbarButton
              onClick={() => fileInputRef.current?.click()}
              title="이미지 삽입"
            >
              🖼
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="이미지 삽입"
              className="sr-only"
              onChange={handleImageInputChange}
            />
          </>
        )}
        <span className="w-px bg-gray-300 dark:bg-gray-600 mx-1 self-stretch" />
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          title="실행 취소"
        >
          ↩
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          title="다시 실행"
        >
          ↪
        </ToolbarButton>
      </div>

      {/* Editor content — 드래그로 높이 조절 가능 (resize-y) */}
      <div className="overflow-y-auto resize-y" style={{ minHeight, maxHeight: '600px' }}>
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none h-full"
        />
      </div>
    </div>
  )
}
