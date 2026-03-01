import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'ITSM 포털',
  description: 'IT 서비스 관리 포털',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <AuthProvider>
          <Header />
          <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
          <footer className="text-center text-xs text-gray-400 py-6 border-t mt-10">
            ITSM 포털 · IT 서비스 관리 시스템
          </footer>
        </AuthProvider>
      </body>
    </html>
  )
}
