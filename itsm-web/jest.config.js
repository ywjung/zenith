const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
module.exports = createJestConfig({
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // e2e/는 Playwright(`playwright test`)로 실행한다. jest가 수집하면 @playwright/test
  // 임포트로 "Test suite failed to run"이 발생하므로 제외한다.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/', '<rootDir>/.next/'],
})
