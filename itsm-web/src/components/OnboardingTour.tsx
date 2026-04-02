'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

const TOUR_DONE_KEY = 'zenith_tour_done'

interface TourStep {
  target: string
  title: string
  description: string
  position: 'top' | 'bottom' | 'left' | 'right'
}

const COMMON_STEPS: TourStep[] = [
  {
    target: '[data-tour="nav-tickets"]',
    title: '티켓 목록',
    description: '접수된 모든 IT 지원 요청을 확인하고 상태별로 필터링할 수 있습니다.',
    position: 'bottom',
  },
  {
    target: '[data-tour="nav-new-ticket"]',
    title: '새 티켓 등록',
    description: '새로운 IT 지원 요청을 등록합니다. 제목, 설명, 우선순위를 입력해 제출하세요.',
    position: 'bottom',
  },
  {
    target: '[data-tour="global-search"]',
    title: '통합 검색',
    description: '티켓 번호, 제목, 키워드로 원하는 티켓을 빠르게 찾아보세요.',
    position: 'bottom',
  },
  {
    target: '[data-tour="notification-bell"]',
    title: '알림',
    description: '티켓 상태 변경, 댓글 추가 등 중요한 이벤트를 실시간으로 알려줍니다.',
    position: 'bottom',
  },
]

const AGENT_STEPS: TourStep[] = [
  {
    target: '[data-tour="nav-kanban"]',
    title: '칸반 보드',
    description: '티켓을 상태별 컬럼으로 시각화하여 전체 처리 현황을 한눈에 파악합니다.',
    position: 'bottom',
  },
  {
    target: '[data-tour="nav-reports"]',
    title: '리포트',
    description: 'SLA 준수율, 처리 시간, 카테고리별 통계 등 업무 현황을 분석합니다.',
    position: 'bottom',
  },
  {
    target: '[data-tour="nav-admin"]',
    title: '관리자 메뉴',
    description: '사용자 관리, 자동화 규칙, 알림 채널 등 시스템 설정을 관리합니다.',
    position: 'bottom',
  },
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
  const { user, loading, isAgent } = useAuth()
  const router = useRouter()

  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
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
    localStorage.setItem(TOUR_DONE_KEY, '1')
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
        aria-label="투어 건너뛰기"
      />

      {/* 말풍선 카드 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`온보딩 투어 ${stepIndex + 1}단계: ${currentStep.title}`}
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
              {currentStep.title}
            </h3>
          </div>
          <button
            onClick={handleSkip}
            className="ml-3 mt-0.5 p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label="투어 건너뛰기"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 카드 본문 */}
        <div className="px-5 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            {currentStep.description}
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
            건너뛰기
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
              >
                이전
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors font-medium"
            >
              {isLast ? '완료' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
