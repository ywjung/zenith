/**
 * i18n 유틸리티 — next-intl 기반 다국어 지원
 * 현재 지원 언어: ko (기본), en
 * 향후 언어 추가 시 messages/ 디렉토리에 <locale>.json 추가
 */

export const SUPPORTED_LOCALES = ['ko', 'en'] as const
export type Locale = typeof SUPPORTED_LOCALES[number]
export const DEFAULT_LOCALE: Locale = 'ko'

export function getLocaleFromStorage(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const stored = localStorage.getItem('locale') as Locale | null
  return stored && SUPPORTED_LOCALES.includes(stored) ? stored : DEFAULT_LOCALE
}

export function setLocaleToStorage(locale: Locale): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('locale', locale)
  // 서버(i18n/request.ts·layout)가 읽는 cookie도 함께 갱신 — 서버/클라 로케일 일원화.
  // 이 cookie가 없으면 SSR·<html lang>이 항상 기본 로케일로 고정됨.
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`
}

export const LOCALE_LABELS: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
}
