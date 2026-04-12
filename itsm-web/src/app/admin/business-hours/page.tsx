'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { API_BASE } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

interface ScheduleItem {
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

interface Holiday {
  id: number
  date: string
  name: string
}

function defaultSchedule(): ScheduleItem[] {
  return DAY_LABELS.map((_, i) => ({
    day_of_week: i,
    start_time: '09:00',
    end_time: '18:00',
    is_active: i < 5,
  }))
}

const THIS_YEAR = new Date().getFullYear()


function getYearTabs(holidays: Holiday[], pinnedYears: number[]): number[] {
  const years = new Set(holidays.map(h => Number(h.date.slice(0, 4))))
  for (const y of pinnedYears) years.add(y)
  return Array.from(years).sort((a, b) => b - a)
}

export default function BusinessHoursPage() {
  const { isAdmin } = useAuth()
  const [schedule, setSchedule] = useState<ScheduleItem[]>(defaultSchedule())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [pinnedYears, setPinnedYears] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [selectedYear, setSelectedYear] = useState(THIS_YEAR)
  const [addingYear, setAddingYear] = useState(false)
  const [yearInput, setYearInput] = useState('')

  // New holiday form
  const [newDate, setNewDate] = useState(`${THIS_YEAR}-01-01`)
  const [newName, setNewName] = useState('')
  const [addingHoliday, setAddingHoliday] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    fetch(`${API_BASE}/admin/business-hours`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => {
        if (data.schedule?.length) {
          const merged = defaultSchedule()
          for (const s of data.schedule) {
            merged[s.day_of_week] = { ...merged[s.day_of_week], ...s }
          }
          setSchedule(merged)
        }
        setHolidays(data.holidays ?? [])
        const pinned: number[] = data.pinned_years ?? []
        // 올해·내년이 DB에 없으면 자동 등록 (최초 로드 시)
        const toAdd = [THIS_YEAR, THIS_YEAR + 1].filter(y => !pinned.includes(y))
        if (toAdd.length > 0) {
          Promise.all(toAdd.map(y =>
            fetch(`${API_BASE}/admin/holiday-years/${y}`, { method: 'POST', credentials: 'include' })
          )).then(() => setPinnedYears(Array.from(new Set([...pinned, ...toAdd])).sort((a, b) => b - a)))
        } else {
          setPinnedYears(pinned.sort((a, b) => b - a))
        }
      })
      .catch(() => setMsg({ type: 'err', text: '설정을 불러오지 못했습니다.' }))
      .finally(() => setLoading(false))
  }, [isAdmin])

  // 연도 탭 변경 시 날짜 입력 기본값 동기화
  function handleYearChange(year: number) {
    setSelectedYear(year)
    setNewDate(`${year}-01-01`)
  }

  async function addPinnedYear(year: number) {
    const r = await fetch(`${API_BASE}/admin/holiday-years/${year}`, {
      method: 'POST', credentials: 'include',
    })
    if (r.ok) {
      setPinnedYears(prev => Array.from(new Set([...prev, year])).sort((a, b) => b - a))
    }
  }

  async function removePinnedYear(year: number) {
    const r = await fetch(`${API_BASE}/admin/holiday-years/${year}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (r.ok || r.status === 204) {
      setPinnedYears(prev => prev.filter(y => y !== year))
    } else {
      const err = await r.json().catch(() => ({}))
      setMsg({ type: 'err', text: (err as { detail?: string }).detail ?? '연도 삭제 실패' })
    }
  }

  function updateRow(idx: number, field: keyof ScheduleItem, value: string | boolean) {
    setSchedule(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function saveSchedule() {
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch(`${API_BASE}/admin/business-hours`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
      })
      if (!r.ok) throw new Error((await r.json()).detail ?? '저장 실패')
      setMsg({ type: 'ok', text: '업무 시간 설정이 저장되었습니다.' })
    } catch (e: unknown) {
      setMsg({ type: 'err', text: errorMessage(e, '저장 실패') })
    } finally {
      setSaving(false)
    }
  }

  async function addHoliday() {
    if (!newDate) return
    setAddingHoliday(true)
    setMsg(null)
    try {
      const r = await fetch(`${API_BASE}/admin/holidays`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate, name: newName || null }),
      })
      if (!r.ok) throw new Error((await r.json()).detail ?? '추가 실패')
      const added: Holiday = await r.json()
      setHolidays(prev => [...prev, added].sort((a, b) => a.date.localeCompare(b.date)))
      setNewDate('')
      setNewName('')
    } catch (e: unknown) {
      setMsg({ type: 'err', text: errorMessage(e, '추가 실패') })
    } finally {
      setAddingHoliday(false)
    }
  }

  async function removeHoliday(id: number) {
    setMsg(null)
    try {
      const r = await fetch(`${API_BASE}/admin/holidays/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok && r.status !== 204) throw new Error('삭제 실패')
      setHolidays(prev => prev.filter(h => h.id !== id))
    } catch (e: unknown) {
      setMsg({ type: 'err', text: errorMessage(e, '삭제 실패') })
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500 dark:text-gray-400">관리자 권한이 필요합니다.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-gray-500">불러오는 중…</div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              SLA 업무 시간 설정
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              SLA 마감 시한은 업무 시간 기준으로 계산됩니다. 예: 업무 시간 4시간 정책은
              오후 5시 접수 시 다음 날 오전 10시가 마감이 됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* 알림 메시지 */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          msg.type === 'ok'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
        }`}>
          {msg.type === 'ok' ? '✅ ' : '❌ '}{msg.text}
        </div>
      )}

      {/* 요일별 업무 시간 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">요일별 업무 시간</h3>
          <button
            onClick={saveSchedule}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>

        <div className="divide-y divide-gray-50 dark:divide-gray-800">
          {schedule.map((row, i) => (
            <div key={i} className={`flex items-center gap-4 px-6 py-3 ${!row.is_active ? 'bg-gray-50 dark:bg-gray-800/50' : ''}`}>
              {/* 요일 */}
              <div className="w-16 shrink-0">
                <span className={`text-sm font-semibold ${
                  i >= 5 ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300'
                }`}>
                  {DAY_LABELS[i]}요일
                </span>
              </div>

              {/* 활성 토글 */}
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={row.is_active}
                  onChange={e => updateRow(i, 'is_active', e.target.checked)}
                />
                <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-blue-600 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>

              {/* 시간 범위 */}
              {row.is_active ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="time"
                    value={row.start_time}
                    onChange={e => updateRow(i, 'start_time', e.target.value)}
                    className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                  />
                  <span className="text-gray-400 dark:text-gray-500 text-sm">~</span>
                  <input
                    type="time"
                    value={row.end_time}
                    onChange={e => updateRow(i, 'end_time', e.target.value)}
                    className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-200"
                  />
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                    ({calcHours(row.start_time, row.end_time)}시간)
                  </span>
                </div>
              ) : (
                <div className="flex-1 text-sm text-gray-400 dark:text-gray-500">휴무일 — SLA 계산 제외</div>
              )}
            </div>
          ))}
        </div>

        <div className="px-6 py-3 bg-blue-50 dark:bg-blue-900/20 border-t border-blue-100 dark:border-blue-900 text-xs text-blue-600 dark:text-blue-400">
          💡 비활성(OFF) 요일은 SLA 업무 시간 계산에서 제외됩니다. 업무 시간을 설정하지 않으면 24/7 기준으로 계산됩니다.
        </div>
      </div>

      {/* 공휴일 관리 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">공휴일 관리</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">공휴일은 업무 시간 계산에서 자동으로 제외됩니다.</p>
        </div>

        {/* 연도 탭 */}
        <div className="flex items-center gap-1 px-6 pt-4 pb-0 flex-wrap">
          {getYearTabs(holidays, pinnedYears).map(year => {
            const count = holidays.filter(h => h.date.startsWith(String(year))).length
            const isActive = year === selectedYear
            const canRemove = count === 0
            return (
              <div key={year} className="relative group flex items-center">
                <button
                  onClick={() => handleYearChange(year)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  } ${canRemove ? 'pr-7' : ''}`}
                >
                  {year}년
                  {count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
                {canRemove && (
                  <button
                    onClick={async e => {
                      e.stopPropagation()
                      await removePinnedYear(year)
                      if (isActive) {
                        const remaining = getYearTabs(holidays, pinnedYears).filter(y => y !== year)
                        handleYearChange(remaining[0] ?? THIS_YEAR)
                      }
                    }}
                    title={`${year}년 탭 삭제`}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none"
                   aria-label="삭제">
                    ×
                  </button>
                )}
              </div>
            )
          })}

          {/* 연도 추가 */}
          {addingYear ? (
            <form
              className="flex items-center gap-1 ml-1"
              onSubmit={async e => {
                e.preventDefault()
                const y = parseInt(yearInput, 10)
                if (y >= 2000 && y <= 2100) {
                  await addPinnedYear(y)
                  handleYearChange(y)
                }
                setAddingYear(false)
                setYearInput('')
              }}
            >
              <input
                type="number"
                value={yearInput}
                onChange={e => setYearInput(e.target.value)}
                placeholder="연도"
                min={2000}
                max={2100}
                autoFocus
                className="w-24 border border-blue-400 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 dark:text-gray-200"
              />
              <button type="submit" className="px-2 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg">확인</button>
              <button
                type="button"
                onClick={() => { setAddingYear(false); setYearInput('') }}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg"
              >
                취소
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAddingYear(true)}
              title="연도 추가"
              className="px-3 py-2 text-sm font-medium text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-t-lg border-b-2 border-transparent transition-colors"
            >
              + 연도
            </button>
          )}
        </div>

        <div className="border-b border-gray-100 dark:border-gray-700 mx-6" />

        {/* 추가 폼 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="date"
              value={newDate}
              min={`${selectedYear}-01-01`}
              max={`${selectedYear}-12-31`}
              onChange={e => setNewDate(e.target.value)}
              className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 dark:text-gray-200"
            />
            <input
              type="text"
              placeholder="공휴일 이름 (선택)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addHoliday()}
              className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 dark:text-gray-200 dark:placeholder-gray-500 flex-1 min-w-40"
            />
            <button
              onClick={addHoliday}
              disabled={addingHoliday || !newDate}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {addingHoliday ? '추가 중…' : '+ 추가'}
            </button>
          </div>
        </div>

        {/* 선택 연도 공휴일 목록 */}
        {(() => {
          const yearHolidays = holidays.filter(h => h.date.startsWith(String(selectedYear)))
          return yearHolidays.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              {selectedYear}년 등록된 공휴일이 없습니다.
            </div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {yearHolidays.map(h => (
                <div key={h.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
                      {h.date.slice(5).replace('-', '/')}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {h.name || <span className="text-gray-400 dark:text-gray-500 italic">이름 없음</span>}
                    </span>
                  </div>
                  <button
                    onClick={() => removeHoliday(h.id)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, Math.round(mins / 60 * 10) / 10)
}
