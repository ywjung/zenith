import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 테스트 설정
 * 실행: npm run test:e2e
 * UI 모드: npm run test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8111',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    // 인증 설정 (다른 테스트보다 먼저 실행)
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    // 포털 테스트 — 인증 불필요
    {
      name: 'portal',
      testMatch: /.*portal\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 모바일 뷰포트 테스트
    {
      name: 'mobile',
      testMatch: /.*mobile\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/admin.json',
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      },
      dependencies: ['setup'],
    },
  ],
  // CI가 아닌 환경에서 Next.js 개발 서버 자동 시작
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120 * 1000,
      },
});
