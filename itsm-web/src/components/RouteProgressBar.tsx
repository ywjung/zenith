'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * 라우트 변경 시 페이지 상단에 가는 progress bar를 노출.
 * Next.js App Router는 기본 NProgress가 없어 자체 구현.
 *
 * 동작:
 * 1) pathname/search params가 바뀌면 200ms 내에 로딩 시작 (잠깐 머무는 페이지엔 노출 안 함)
 * 2) 0 → 80% 까지 ease-out 으로 빠르게 채우고
 * 3) 새 페이지가 paint되면(useEffect 실행) 100% 후 페이드아웃
 */
export default function RouteProgressBar() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let mounted = true
    const startTimer = setTimeout(() => {
      if (!mounted) return
      setVisible(true)
      setProgress(15)
      // 가짜 로딩: 80%까지 ease-out
      let p = 15
      const tick = () => {
        if (!mounted) return
        p = Math.min(80, p + (80 - p) * 0.18)
        setProgress(p)
        if (p < 79) setTimeout(tick, 120)
      }
      setTimeout(tick, 80)
    }, 120)

    // 새 페이지가 마운트되면 즉시 100% 후 사라짐
    return () => {
      mounted = false
      clearTimeout(startTimer)
      setProgress(100)
      setTimeout(() => {
        setVisible(false)
        setProgress(0)
      }, 220)
    }
  }, [pathname])

  if (!visible) return null

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-0.5 z-[100] pointer-events-none"
    >
      <div
        className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 shadow-[0_0_8px_rgba(99,102,241,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  )
}
