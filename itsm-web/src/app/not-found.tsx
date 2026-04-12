import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const t = await getTranslations('error_page')
  return {
    title: `${t('title_404')} · ZENITH`,
  }
}

export default async function NotFound() {
  const t = await getTranslations('error_page')
  return (
    <main role="main" aria-labelledby="not-found-title" className="min-h-[60vh] flex items-center justify-center px-4 animate-fadeIn">
      <div className="max-w-md text-center">
        <div className="relative inline-block mb-6">
          <div className="text-[140px] leading-none font-black text-transparent bg-clip-text bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 select-none" aria-hidden="true">404</div>
          <div className="absolute inset-x-0 -bottom-2 text-5xl select-none" aria-hidden="true">🔍</div>
          <span className="sr-only">{t('sr_404')}</span>
        </div>
        <h1 id="not-found-title" className="text-2xl font-extrabold text-gray-900 dark:text-white mb-3 mt-8">
          {t('not_found_heading')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 leading-relaxed whitespace-pre-line">
          {t('not_found_body')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-semibold transition-all shadow-sm"
          >
            {t('cta_home')}
          </Link>
          <Link
            href="/tickets/new"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 text-sm font-medium text-gray-700 dark:text-gray-300 transition-all"
          >
            {t('cta_new_ticket')}
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 text-sm font-medium text-gray-700 dark:text-gray-300 transition-all"
          >
            {t('cta_help')}
          </Link>
        </div>
      </div>
    </main>
  )
}
