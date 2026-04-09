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
import PWAInstallPrompt from '@/components/PWAInstallPrompt'
import OnboardingTour from '@/components/OnboardingTour'
import { Toaster } from 'sonner'
import OfflineBanner from '@/components/OfflineBanner'

export const metadata: Metadata = {
  title: 'ZENITH',
  description: 'ZENITH · IT 서비스 관리 플랫폼',
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
  return (
    <html lang="ko">
      <head>
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
            <div className="print-hidden"><Header /></div>
            <div className="print-hidden"><AnnouncementBanner /></div>
            <main className="w-full px-4 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <footer className="text-center text-xs text-gray-400 dark:text-gray-600 py-6 border-t border-gray-200 dark:border-gray-800 mt-10">
              ZENITH · IT 서비스 관리 플랫폼
            </footer>
            <KeyboardShortcuts />
            <PWAInstallPrompt />
            <OnboardingTour />
            <OfflineBanner />
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                className: 'text-sm',
                duration: 4000,
              }}
            />
            <WebVitalsReporter />
          </ServiceTypesProvider>
          </RoleLabelsProvider>
        </AuthProvider>
        </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
