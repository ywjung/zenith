'use client'

import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useRef } from 'react'
import { useConfirm } from '@/components/ConfirmProvider'
import { useAuth } from '@/context/AuthContext'
import {
  fetchFaqItems, createFaqItem, updateFaqItem, deleteFaqItem, bulkCreateFaqItems,
  type FaqItem,
} from '@/lib/api'
import { errorMessage } from '@/lib/utils'

/* ─── 정적 FAQ 데이터 (일괄 가져오기 용) ─────────────────────────────── */
const STATIC_FAQ: Array<{ question: string; answer: string; category: string }> = [
  { question: '티켓을 등록한 후 얼마나 기다려야 하나요?', answer: '긴급도에 따라 SLA 목표 시간이 다릅니다. 긴급은 최초응답 4시간·해결 8시간, 높음은 8시간·24시간, 보통은 24시간·72시간, 낮음은 48시간·168시간 이내를 목표로 합니다. 티켓 상세 화면에서 SLA 잔여 시간과 배지(🟢/🟡/🟠/🔴)를 실시간으로 확인할 수 있습니다.', category: '기본 사용법' },
  { question: '"처리완료"와 "종료"의 차이는 무엇인가요?', answer: '"처리완료"는 IT팀이 작업을 마친 상태로, 사용자의 최종 확인을 기다립니다. 문제가 해결되었음을 확인하면 "종료"로 전환됩니다. 처리완료 상태에서 문제가 재발하면 재처리를 요청할 수 있습니다.', category: '기본 사용법' },
  { question: '칸반 보드는 어떻게 사용하나요?', answer: '헤더의 "칸반" 메뉴 또는 /kanban 경로로 접근합니다. 9개 컬럼에 티켓 카드가 배치되며, 카드를 드래그하여 컬럼 간 이동하면 티켓 상태가 즉시 변경됩니다. IT 개발자 이상 역할이 필요합니다.', category: '기능 안내' },
  { question: '키보드 단축키는 어떤 것이 있나요?', answer: '다음 단축키를 사용할 수 있습니다: g+t(티켓 목록), g+k(칸반 보드), g+b(지식베이스), g+r(리포트), g+a(관리자 메뉴), n(새 티켓 등록), ?(단축키 도움말 표시). 텍스트 입력 필드에서는 단축키가 자동으로 비활성화됩니다.', category: '기능 안내' },
  { question: 'API 키로 외부 시스템을 연동하려면?', answer: '관리자가 /admin/api-keys에서 API 키를 발급합니다. 외부 시스템에서 Authorization: Bearer itsm_live_xxxx 헤더를 포함하여 ITSM API를 호출합니다. 키 원문은 생성 직후에만 표시되며, 서버에는 SHA-256 해시만 저장됩니다.', category: '관리자 설정' },
  { question: 'GitLab 계정이 없어도 IT 지원을 요청할 수 있나요?', answer: '네, /portal 경로의 고객 셀프서비스 포털을 이용하면 GitLab 계정 없이도 이름·이메일·제목·내용만으로 티켓을 접수할 수 있습니다.', category: '기본 사용법' },
  { question: 'MR(Merge Request)을 머지하면 관련 티켓이 자동으로 해결되나요?', answer: '네. MR 제목이나 설명에 "Closes #N", "Fixes #N" 패턴을 포함하면, 해당 MR이 머지될 때 ITSM 티켓 #N이 자동으로 "처리완료" 상태로 전환됩니다.', category: 'GitLab 연동' },
  { question: 'SLA 에스컬레이션 정책은 어디서 설정하나요?', answer: '시스템관리자는 /admin/escalation-policies 에서 설정합니다. 우선순위·트리거·지연 시간·액션(알림 발송 / 담당자 변경 / 우선순위 자동 상향)을 조합하여 정책을 만들 수 있습니다.', category: '관리자 설정' },
  { question: 'IT 개발자(developer) 역할은 무엇이 다른가요?', answer: 'IT 개발자는 본인에게 할당된 티켓만 목록에서 조회됩니다. 댓글·내부 메모·티켓 수정·상태 변경·개발 프로젝트 전달·GitLab MR 조회·지식베이스 작성·편집이 가능합니다. 단, 전체 티켓 조회와 담당자 변경은 IT 관리자 이상에서만 가능합니다.', category: '권한/역할' },
  { question: 'Sudo 모드(관리자 재인증)는 왜 필요한가요?', answer: '관리자가 세션을 열어둔 상태에서 자리를 비운 경우 제3자가 고위험 관리 작업을 수행하는 것을 방지합니다. Sudo 토큰은 15분 유효하며, 만료 후 다시 재인증이 필요합니다.', category: '보안' },
]

