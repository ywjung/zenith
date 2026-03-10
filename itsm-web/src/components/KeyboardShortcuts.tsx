'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function KeyboardShortcuts() {
  const router = useRouter()
  const [showHelp, setShowHelp] = useState(false)
  const [gMode, setGMode] = useState(false)

  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout>
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') { e.preventDefault(); setShowHelp(h => !h); return }
      if (e.key === 'Escape') { setShowHelp(false); setGMode(false); return }

      if (gMode) {
        clearTimeout(gTimer)
        setGMode(false)
        if (e.key === 't') router.push('/')
        if (e.key === 'k') router.push('/kanban')
        if (e.key === 'b') router.push('/kb')
        if (e.key === 'r') router.push('/reports')
        if (e.key === 'a') router.push('/admin')
        return
      }

      if (e.key === 'g') {
        setGMode(true)
        gTimer = setTimeout(() => setGMode(false), 1000)
        return
      }
      if (e.key === 'n') { router.push('/tickets/new'); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router, gMode])

  if (!showHelp) return gMode ? (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg z-50 shadow-lg">
      g + 단축키 입력 중...
    </div>
  ) : null

  const shortcuts = [
    { key: 'g → t', desc: '티켓 목록' },
    { key: 'g → k', desc: '칸반 보드' },
    { key: 'g → b', desc: '지식베이스' },
    { key: 'g → r', desc: '리포트' },
    { key: 'g → a', desc: '관리' },
    { key: 'n', desc: '새 티켓 등록' },
    { key: '⌘K', desc: '글로벌 검색' },
    { key: '?', desc: '단축키 도움말' },
    { key: 'Esc', desc: '닫기' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowHelp(false)}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">키보드 단축키</h2>
        <div className="space-y-2">
          {shortcuts.map(s => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{s.desc}</span>
              <kbd className="bg-gray-100 border border-gray-300 rounded px-2 py-0.5 text-xs font-mono">{s.key}</kbd>
            </div>
          ))}
        </div>
        <button onClick={() => setShowHelp(false)} className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700">닫기 (Esc)</button>
      </div>
    </div>
  )
}
