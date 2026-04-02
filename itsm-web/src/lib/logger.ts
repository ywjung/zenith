/**
 * 구조화 로거 유틸리티
 * - development: 모든 레벨 출력
 * - production: error만 출력 (console.log/warn/debug 억제)
 */
const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  log:   (...args: unknown[]): void => { if (isDev) console.log(...args) },
  debug: (...args: unknown[]): void => { if (isDev) console.debug(...args) },
  warn:  (...args: unknown[]): void => { if (isDev) console.warn(...args) },
  error: (...args: unknown[]): void => { console.error(...args) }, // 항상 출력
}
