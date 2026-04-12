'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/context/AuthContext'

const TOUR_DONE_KEY = 'zenith_tour_done'
const TOUR_STEP_KEY = 'zenith_tour_step'

interface TourStep {
  target: string
  titleKey: string
  descKey: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

const COMMON_STEPS: TourStep[] = [
  { target: '[data-tour="nav-tickets"]',       titleKey: 'step_tickets_title',    descKey: 'step_tickets_desc',    position: 'bottom' },
  { target: '[data-tour="nav-new-ticket"]',    titleKey: 'step_new_ticket_title', descKey: 'step_new_ticket_desc', position: 'bottom' },
  { target: '[data-tour="global-search"]',     titleKey: 'step_search_title',     descKey: 'step_search_desc',     position: 'bottom' },
  { target: '[data-tour="notification-bell"]', titleKey: 'step_notif_title',      descKey: 'step_notif_desc',      position: 'bottom' },
]

const AGENT_STEPS: TourStep[] = [
  { target: '[data-tour="nav-kanban"]',  titleKey: 'step_kanban_title',  descKey: 'step_kanban_desc',  position: 'bottom' },
  { target: '[data-tour="nav-reports"]', titleKey: 'step_reports_title', descKey: 'step_reports_desc', position: 'bottom' },
  { target: '[data-tour="nav-admin"]',   titleKey: 'step_admin_title',   descKey: 'step_admin_desc',   position: 'bottom' },
]

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

const CARD_WIDTH = 320
const CARD_HEIGHT_APPROX = 160
const OFFSET = 12

function computeCardPosition(
  rect: TargetRect,
  position: TourStep['position'],
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0

  switch (position) {
    case 'bottom':
      top = rect.top + rect.height + OFFSET
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
      break
    case 'top':
      top = rect.top - CARD_HEIGHT_APPROX - OFFSET
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
      break
    case 'left':
      top = rect.top + rect.height / 2 - CARD_HEIGHT_APPROX / 2
      left = rect.left - CARD_WIDTH - OFFSET
      break
    case 'right':
      top = rect.top + rect.height / 2 - CARD_HEIGHT_APPROX / 2
      left = rect.left + rect.width + OFFSET
      break
  }

  // 화면 경계 보정
  left = Math.max(12, Math.min(left, vw - CARD_WIDTH - 12))
  top = Math.max(12, Math.min(top, vh - CARD_HEIGHT_APPROX - 12))

  return { top, left }
}

export default function OnboardingTour() {
  const t = useTranslations('onboarding')
  const { user, loading, isAgent } = useAuth()
  const router = useRouter()

  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      const saved = localStorage.getItem(TOUR_STEP_KEY)
      return saved ? Math.max(0, parseInt(saved, 10) || 0) : 0
    } catch { return 0 }
  })

  // 단계 변경 시 진행 상황 저장 (중간에 페이지를 떠나도 다음에 이어서 진행)
  useEffect(() => {
    if (!active) return
    try { localStorage.setItem(TOUR_STEP_KEY, String(stepIndex)) } catch { /* ignore */ }
  }, [active, stepIndex])
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const steps = isAgent
    ? [...COMMON_STEPS, ...AGENT_STEPS]
    : COMMON_STEPS

  const currentStep = steps[stepIndex]

  // 투어 시작 조건 확인 (인증된 사용자이고 미완료인 경우)
  useEffect(() => {
    if (loading) return
    if (!user) return
    const done = localStorage.getItem(TOUR_DONE_KEY)
    if (!done) {
      // 헤더가 DOM에 마운트된 뒤 시작 (약간 지연)
      const t = setTimeout(() => setActive(true), 800)
      return () => clearTimeout(t)
    }
  }, [user, loading])

  const updateTargetRect = useCallback(() => {
    if (!currentStep) return
    const el = document.querySelector(currentStep.target)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const newRect = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
    setTargetRect(newRect)
    setCardPos(computeCardPosition(newRect, currentStep.position))
  }, [currentStep])

  // 단계 변경 시 target 위치 계산
  useEffect(() => {
    if (!active) return
    updateTargetRect()
  }, [active, stepIndex, updateTargetRect])

  // 윈도우 리사이즈 시 재계산
  useEffect(() => {
    if (!active) return
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)
    return () => {
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
    }
  }, [active, updateTargetRect])

  // ESC 키 종료
  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function markDone() {
    try {
      localStorage.setItem(TOUR_DONE_KEY, '1')
      localStorage.removeItem(TOUR_STEP_KEY)
    } catch { /* ignore */ }
    setActive(false)
    setTargetRect(null)
  }

  function handleSkip() {
    markDone()
  }

  function handleNext() {
    if (stepIndex < steps.length - 1) {
      setStepIndex(i => i + 1)
    } else {
      markDone()
    }
  }

  function handlePrev() {
    if (stepIndex > 0) {
      setStepIndex(i => i - 1)
    }
  }

  if (!active || !currentStep) return null

  const isLast = stepIndex === steps.length - 1

  // target 요소를 찾지 못한 경우 다음 단계로 자동 진행
  if (!targetRect) {
    return null
  }

  return (
    <>
      {/* 오버레이: 전체 반투명 + 하이라이트 구멍 */}
      <div
        className="fixed inset-0 z-[9998] pointer-events-none"
        aria-hidden="true"
      >
        {/* 상단 */}
        <div
          className="absolute bg-black/60"
          style={{
            top: 0,
            left: 0,
            right: 0,
            height: targetRect.top - 4,
          }}
        />
        {/* 하단 */}
        <div
          className="absolute bg-black/60"
          style={{
            top: targetRect.top + targetRect.height + 4,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        {/* 좌측 */}
        <div
          className="absolute bg-black/60"
          style={{
            top: targetRect.top - 4,
            left: 0,
            width: targetRect.left - 4,
            height: targetRect.height + 8,
          }}
        />
        {/* 우측 */}
        <div
          className="absolute bg-black/60"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left + targetRect.width + 4,
            right: 0,
            height: targetRect.height + 8,
          }}
        />
        {/* 하이라이트 테두리 */}
        <div
          className="absolute rounded pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: '0 0 0 3px #3b82f6, 0 0 0 5px rgba(59,130,246,0.3)',
          }}
        />
      </div>

      {/* 클릭 차단 오버레이 (pointer-events 있음) */}
      <div
        className="fixed inset-0 z-[9997]"
        style={{ cursor: 'default' }}
        onClick={handleSkip}
        aria-label={t('skip_aria')}
      />

      {/* 말풍선 카드 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('dialog_aria', { step: stepIndex + 1, title: t(currentStep.titleKey as 'step_tickets_title') })}
        className="fixed z-[9999] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700"
        style={{
          top: cardPos.top,
          left: cardPos.left,
          width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 24px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 카드 헤더 */}
        <div className="flex items-start justify-between px-5 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800">
          <div>
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-0.5 block">
              {stepIndex + 1} / {steps.length}
            </span>
            <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug">
              {t(currentStep.titleKey as 'step_tickets_title')}
            </h3>
          </div>
          <button
            onClick={handleSkip}
            className="ml-3 mt-0.5 p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label={t('skip_aria')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 카드 본문 */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            {t(currentStep.descKey as 'step_tickets_desc')}
          </p>
        </div>

        {/* 진행률 도트 */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-200 ${
                i === stepIndex
                  ? 'w-4 h-2 bg-blue-600 dark:bg-blue-400'
                  : 'w-2 h-2 bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* 카드 푸터 */}
        <div className="flex items-center justify-between px-5 pb-4 gap-3">
          <button
            onClick={handleSkip}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          >
            {t('skip')}
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
              >
                {t('prev')}
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors font-medium"
            >
              {isLast ? t('done') : t('next')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
