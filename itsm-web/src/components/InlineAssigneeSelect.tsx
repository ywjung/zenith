'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { updateTicket, fetchProjectMembers } from '@/lib/api'
import type { ProjectMember } from '@/types'
import Avatar from './Avatar'
import { formatName, errorMessage } from '@/lib/utils'

/**
 * 티켓 목록에서 담당자를 인라인으로 변경하는 드롭다운.
 * 에이전트가 목록에서 바로 1클릭으로 배정 가능.
 */
export default function InlineAssigneeSelect({
  iid,
  projectId,
  assigneeName,
  assigneeId,
  onChanged,
}: {
  iid: number
  projectId?: string | number | null
  assigneeName?: string | null
  assigneeId?: number | null
  onChanged?: () => void
}) {
  const t = useTranslations('inline')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (open) { setOpen(false); return }
    setOpen(true)
    setQuery('')
    setTimeout(() => searchRef.current?.focus(), 50)
    if (members.length === 0 && projectId) {
      setLoadingMembers(true)
      try {
        const m = await fetchProjectMembers(String(projectId))
        setMembers(m)
      } catch { /* ignore */ }
      finally { setLoadingMembers(false) }
    }
  }

  const handleAssign = async (memberId: number | null) => {
    setSaving(true)
    setOpen(false)
    try {
      await updateTicket(iid, { assignee_id: memberId ?? 0 }, projectId ? String(projectId) : undefined)
      toast.success(memberId ? t('assign_changed', { iid }) : t('assign_cleared', { iid }))
      onChanged?.()
    } catch (err) {
      toast.error(errorMessage(err, t('assign_failed')))
    } finally {
      setSaving(false)
    }
  }

  const displayName = assigneeName ? formatName(assigneeName) : null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        disabled={saving}
        className={`text-xs flex items-center gap-1.5 transition-colors rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-100 dark:hover:bg-gray-700 ${saving ? 'opacity-50' : ''}`}
        title={t('assign_change')}
      >
        {displayName ? (
          <>
            <Avatar name={displayName} username={assigneeName} size="xs" />
            <span className="text-blue-600 dark:text-blue-400 font-medium truncate max-w-[80px]">{displayName}</span>
          </>
        ) : (
          <span className="text-gray-300 dark:text-gray-600 italic">{t('assign_unassigned')}</span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[220px] max-h-[300px] overflow-y-auto animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 pt-1 pb-1.5 sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('assign_search_placeholder')}
              className="w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={() => handleAssign(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t('assign_none')}
          </button>
          {loadingMembers ? (
            <div className="px-3 py-2 text-xs text-gray-400">{t('assign_loading')}</div>
          ) : (() => {
            const q = query.trim().toLowerCase()
            const filtered = q ? members.filter(m => m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)) : members
            if (filtered.length === 0) return <div className="px-3 py-2 text-xs text-gray-400">{t('assign_no_results')}</div>
            return filtered.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleAssign(m.id)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  m.id === assigneeId
                    ? 'bg-blue-50 dark:bg-blue-900/30 font-semibold'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Avatar name={m.name} username={m.username} size="xs" />
                <span className="truncate">{formatName(m.name)}</span>
                {m.id === assigneeId && <span className="text-blue-500 ml-auto">✓</span>}
              </button>
            ))
          })()}
        </div>
      )}
    </div>
  )
}
