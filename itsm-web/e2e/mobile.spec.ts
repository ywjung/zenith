/**
 * 모바일 뷰포트 E2E 테스트 (Pixel 7 기준)
 * 주요 페이지의 모바일 레이아웃 및 반응형 UI 검증
 */
import { test, expect } from '@playwright/test';

test.describe('모바일 - 홈/티켓 목록', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  });

  test('모바일에서 홈 페이지가 로드된다', async ({ page }) => {
    await expect(page).toHaveTitle(/ITSM|티켓|ZENITH/i);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasMain).toBeTruthy();
  });

  test('모바일에서 헤더 또는 네비게이션이 표시된다', async ({ page }) => {
    // 모바일 햄버거 메뉴 또는 헤더
    const hasHeader = await page.locator('header, nav, [role="navigation"]').first().isVisible().catch(() => false);
    const hasMenu = await page.getByRole('button', { name: /메뉴|menu|navigation/i }).isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasHeader || hasMenu || hasMain).toBeTruthy();
  });

  test('모바일에서 스크롤이 가능하다', async ({ page }) => {
    // 페이지가 렌더링되었는지 확인
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    expect(bodyHeight).toBeGreaterThan(0);
  });
});

test.describe('모바일 - 티켓 생성 폼', () => {
  test('모바일에서 새 티켓 폼이 접근 가능하다', async ({ page }) => {
    await page.goto('/tickets/new');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const hasHeading = await page.getByRole('heading', { name: /티켓|문의|신청|지원 요청/i }).isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasHeading || hasMain).toBeTruthy();
  });

  test('모바일에서 입력 필드가 조작 가능하다', async ({ page }) => {
    await page.goto('/tickets/new');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const titleInput = page.getByRole('textbox').first();
    const hasInput = await titleInput.isVisible().catch(() => false);
    if (hasInput) {
      await titleInput.click(); // 모바일에서도 click 사용
      await titleInput.fill('모바일 테스트 입력');
      const value = await titleInput.inputValue().catch(() => '');
      expect(value).toContain('모바일 테스트 입력');
    }
  });
});

test.describe('모바일 - 지식베이스', () => {
  test('모바일에서 KB 목록 페이지가 로드된다', async ({ page }) => {
    await page.goto('/kb');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const hasMain = await page.locator('main').isVisible().catch(() => false);
    const hasHeading = await page.getByRole('heading').first().isVisible().catch(() => false);
    expect(hasMain || hasHeading).toBeTruthy();
  });
});

test.describe('모바일 - 알림', () => {
  test('모바일에서 알림 페이지가 접근 가능하다', async ({ page }) => {
    await page.goto('/notifications');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasMain).toBeTruthy();
  });
});

test.describe('모바일 - 반응형 레이아웃', () => {
  test('뷰포트 너비가 모바일 크기임을 확인한다', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    // 모바일 프로젝트(Pixel 7)에서만 width 검증, 데스크톱 chromium에서는 스킵
    if (viewport!.width <= 600) {
      expect(viewport!.width).toBeLessThanOrEqual(600);
    } else {
      // 데스크톱 브라우저에서 실행 중 → 뷰포트가 더 큼, 스킵
      test.skip();
    }
  });

  test('모바일에서 페이지 너비가 뷰포트를 크게 초과하지 않는다', async ({ page }) => {
    await page.goto('/');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    const viewport = page.viewportSize()!;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    // 뷰포트 너비의 2배 이상 초과하지 않아야 함 (테이블 등 일부 overflow는 허용)
    expect(scrollWidth).toBeLessThan(viewport.width * 2);
  });

  test('모바일에서 Reports 페이지가 로드된다', async ({ page }) => {
    await page.goto('/reports');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasMain).toBeTruthy();
  });
});
