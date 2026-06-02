const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
module.exports = createJestConfig({
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // e2e/는 Playwright(`playwright test`)로 실행한다. jest가 수집하면 @playwright/test
  // 임포트로 "Test suite failed to run"이 발생하므로 제외한다.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/', '<rootDir>/.next/'],
  // 회귀 방지용 최소 커버리지 floor. 현재 측정치보다 약간 낮게 설정했으며,
  // 컴포넌트 테스트 추가에 따라 점진적으로 상향한다.
  coverageThreshold: {
    global: { statements: 20, branches: 24, functions: 10, lines: 20 },
  },
})
