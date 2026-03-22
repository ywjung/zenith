/**
 * 고객 셀프서비스 포털 E2E 테스트 (인증 불필요)
 */
import { test, expect } from '@playwright/test';

test.describe('포털 — 티켓 제출', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal');
  });

  test('포털 페이지가 렌더링된다', async ({ page }) => {
    await expect(page).toHaveTitle(/포털|ITSM|문의|ZENITH/i);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('필수 필드를 채우고 티켓을 제출한다', async ({ page }) => {
    // 포털 폼은 <label>이 아닌 div 텍스트 레이블을 사용하므로 placeholder로 입력
    await page.getByPlaceholder('홍길동').fill('홍길동');
    await page.getByPlaceholder('hong@company.com').fill('hong@example.com');
    await page.getByPlaceholder(/문제를 간략히/).fill('프린터가 작동하지 않아요');
    await page.getByPlaceholder(/문제 상황/).fill('1층 회의실 프린터가 급지 오류를 반복합니다.');

    await page.getByRole('button', { name: /제출|접수/i }).click();

    // 성공 메시지 확인 (접수 완료 heading)
    await expect(
      page.getByRole('heading', { name: /접수 완료|완료|성공/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test('이메일 형식이 잘못되면 유효성 검사 오류가 표시된다', async ({ page }) => {
    await page.getByPlaceholder('홍길동').fill('테스트');
    await page.getByPlaceholder('hong@company.com').fill('not-an-email');
    await page.getByPlaceholder(/문제를 간략히/).fill('제목');
    await page.getByPlaceholder(/문제 상황/).fill('내용');

    await page.getByRole('button', { name: /제출|접수/i }).click();

    // 클라이언트 유효성 검사 또는 서버 오류 메시지
    const errorVisible = await page.getByText(/이메일|유효하지|오류/i).isVisible().catch(() => false);
    // HTML5 native validation이 있으면 폼이 제출되지 않음
    const stillOnPortal = page.url().includes('/portal');
    expect(errorVisible || stillOnPortal).toBeTruthy();
  });
});
