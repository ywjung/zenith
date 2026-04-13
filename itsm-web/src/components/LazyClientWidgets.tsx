'use client'

import dynamic from 'next/dynamic'

// 비-크리티컬 위젯은 client에서 lazy load — 초기 번들 축소
const PWAInstallPrompt = dynamic(() => import('@/components/PWAInstallPrompt'), { ssr: false })
const OnboardingTour = dynamic(() => import('@/components/OnboardingTour'), { ssr: false })

/**
 * 페이지 로드 후 필요해지는 비크리티컬 위젯들을 묶어서 client에서만 로드.
 * layout.tsx (server component)는 이 단일 컴포넌트만 import하면 됨.
 */
export default function LazyClientWidgets() {
  return (
    <>
      <PWAInstallPrompt />
      <OnboardingTour />
    </>
  )
}
