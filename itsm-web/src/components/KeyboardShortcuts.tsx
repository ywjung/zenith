'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function KeyboardShortcuts() {
  const router = useRouter()
  const [showHelp, setShowHelp] = useState(false)
  const [gMode, setGMode] = useState(false)
  const gModeRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') { e.preventDefault(); setShowHelp(h => !h); return }
      if (e.key === 'Escape') {
        setShowHelp(false)
        setGMode(false)
        gModeRef.current = false
        clearTimeout(gTimerRef.current)
        return
      }

      if (gModeRef.current) {
        clearTimeout(gTimerRef.current)
        setGMode(false)
        gModeRef.current = false
        if (e.key === 't') router.push('/')
        if (e.key === 'k') router.push('/kanban')
        if (e.key === 'b') router.push('/kb')
        if (e.key === 'r') router.push('/reports')
        if (e.key === 'a') router.push('/admin')
        return
      }

      if (e.key === 'g') {
        setGMode(true)
        gModeRef.current = true
        gTimerRef.current = setTimeout(() => { setGMode(false); gModeRef.current = false }, 1000)
        return
      }
      if (e.key === 'n') { router.push('/tickets/new'); return }
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(gTimerRef.current)
    }
  }, [router])

  if (!showHelp) return gMode ? (
    <div className="fixed bottom-4 right-4 bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-lg z-50 shadow-lg border border-gray-700 dark:border-gray-600">
      <span className="opacity-70">g +</span> 단축키 입력 중…
    </div>
  ) : null

  const shortcuts = [
    { key: 'g → t', desc: '티켓 목록' },
    { key: 'g → k', desc: '칸반 보드' },
    { key: 'g → b', desc: '지식베이스' },
    { key: 'g → r', desc: '리포트' },
    { key: 'g → a', desc: '관리' },
    { key: 'n', desc: '새 티켓 등록' },
    { key: '⌘K / Ctrl+K', desc: '글로벌 검색' },
    { key: '?', desc: '단축키 도움말' },
    { key: 'Esc', desc: '닫기' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setShowHelp(false)}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">키보드 단축키</h2>
          <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="p-4 space-y-1">
          {shortcuts.map(s => (
            <div key={s.key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-700 dark:text-gray-300">{s.desc}</span>
              <kbd className="bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-300 shadow-sm">{s.key}</kbd>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          입력창 포커스 중에는 단축키가 비활성화됩니다.
        </div>
      </div>
    </div>
  )
}
