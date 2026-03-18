'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/constants'

interface Announcement {
  id: number
  title: string
  content: string
  type: 'info' | 'warning' | 'critical'
  enabled: boolean
  expires_at: string | null
  created_by: string
  created_at: string
}

const TYPE_CONFIG = {
  info:     { label: '일반 정보', icon: 'ℹ️', bg: 'bg-blue-50 dark:bg-blue-900/20',     border: 'border-blue-400',  text: 'text-blue-800 dark:text-blue-300',   badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  warning:  { label: '주의',     icon: '⚠️', bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-400', text: 'text-yellow-800 dark:text-yellow-300', badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' },
  critical: { label: '긴급',     icon: '🚨', bg: 'bg-red-50 dark:bg-red-900/20',       border: 'border-red-500',   text: 'text-red-900 dark:text-red-300',    badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
}

const EMPTY: Omit<Announcement, 'id' | 'created_by' | 'created_at'> = {
  title: '', content: '', type: 'info', enabled: true, expires_at: null,
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function PreviewBanner({ title, content, type }: { title: string; content: string; type: string }) {
  const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.info
  if (!title && !content) return null
  return (
    <div className={`border-l-4 px-4 py-2.5 flex items-start gap-3 text-sm rounded-r-lg ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className="shrink-0 text-base">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        {title && <span className="font-semibold">{title}</span>}
        {content && <span className="ml-2 opacity-80">{content}</span>}
      </div>
      <button className="shrink-0 opacity-50 text-lg leading-none" disabled>×</button>
    </div>
  )
}

export default function AnnouncementsPage() {
  const [list, setList] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState<number | null>(null)      // null = 신규
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/admin/announcements`, { credentials: 'include' })
      if (r.ok) setList(await r.json())
      else setError('목록을 불러오지 못했습니다.')
    } catch { setError('네트워크 오류') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY })
    setShowForm(true)
    setError('')
  }

  function openEdit(ann: Announcement) {
    setEditId(ann.id)
    setForm({
      title: ann.title,
      content: ann.content,
      type: ann.type,
      enabled: ann.enabled,
      expires_at: ann.expires_at ? ann.expires_at.slice(0, 16) : null,  // datetime-local format
    })
    setShowForm(true)
    setError('')
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('제목을 입력하세요.'); return }
    setSaving(true)
    setError('')
    const body = {
      ...form,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    }
    try {
      const url = editId !== null
        ? `${API_BASE}/admin/announcements/${editId}`
        : `${API_BASE}/admin/announcements`
      const r = await fetch(url, {
        method: editId !== null ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.detail ?? '저장 실패')
      } else {
        setShowForm(false)
        await load()
      }
    } catch { setError('네트워크 오류') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    const r = await fetch(`${API_BASE}/admin/announcements/${id}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (r.ok) { setDeleteConfirm(null); await load() }
    else setError('삭제 실패')
  }

  async function toggleEnabled(ann: Announcement) {
    try {
      const r = await fetch(`${API_BASE}/admin/announcements/${ann.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ann, enabled: !ann.enabled }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.detail ?? '상태 변경 실패')
        return
      }
      await load()
    } catch { setError('네트워크 오류') }
  }

  const activeCount = list.filter(a => a.enabled).length

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">공지사항 / 배너 관리</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              활성화된 공지사항은 로그인한 모든 사용자 화면 상단에 배너로 표시됩니다.
            </p>
            <div className="flex gap-3 mt-3 text-sm">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                전체 <strong className="text-gray-900 dark:text-gray-100">{list.length}개</strong>
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${activeCount > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                활성 <strong>{activeCount}개</strong>
              </span>
            </div>
          </div>
          <button
            onClick={openNew}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            + 공지사항 등록
          </button>
        </div>
      </div>

      {/* 유형 안내 */}
      <div className="grid grid-cols-3 gap-3">
        {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG.info][]).map(([key, cfg]) => (
          <div key={key} className={`rounded-xl border-l-4 px-4 py-3 ${cfg.bg} ${cfg.border}`}>
            <div className="flex items-center gap-2">
              <span>{cfg.icon}</span>
              <span className={`font-semibold text-sm ${cfg.text}`}>{cfg.label}</span>
            </div>
            <p className={`text-xs mt-1 ${cfg.text} opacity-70`}>
              {key === 'info'     && '일반적인 시스템 안내, 점검 예고'}
              {key === 'warning'  && '주의가 필요한 사항, 서비스 영향'}
              {key === 'critical' && '긴급 장애, 즉각 조치 필요'}
            </p>
          </div>
        ))}
      </div>

      {/* 오류 메시지 */}
      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-blue-200 dark:border-blue-700 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20 rounded-t-2xl">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200">
              {editId !== null ? '공지사항 수정' : '새 공지사항 등록'}
            </h3>
            <button
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
            >×</button>
          </div>

          <div className="p-6 space-y-5">
            {/* 유형 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">배너 유형</label>
              <div className="flex gap-3">
                {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG.info][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: key as Announcement['type'] }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                      form.type === key
                        ? `${cfg.bg} ${cfg.border} ${cfg.text}`
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <span>{cfg.icon}</span> {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 제목 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                제목 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="배너에 굵게 표시되는 제목"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
                maxLength={200}
              />
            </div>

            {/* 내용 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">내용 (선택)</label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="제목 옆에 회색으로 표시되는 보조 설명"
                rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none dark:bg-gray-700 dark:text-gray-200"
                maxLength={500}
              />
            </div>

            {/* 만료일시 + 활성화 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  만료 일시 <span className="text-gray-400 dark:text-gray-500 font-normal">(비우면 무기한)</span>
                </label>
                <input
                  type="datetime-local"
                  value={form.expires_at ?? ''}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value || null }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">노출 상태</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={`w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    form.enabled
                      ? 'bg-green-50 border-green-400 text-green-700 dark:bg-green-900/20 dark:border-green-600 dark:text-green-400'
                      : 'bg-gray-50 border-gray-300 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400'
                  }`}
                >
                  <span className="text-base">{form.enabled ? '✅' : '⏸️'}</span>
                  {form.enabled ? '활성화 (즉시 노출)' : '비활성화 (숨김)'}
                </button>
              </div>
            </div>

            {/* 미리보기 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">배너 미리보기</label>
              <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-700/50">
                <PreviewBanner title={form.title} content={form.content} type={form.type} />
                {!form.title && !form.content && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">제목을 입력하면 미리보기가 표시됩니다</p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
                ⚠️ {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                {saving ? '저장 중...' : editId !== null ? '수정 완료' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm animate-pulse">불러오는 중...</div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-4xl mb-3">📢</p>
            <p className="text-gray-500 text-sm">등록된 공지사항이 없습니다.</p>
            <button onClick={openNew} className="mt-3 text-blue-600 text-sm hover:underline">
              첫 공지사항 등록하기
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3 text-left w-20">유형</th>
                <th className="px-5 py-3 text-left">제목 / 내용</th>
                <th className="px-5 py-3 text-center w-24">상태</th>
                <th className="px-5 py-3 text-left w-36">만료</th>
                <th className="px-5 py-3 text-left w-32">등록자 / 일시</th>
                <th className="px-5 py-3 text-center w-28">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {list.map(ann => {
                const cfg = TYPE_CONFIG[ann.type] ?? TYPE_CONFIG.info
                const isExpired = ann.expires_at ? new Date(ann.expires_at) < new Date() : false
                return (
                  <tr key={ann.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${!ann.enabled || isExpired ? 'opacity-50' : ''}`}>
                    {/* 유형 */}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>

                    {/* 제목 / 내용 */}
                    <td className="px-5 py-3 max-w-0">
                      <div className={`border-l-4 pl-3 ${cfg.border}`}>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{ann.title}</p>
                        {ann.content && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{ann.content}</p>
                        )}
                      </div>
                    </td>

                    {/* 상태 */}
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => toggleEnabled(ann)}
                        title={ann.enabled ? '클릭하여 비활성화' : '클릭하여 활성화'}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          ann.enabled && !isExpired
                            ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/30'
                            : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600'
                        }`}
                      >
                        {isExpired ? '⌛ 만료' : ann.enabled ? '● 노출 중' : '○ 숨김'}
                      </button>
                    </td>

                    {/* 만료 */}
                    <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {ann.expires_at ? (
                        <span className={isExpired ? 'text-red-500 font-medium' : ''}>
                          {formatDate(ann.expires_at)}
                          {isExpired && ' (만료됨)'}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">무기한</span>
                      )}
                    </td>

                    {/* 등록자/일시 */}
                    <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
                      <div>{ann.created_by}</div>
                      <div>{formatDate(ann.created_at)}</div>
                    </td>

                    {/* 관리 버튼 */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(ann)}
                          className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          수정
                        </button>
                        {deleteConfirm === ann.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDelete(ann.id)}
                              className="text-xs px-2 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                              삭제
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(ann.id)}
                            className="text-xs px-3 py-1.5 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 사용 안내 */}
      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
        <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-3">📌 공지사항 운영 가이드</h4>
        <ul className="text-xs text-amber-700 dark:text-amber-500 space-y-2 leading-relaxed">
          <li>• 활성화된 공지사항은 <strong>로그인한 모든 사용자</strong>의 화면 상단에 즉시 표시됩니다.</li>
          <li>• 사용자가 <strong>× 버튼</strong>으로 닫아도 페이지 새로고침 시 다시 표시됩니다 (세션 유지).</li>
          <li>• <strong>만료 일시</strong>를 설정하면 해당 시각 이후 자동으로 배너가 숨겨집니다.</li>
          <li>• 상태 토글(<strong>● 노출 중 / ○ 숨김</strong>)을 클릭해 즉시 활성/비활성 전환이 가능합니다.</li>
          <li>• <strong>긴급(🚨)</strong>은 서버 장애·보안 공지, <strong>주의(⚠️)</strong>는 점검 예고, <strong>일반(ℹ️)</strong>은 정책 변경·안내에 사용하세요.</li>
          <li>• 동시에 여러 개가 활성화되면 <strong>모두 중첩</strong>되어 표시됩니다. 긴급한 것만 활성화하는 것을 권장합니다.</li>
        </ul>
      </div>
    </div>
  )
}
