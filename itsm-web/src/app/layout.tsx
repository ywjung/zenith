import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { WebVitalsReporter } from './web-vitals'
import { AuthProvider } from '@/context/AuthContext'
import { ServiceTypesProvider } from '@/context/ServiceTypesContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { RoleLabelsProvider } from '@/context/RoleLabelsContext'
import { IntlProvider } from '@/context/IntlContext'
import Header from '@/components/Header'
import ErrorBoundary from '@/components/ErrorBoundary'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import LazyClientWidgets from '@/components/LazyClientWidgets'
import { Toaster } from 'sonner'
import OfflineBanner from '@/components/OfflineBanner'
import RouteProgressBar from '@/components/RouteProgressBar'
import MobileFab from '@/components/MobileFab'
import ScrollToTop from '@/components/ScrollToTop'
import { ConfirmProvider } from '@/components/ConfirmProvider'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'ZENITH',
  // description은 generateMetadata 대신 정적 유지 (locale 전환 시 재생성 최소화)
  description: 'ZENITH · IT Service Management',
  // OPT: viewport — 모바일 최적화 + interactive-widget 제어
  other: {
    'color-scheme': 'light dark',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ZENITH',
  },
  icons: {
    icon: [
      { url: '/icon', type: 'image/png', sizes: '32x32' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icon',
    apple: '/icons/icon-192.png',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // H2: middleware에서 생성된 nonce를 읽어 인라인 스크립트에 적용
  const nonce = (await headers()).get('x-nonce') ?? ''
  const tc = await getTranslations('common')
  return (
    <html lang="ko">
      <head>
        {/* OPT: dns-prefetch + preconnect — API/GitLab 연결 초기화 가속 */}
        <link rel="dns-prefetch" href="//localhost" />
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_API_BASE || ''} crossOrigin="use-credentials" />
        {/*
          다크 모드 FOUC 방지: hydration 전에 동기적으로 dark 클래스 적용.
          SECURITY: 이 스크립트 내용은 정적 리터럴이어야 합니다.
          사용자 제어 값(params, cookies, DB 데이터 등)을 절대 삽입하지 마세요.
          nonce는 middleware.ts에서 생성되며 CSP의 script-src에 포함됩니다.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen transition-colors duration-200">
        <ThemeProvider>
        <IntlProvider>
        <AuthProvider>
          <RoleLabelsProvider>
          <ServiceTypesProvider>
          <ConfirmProvider>
            <RouteProgressBar />
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
            >
              {tc('skip_to_main')}
            </a>
            <div className="print-hidden"><Header /></div>
            <div className="print-hidden"><AnnouncementBanner /></div>
            <main id="main-content" className="w-full px-4 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <footer className="text-center text-xs text-gray-400 dark:text-gray-600 py-6 border-t border-gray-200 dark:border-gray-800 mt-10">
              ZENITH · {tc('tagline')}
            </footer>
            <KeyboardShortcuts />
            <MobileFab />
            <ScrollToTop />
            <LazyClientWidgets />
            <OfflineBanner />
            <div aria-live="polite" aria-label={tc('toast_region')} role="status">
              <Toaster
                position="top-right"
                richColors
                closeButton
                expand={false}
                visibleToasts={3}
                toastOptions={{
                  className: 'text-sm',
                  duration: 4000,
                }}
              />
            </div>
            <WebVitalsReporter />
          </ConfirmProvider>
          </ServiceTypesProvider>
          </RoleLabelsProvider>
        </AuthProvider>
        </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
