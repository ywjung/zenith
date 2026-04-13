'use client'

import { useEffect, useState } from 'react'

/**
 * 댓글 emoji reactions — localStorage 기반 (백엔드 없이 로컬 표시).
 * 사용자가 같은 이모지를 다시 누르면 토글.
 */

const REACTIONS = ['👍', '❤️', '🎉', '👀', '🚀'] as const
type Reaction = typeof REACTIONS[number]

interface ReactionMap {
  [emoji: string]: number
}

function storageKey(commentId: number): string {
  return `comment-reactions-${commentId}`
}

function loadReactions(commentId: number): { counts: ReactionMap; my: Set<Reaction> } {
  if (typeof window === 'undefined') return { counts: {}, my: new Set() }
  try {
    const raw = localStorage.getItem(storageKey(commentId))
    if (!raw) return { counts: {}, my: new Set() }
    const data = JSON.parse(raw) as { counts?: ReactionMap; my?: Reaction[] }
    return {
      counts: data.counts ?? {},
      my: new Set(data.my ?? []),
    }
  } catch {
    return { counts: {}, my: new Set() }
  }
}

function saveReactions(commentId: number, counts: ReactionMap, my: Set<Reaction>) {
  try {
    localStorage.setItem(
      storageKey(commentId),
      JSON.stringify({ counts, my: Array.from(my) })
    )
  } catch {
    // ignore quota
  }
}

export default function CommentReactions({ commentId }: { commentId: number }) {
  const [state, setState] = useState<{ counts: ReactionMap; my: Set<Reaction> }>({ counts: {}, my: new Set() })
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setState(loadReactions(commentId))
  }, [commentId])

  const toggle = (emoji: Reaction) => {
    setState((prev) => {
      const counts = { ...prev.counts }
      const my = new Set(prev.my)
      if (my.has(emoji)) {
        my.delete(emoji)
        counts[emoji] = Math.max(0, (counts[emoji] ?? 0) - 1)
        if (counts[emoji] === 0) delete counts[emoji]
      } else {
        my.add(emoji)
        counts[emoji] = (counts[emoji] ?? 0) + 1
      }
      saveReactions(commentId, counts, my)
      return { counts, my }
    })
    setPickerOpen(false)
  }

  const activeEmojis = Object.keys(state.counts).filter((e) => (state.counts[e] ?? 0) > 0)

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {activeEmojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => toggle(emoji as Reaction)}
          className={`text-xs px-1.5 py-0.5 rounded-full border transition-all active:scale-95 ${
            state.my.has(emoji as Reaction)
              ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          aria-label={`${emoji} reaction (${state.counts[emoji]})`}
        >
          <span>{emoji}</span>
          <span className="ml-1 tabular-nums">{state.counts[emoji]}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="text-xs px-1.5 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
          title="반응 추가"
          aria-label="반응 추가"
        >
          😊+
        </button>
        {pickerOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 flex gap-0.5 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 p-1 animate-scaleIn">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggle(emoji)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-base active:scale-95"
                aria-label={`${emoji} 추가`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
