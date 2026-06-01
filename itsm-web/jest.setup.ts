import '@testing-library/jest-dom'

// next-intl/use-intl는 ESM 전용으로 배포되어 jest(next/jest)가 변환하지 못하고,
// 변환하더라도 컴포넌트가 NextIntlClientProvider 없이는 런타임 에러를 낸다.
// 단위/컴포넌트 테스트에서는 실제 ko 메시지로 번역을 해석하도록 목 처리한다
// (키 패스스루가 아니라 실제 한글 라벨을 반환 → 라벨 단언 테스트가 동작).
jest.mock('next-intl', () => {
  const ko = require('./messages/ko.json')
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      ko,
    )
  const makeT = (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const full = namespace ? `${namespace}.${key}` : key
      let val = resolve(full)
      // 누락 키는 실제 next-intl(strict)처럼 throw — 컴포넌트의 try/catch 폴백 동작 검증
      if (typeof val !== 'string') {
        throw new Error(`MISSING_MESSAGE: ${full}`)
      }
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          val = (val as string).replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        }
      }
      return val
    }
    ;(t as unknown as { rich: unknown }).rich = t
    ;(t as unknown as { markup: unknown }).markup = t
    ;(t as unknown as { raw: unknown }).raw = (key: string) =>
      resolve(namespace ? `${namespace}.${key}` : key)
    return t
  }
  return {
    useTranslations: (ns?: string) => makeT(ns),
    useFormatter: () => ({
      dateTime: (d: Date) => String(d),
      number: (n: number) => String(n),
      relativeTime: (d: Date) => String(d),
      list: (items: Iterable<string>) => Array.from(items).join(', '),
    }),
    useLocale: () => 'ko',
    useNow: () => new Date(0),
    useTimeZone: () => 'Asia/Seoul',
    useMessages: () => require('./messages/ko.json'),
    NextIntlClientProvider: ({ children }: { children: unknown }) => children,
  }
})

jest.mock('next-intl/server', () => {
  const ko = require('./messages/ko.json')
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      ko,
    )
  const makeT = (namespace?: string) => (key: string) => {
    const val = resolve(namespace ? `${namespace}.${key}` : key)
    return typeof val === 'string' ? val : (namespace ? `${namespace}.${key}` : key)
  }
  return {
    getTranslations: async (ns?: string) => makeT(ns),
    getFormatter: async () => ({
      dateTime: (d: Date) => String(d),
      number: (n: number) => String(n),
    }),
    getLocale: async () => 'ko',
    getMessages: async () => ko,
  }
})
