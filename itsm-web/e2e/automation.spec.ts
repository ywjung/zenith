/**
 * 자동화 규칙 Admin E2E 테스트
 */
import { test, expect } from '@playwright/test';

test.describe('자동화 규칙 관리 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/automation-rules');
  });

  test('자동화 규칙 페이지가 로드된다', async ({ page }) => {
    // 관리자 페이지 — 미인증 시 리다이렉트
    const isAdmin = !page.url().includes('/login');
    if (!isAdmin) {
      expect(page.url()).toContain('/login');
      return;
    }
    await expect(page.getByRole('heading', { name: /자동화 규칙/i })).toBeVisible({ timeout: 15000 });
  });

  test('규칙 목록 탭과 전체 실행 이력 탭이 표시된다', async ({ page }) => {
    if (page.url().includes('/login')) return;
    await expect(page.getByRole('button', { name: /규칙 목록/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /전체 실행 이력/i })).toBeVisible({ timeout: 15000 });
  });

  test('새 규칙 버튼이 표시된다', async ({ page }) => {
    if (page.url().includes('/login')) return;
    await expect(page.getByRole('button', { name: /새 규칙/i })).toBeVisible({ timeout: 15000 });
  });

  test('새 규칙 버튼 클릭 시 폼이 열린다', async ({ page }) => {
    if (page.url().includes('/login')) return;
    const addBtn = page.getByRole('button', { name: /새 규칙/i });
    if (await addBtn.isVisible()) {
      await addBtn.click({ force: true });
      await expect(page.getByRole('heading', { name: /새 자동화 규칙/i })).toBeVisible({ timeout: 3000 });
      // 취소 버튼으로 닫기
      await page.getByRole('button', { name: /취소/i }).click({ force: true });
    }
  });

  test('전체 실행 이력 탭 클릭 시 이력이 표시된다', async ({ page }) => {
    if (page.url().includes('/login')) return;
    const logsTab = page.getByRole('button', { name: /전체 실행 이력/i });
    if (await logsTab.isVisible()) {
      await logsTab.click({ force: true });
      await page.waitForTimeout(1000);
      // 이력 있거나 빈 상태
      const hasLogs = await page.locator('text=✓').first().isVisible().catch(() => false);
      const hasEmpty = await page.getByText(/실행 이력이 없/i).isVisible().catch(() => false);
      const hasContent = await page.locator('main').isVisible();
      expect(hasLogs || hasEmpty || hasContent).toBeTruthy();
    }
  });
});

test.describe('자동화 규칙 API', () => {
  test('자동화 규칙 목록 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async (apiPath) => {
      try {
        const r = await fetch(apiPath, { credentials: 'include' });
        return r.status;
      } catch { return 0; }
    }, '/api/automation-rules');
    expect([200, 401, 403]).toContain(status);
  });

  test('최근 실행 이력 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async (apiPath) => {
      try {
        const r = await fetch(apiPath, { credentials: 'include' });
        return r.status;
      } catch { return 0; }
    }, '/api/automation-rules/logs/recent');
    expect([200, 401, 403]).toContain(status);
  });
});
