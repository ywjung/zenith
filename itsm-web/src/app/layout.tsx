import type { Metadata } from 'next'
import './globals.css'
import { WebVitalsReporter } from './web-vitals'
import { AuthProvider } from '@/context/AuthContext'
import { ServiceTypesProvider } from '@/context/ServiceTypesContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { RoleLabelsProvider } from '@/context/RoleLabelsContext'
import Header from '@/components/Header'
import ErrorBoundary from '@/components/ErrorBoundary'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import AnnouncementBanner from '@/components/AnnouncementBanner'

export const metadata: Metadata = {
  title: 'ZENITH',
  description: 'ZENITH · IT 서비스 관리 플랫폼',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ZENITH ITSM',
  },
  icons: {
    icon: [
      { url: '/icon', type: 'image/png', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icon',
    apple: '/icons/icon-192.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 다크 모드 FOUC 방지: hydration 전에 동기적으로 dark 클래스 적용 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen transition-colors duration-200">
        <ThemeProvider>
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
            <WebVitalsReporter />
          </ServiceTypesProvider>
          </RoleLabelsProvider>
        </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
