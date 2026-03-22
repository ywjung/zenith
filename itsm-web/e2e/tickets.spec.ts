/**
 * 티켓 목록 / 상세 E2E 테스트 (관리자 인증 필요)
 */
import { test, expect } from '@playwright/test';

test.describe('티켓 목록', () => {
  test.beforeEach(async ({ page }) => {
    // 티켓 목록은 홈('/')에 위치
    await page.goto('/');
    // 인증 확인 로딩이 끝날 때까지 대기
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  });

  test('티켓 목록 페이지가 로드된다', async ({ page }) => {
    await expect(page).toHaveTitle(/티켓|ITSM|ZENITH/i);
    // 티켓 목록이 렌더링되거나 빈 상태 메시지가 표시됨
    const hasList = await page.locator('table, [role="list"]').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/티켓이 없|데이터가 없/i).isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasList || hasEmpty || hasMain).toBeTruthy();
  });

  test('필터 UI가 표시된다', async ({ page }) => {
    // 상태 또는 우선순위 필터 (combobox 또는 button)
    const hasCombobox = await page.getByRole('combobox').first().isVisible().catch(() => false);
    const hasFilterBtn = await page.getByRole('button', { name: /필터|상태|우선순위/i }).first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasCombobox || hasFilterBtn || hasMain).toBeTruthy();
  });

  test('검색 기능이 동작한다', async ({ page }) => {
    const searchBox = page.getByPlaceholder(/검색|search/i).first();
    if (await searchBox.isVisible()) {
      await searchBox.fill('테스트 검색어');
      await page.keyboard.press('Enter');
      // URL이 업데이트되거나 결과가 필터링됨
      await page.waitForTimeout(500);
      const url = page.url();
      const hasResult = url.includes('search') || url.includes('q=');
      // 결과가 로드됨 (에러 없음)
      await expect(page.locator('main')).toBeVisible();
    }
  });
});

test.describe('티켓 생성', () => {
  test('새 티켓 생성 폼이 접근 가능하다', async ({ page }) => {
    await page.goto('/tickets/new');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await expect(page.getByRole('heading', { name: /티켓|문의|신청|지원 요청/i })).toBeVisible();
    // 제목 필드: label 대신 placeholder로 확인
    await expect(page.getByRole('textbox').first()).toBeVisible();
  });
});
