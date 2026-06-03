'use client'

import { NextIntlClientProvider } from 'next-intl'

/**
 * 서버 layout이 cookie 기반으로 결정한 locale·messages를 그대로 전달받아 적용한다.
 * (이전: 클라이언트 localStorage에서 로케일을 읽어 messages를 비동기 로드 → SSR과 불일치,
 *  한국어 first-paint 깜빡임 발생. 이제 서버/클라가 동일 cookie 소스로 일원화됨.)
 */
export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string
  messages: Record<string, unknown>
  children: React.ReactNode
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
