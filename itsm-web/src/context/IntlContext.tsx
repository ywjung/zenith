'use client'

import { NextIntlClientProvider } from 'next-intl'
import { useState, useEffect } from 'react'
import { getLocaleFromStorage, type Locale } from '@/lib/i18n'

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ko')
  const [messages, setMessages] = useState<Record<string, unknown>>({})

  useEffect(() => {
    const loc = getLocaleFromStorage()
    setLocale(loc)
    import(`../../messages/${loc}.json`).then(m => setMessages(m.default))
  }, [])

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
