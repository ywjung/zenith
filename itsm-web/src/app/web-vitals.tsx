'use client'

/**
 * Web Vitals 수집 컴포넌트
 * LCP · FID · CLS · TTFB · INP 메트릭을 /api/vitals로 전송 → Prometheus 게이지
 */

import { useReportWebVitals } from 'next/web-vitals'

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    // 개발 환경에서는 콘솔 출력
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Web Vitals]', metric.name, metric.value.toFixed(2))
    }
    // API 엔드포인트로 비동기 전송 (실패해도 UX 영향 없음)
    try {
      const body = JSON.stringify({
        name: metric.name,
        value: metric.value,
        id: metric.id,
        rating: metric.rating,
      })
      // sendBeacon: 페이지 언로드 시에도 안전하게 전송
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/vitals', new Blob([body], { type: 'application/json' }))
      } else {
        fetch('/api/vitals', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
          .catch(() => {/* 무시 */})
      }
    } catch {
      // 전송 실패는 무시
    }
  })

  return null
}
