import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { ServiceTypesProvider } from '@/context/ServiceTypesContext'
import Header from '@/components/Header'
import ErrorBoundary from '@/components/ErrorBoundary'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import AnnouncementBanner from '@/components/AnnouncementBanner'

export const metadata: Metadata = {
  title: 'ZENITH',
  description: 'ZENITH · IT 서비스 관리 플랫폼',
  icons: {
    icon: [
      { url: '/icon', type: 'image/png', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icon',
    apple: '/icon',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <AuthProvider>
          <ServiceTypesProvider>
            <Header />
            <AnnouncementBanner />
            <main className="w-full px-4 py-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
            <footer className="text-center text-xs text-gray-400 py-6 border-t mt-10">
              ZENITH · IT 서비스 관리 플랫폼
            </footer>
            <KeyboardShortcuts />
          </ServiceTypesProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
