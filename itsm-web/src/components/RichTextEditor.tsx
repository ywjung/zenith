'use client'

import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { markdownToHtml } from '@/lib/utils'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'

const lowlight = createLowlight()

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
  onImageUpload?: (file: File) => Promise<string>
  /** 에디터에 마크다운/HTML 삽입 함수를 외부에 전달 (KB 파일 첨부 등) */
  onInsertRef?: (insertFn: (markdown: string) => void) => void
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
          ? 'bg-blue-100 text-blue-700 font-semibold'
          : 'text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '내용을 입력하세요...',
  minHeight = '160px',
  onImageUpload,
  onInsertRef,
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function toHtml(v: string): string {
    if (!v) return ''
    // HTML이면 그대로, 마크다운이면 변환
    return /^\s*<[a-zA-Z]/.test(v) ? v : markdownToHtml(v)
  }

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
      } else {
        // 파일 링크 패턴: [name](url) — 현재 커서 위치에 삽입
        editor.chain().focus().insertContent(markdown).run()
      }
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
    <div className="border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-0.5 px-2 py-1 bg-gray-50 border-b">
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
        <span className="w-px bg-gray-300 mx-1 self-stretch" />
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
        <span className="w-px bg-gray-300 mx-1 self-stretch" />
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
              className="sr-only"
              onChange={handleImageInputChange}
            />
          </>
        )}
        <span className="w-px bg-gray-300 mx-1 self-stretch" />
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

      {/* Editor content */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2 text-sm text-gray-800 focus:outline-none"
        style={{ minHeight }}
      />
    </div>
  )
}