const CATEGORIES = ['기본 사용법', '기능 안내', 'GitLab 연동', '관리자 설정', '권한/역할', '보안', '문제 해결']

type FormState = {
  question: string
  answer: string
  category: string
  order_num: string
  is_active: boolean
}
const EMPTY: FormState = { question: '', answer: '', category: '', order_num: '0', is_active: true }

export default function FaqAdminPage() {
  const t = useTranslations('admin.faq')
  const confirm = useConfirm()
  const { isAgent } = useAuth()
  const [items, setItems] = useState<FaqItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<FaqItem | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const [search, setSearch] = useState('')
  const formRef = useRef<HTMLDivElement>(null)

  const load = () => {
    setLoading(true)
    fetchFaqItems({ active_only: false })
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (isAgent) load() }, [isAgent])

  if (!isAgent) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-500 dark:text-gray-400">{t('no_permission')}</p>
      </div>
    )
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function openEdit(item: FaqItem) {
    setEditing(item)
    setForm({
      question: item.question,
      answer: item.answer,
      category: item.category ?? '',
      order_num: String(item.order_num),
      is_active: item.is_active,
    })
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY)
  }

  async function handleSave() {
    if (!form.question.trim() || !form.answer.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category || null,
        order_num: parseInt(form.order_num) || 0,
        is_active: form.is_active,
      }
      if (editing) {
        const updated = await updateFaqItem(editing.id, payload)
        setItems(prev => prev.map(r => r.id === editing.id ? updated : r))
      } else {
        const created = await createFaqItem(payload)
        setItems(prev => [...prev, created])
      }
      closeForm()
    } catch (e) {
      setError(errorMessage(e, t('save_failed')))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!(await confirm({ title: t('delete_confirm'), variant: 'danger' }))) return
    setError(null)
    try {
      await deleteFaqItem(id)
      setItems(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      setError(errorMessage(e, t('delete_failed')))
    }
  }

  async function handleToggleActive(item: FaqItem) {
    try {
      const updated = await updateFaqItem(item.id, { is_active: !item.is_active })
      setItems(prev => prev.map(r => r.id === item.id ? updated : r))
    } catch (e) {
      setError(errorMessage(e, t('toggle_failed')))
    }
  }

  async function handleImportStatic() {
    if (!(await confirm({ title: t('import_confirm', { n: STATIC_FAQ.length }), variant: 'danger' }))) return
    setImporting(true)
    setError(null)
    try {
      const result = await bulkCreateFaqItems(
        STATIC_FAQ.map((item, i) => ({ ...item, order_num: i, is_active: true }))
      )
      toast.success(t('import_success', { created: result.created, skipped: result.skipped }))
      load()
    } catch (e) {
      setError(errorMessage(e, t('import_failed')))
    } finally {
      setImporting(false)
    }
  }

  const displayed = items.filter(item => {
    const matchCat = !filterCat || item.category === filterCat
    const q = search.toLowerCase()
    const matchSearch = !q || item.question.toLowerCase().includes(q) || (item.answer ?? '').toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  const activeCount = items.filter(i => i.is_active).length

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('title')}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {items.length === 0 && !loading && (
            <button
              onClick={handleImportStatic}
              disabled={importing}
              className="text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? t('importing') : t('import_button')}
            </button>
          )}
          <button
            onClick={openCreate}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {t('new_item')}
          </button>
        </div>
      </div>

      {/* 통계 */}
      {items.length > 0 && (
        <div className="flex gap-3 flex-wrap text-xs text-gray-500 dark:text-gray-400">
          <span>{t('stat_total', { n: items.length })}</span>
          <span>{t('stat_active', { n: activeCount })}</span>
          <span>{t('stat_inactive', { n: items.length - activeCount })}</span>
        </div>
      )}

      {/* 오류 */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
          <span>⚠️</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs opacity-60 hover:opacity-100" aria-label={t('close_aria')}>✕</button>
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div ref={formRef} className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {editing ? t('form_edit_title', { id: editing.id }) : t('form_new_title')}
            </h3>
            <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm" aria-label={t('close_aria')}>✕</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('field_question')} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.question}
                onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                placeholder={t('question_placeholder')}
                maxLength={500}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('field_category')}</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">{t('category_uncategorized')}</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('field_order')}</label>
              <input
                type="number"
                value={form.order_num}
                onChange={e => setForm(f => ({ ...f, order_num: e.target.value }))}
                min="0"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('field_answer')} <span className="text-red-500">*</span>
                <span className="font-normal text-gray-400 ml-1">{t('answer_hint')}</span>
              </label>
              <textarea
                value={form.answer}
                onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
                rows={8}
                placeholder={t('answer_placeholder')}
                maxLength={20000}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y dark:bg-gray-800 dark:text-gray-100 font-mono"
              />
              <div className="text-xs text-gray-400 text-right mt-0.5">{form.answer.length}/20000</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="is_active" className="text-sm text-gray-700 dark:text-gray-300">{t('enable_active')}</label>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={closeForm}
              className="text-sm px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.question.trim() || !form.answer.trim()}
              className="text-sm px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? t('saving') : (editing ? t('update_save') : t('add'))}
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      {items.length > 0 && (
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('search_placeholder')}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100 placeholder:text-gray-400"
            />
          </div>
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('all_categories')}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-3xl mb-2 animate-pulse">⏳</div>
          <p className="text-sm">{t('loading')}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
          <div className="text-4xl mb-3">❓</div>
          <p className="text-sm font-medium">{t('empty_title')}</p>
          <p className="text-xs mt-1">{t('empty_hint')}</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-sm">{t('no_search_results')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((item, idx) => (
            <div
              key={item.id}
              className={`bg-white dark:bg-gray-900 border rounded-xl p-4 shadow-sm transition-opacity ${!item.is_active ? 'opacity-50' : ''} border-gray-200 dark:border-gray-700`}
            >
              <div className="flex items-start gap-3">
                {/* 번호 */}
                <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs font-bold flex items-center justify-center mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  {/* 질문 + 카테고리 */}
                  <div className="flex items-start gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug flex-1 min-w-0">
                      {item.question}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.category && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                          {item.category}
                        </span>
                      )}
                      {!item.is_active && (
                        <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                          {t('inactive_badge')}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 답변 미리보기 */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 whitespace-pre-wrap leading-relaxed">
                    {item.answer}
                  </p>
                  {/* 메타 + 액션 */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400 dark:text-gray-600">
                      {t('meta_format', { id: item.id, order: item.order_num, date: item.created_at ? new Date(item.created_at).toLocaleDateString() : '' })}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggleActive(item)}
                        className={`text-xs font-medium ${item.is_active ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200' : 'text-green-600 hover:text-green-700 dark:text-green-400'}`}
                      >
                        {item.is_active ? t('disable') : t('enable')}
                      </button>
                      <button
                        onClick={() => openEdit(item)}
                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                      >
                        {t('edit')}
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                      >
                        {t('delete')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
