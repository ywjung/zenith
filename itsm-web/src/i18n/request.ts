import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

const SUPPORTED = ['ko', 'en'] as const
type Locale = (typeof SUPPORTED)[number]

export default getRequestConfig(async () => {
  const store = await cookies()
  const raw = store.get('locale')?.value as Locale | undefined
  const locale: Locale = raw && SUPPORTED.includes(raw) ? raw : 'ko'
  const messages = (await import(`../../messages/${locale}.json`)).default
  return { locale, messages, timeZone: 'Asia/Seoul' }
})
