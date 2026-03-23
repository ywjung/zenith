'use client'

import { useState, useEffect } from 'react'
import { getLocaleFromStorage, setLocaleToStorage, SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n'

export default function LocaleSwitcher() {
  const [locale, setLocale] = useState<Locale>('ko')

  useEffect(() => {
    setLocale(getLocaleFromStorage())
  }, [])

  function handleChange(next: Locale) {
    setLocale(next)
    setLocaleToStorage(next)
    // Reload to apply locale change across the app
    window.location.reload()
  }

  return (
    <div className="relative group">
      <button
        title="언어 변경 / Change language"
        className="p-1.5 rounded-md hover:bg-blue-600 dark:hover:bg-gray-700 transition-colors text-xs opacity-80 hover:opacity-100 font-medium"
      >
        🌐 {locale.toUpperCase()}
      </button>
      <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150">
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            onClick={() => handleChange(l)}
            className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
              locale === l
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <span>{l === 'ko' ? '🇰🇷' : '🇺🇸'}</span>
            <span>{LOCALE_LABELS[l]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
