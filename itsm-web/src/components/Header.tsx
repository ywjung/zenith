'use client'

import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'

export default function Header() {
  const { user, logout } = useAuth()

  return (
    <header className="bg-blue-700 text-white shadow-md">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-90">
          🛠️ ITSM 포털
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/" className="hover:underline opacity-90">
                티켓 목록
              </Link>
              <a
                href={process.env.NEXT_PUBLIC_GITLAB_URL || 'http://localhost:8929'}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline opacity-90"
              >
                GitLab ↗
              </a>
              <Link
                href="/tickets/new"
                className="bg-white text-blue-700 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 transition-colors"
              >
                + 새 티켓 등록
              </Link>
              <div className="flex items-center gap-2 border-l border-blue-500 pl-4">
                <span className="opacity-90 text-sm">{user.name}</span>
                <button
                  onClick={logout}
                  className="text-blue-200 hover:text-white text-xs underline"
                >
                  로그아웃
                </button>
              </div>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-white text-blue-700 px-4 py-1.5 rounded-md font-semibold hover:bg-blue-50 transition-colors"
            >
              로그인
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
