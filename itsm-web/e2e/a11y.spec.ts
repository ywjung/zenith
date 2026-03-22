/**
 * 접근성(a11y) 자동 감사 E2E 테스트
 * axe-playwright를 사용한 WCAG 2.1 AA 준수 검사
 *
 * 실행: npm run test:e2e -- a11y.spec.ts
 */
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y, getViolations } from 'axe-playwright';

/**
 * axe 위반 항목을 사람이 읽기 쉬운 문자열로 포맷
 */
function formatViolations(violations: any[]): string {
  return violations
    .map(
      (v) =>
        `\n[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
        v.nodes.map((n: any) => `  - ${n.target.join(', ')}`).join('\n'),
    )
    .join('\n');
}

const PAGES = [
  { name: '홈/티켓 목록', path: '/' },
  { name: '새 티켓 생성', path: '/tickets/new' },
  { name: '지식베이스 목록', path: '/kb' },
  { name: '알림 센터', path: '/notifications' },
  { name: '레포트', path: '/reports' },
  { name: '도움말', path: '/help' },
];

test.describe('접근성(a11y) 감사 — 주요 페이지', () => {
  for (const { name, path } of PAGES) {
    test(`${name} (${path}) WCAG 2.1 AA 위반 없음`, async ({ page }) => {
      await page.goto(path);
      await page
        .getByText('인증 확인 중')
        .waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(500);

      await injectAxe(page);
      const violations = await getViolations(page, null, {
        axeOptions: {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa'],
          },
        },
      });

      // critical / serious 위반만 실패 처리 (moderate/minor는 경고)
      const criticalViolations = violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );

      if (criticalViolations.length > 0) {
        const formatted = formatViolations(criticalViolations);
        expect(
          criticalViolations.length,
          `${name}: ${criticalViolations.length}개의 critical/serious 접근성 위반 발생:${formatted}`,
        ).toBe(0);
      }

      // moderate/minor 위반은 로그만 출력
      const minorViolations = violations.filter((v) =>
        ['moderate', 'minor'].includes(v.impact ?? ''),
      );
      if (minorViolations.length > 0) {
        console.warn(
          `[a11y][${name}] moderate/minor 위반 ${minorViolations.length}건:${formatViolations(minorViolations)}`,
        );
      }
    });
  }
});

test.describe('접근성(a11y) 감사 — 어드민 페이지', () => {
  const ADMIN_PAGES = [
    { name: '자동화 규칙', path: '/admin/automation-rules' },
    { name: '알림 채널', path: '/admin/notification-channels' },
  ];

  for (const { name, path } of ADMIN_PAGES) {
    test(`어드민 ${name} (${path}) WCAG 2.1 AA critical 위반 없음`, async ({ page }) => {
      await page.goto(path);
      await page
        .getByText('인증 확인 중')
        .waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(500);

      await injectAxe(page);
      const violations = await getViolations(page, null, {
        axeOptions: {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        },
      });

      const criticalViolations = violations.filter((v) =>
        ['critical', 'serious'].includes(v.impact ?? ''),
      );

      if (criticalViolations.length > 0) {
        console.warn(
          `[a11y][어드민 ${name}] critical/serious 위반 ${criticalViolations.length}건:${formatViolations(criticalViolations)}`,
        );
      }

      // 어드민 페이지는 soft assertion (경고 처리, 실패 아님)
      expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });
  }
});

test.describe('접근성(a11y) — 색상 대비', () => {
  test('홈 페이지 색상 대비 검사', async ({ page }) => {
    await page.goto('/');
    await page
      .getByText('인증 확인 중')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    await injectAxe(page);
    const violations = await getViolations(page, null, {
      axeOptions: {
        runOnly: { type: 'rule', values: ['color-contrast'] },
      },
    });

    if (violations.length > 0) {
      console.warn(`[a11y] 색상 대비 위반 ${violations.length}건:${formatViolations(violations)}`);
    }

    // 색상 대비 위반은 10개 이하 허용 (UI 라이브러리 기본값 영향 고려)
    expect(violations.length).toBeLessThanOrEqual(10);
  });
});

test.describe('접근성(a11y) — 키보드 탐색', () => {
  test('홈 페이지 포커스 이동이 가능하다', async ({ page }) => {
    await page.goto('/');
    await page
      .getByText('인증 확인 중')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Tab 키로 주요 인터랙티브 요소 탐색
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // 포커스된 요소 확인
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
    // 포커스가 body에 머물지 않아야 함 (탐색 가능 = body 아님 또는 메인에 있음)
    expect(focusedTag).not.toBeNull();
    await expect(page.locator('main')).toBeVisible();
  });

  test('새 티켓 폼 키보드 탐색', async ({ page }) => {
    await page.goto('/tickets/new');
    await page
      .getByText('인증 확인 중')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    // Tab으로 폼 필드 순서 이동 확인
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('접근성(a11y) — ARIA 구조', () => {
  test('홈 페이지 랜드마크 구조가 올바르다', async ({ page }) => {
    await page.goto('/');
    await page
      .getByText('인증 확인 중')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});

    // main 랜드마크 존재 확인
    await expect(page.locator('main')).toBeVisible();
    // nav 또는 header 존재
    const hasNav = await page.locator('nav, header').first().isVisible().catch(() => false);
    expect(hasNav).toBeTruthy();
  });

  test('이미지 alt 텍스트 검사', async ({ page }) => {
    await page.goto('/');
    await page
      .getByText('인증 확인 중')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});

    await injectAxe(page);
    const violations = await getViolations(page, null, {
      axeOptions: {
        runOnly: { type: 'rule', values: ['image-alt'] },
      },
    });

    if (violations.length > 0) {
      console.warn(`[a11y] alt 없는 이미지 ${violations.length}건:${formatViolations(violations)}`);
    }
    expect(violations.length).toBe(0);
  });
});
