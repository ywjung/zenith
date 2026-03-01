import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ITSM 포털',
  description: 'IT 서비스 관리 포털',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        <header className="bg-blue-700 text-white shadow-md">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="text-xl font-bold tracking-tight hover:opacity-90">
              🛠️ ITSM 포털
            </a>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/" className="hover:underline opacity-90">
                티켓 목록
              </a>
              <a
                href="/tickets/new"
                className="bg-white text-blue-700 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 transition-colors"
              >
                + 새 티켓 등록
              </a>
            </nav>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
        <footer className="text-center text-xs text-gray-400 py-6 border-t mt-10">
          ITSM 포털 · IT 서비스 관리 시스템
        </footer>
      </body>
    </html>
  )
}
