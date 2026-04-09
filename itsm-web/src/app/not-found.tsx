import Link from 'next/link'

export const metadata = {
  title: '404 — 페이지를 찾을 수 없습니다 · ZENITH',
}

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="text-8xl mb-6 select-none" aria-hidden="true">🔍</div>
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          요청하신 페이지가 존재하지 않거나 이동되었을 수 있습니다.
          <br />
          URL을 다시 확인해 주세요.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            🏠 대시보드로 이동
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
          >
            ❓ 도움말
          </Link>
        </div>
      </div>
    </div>
  )
}
