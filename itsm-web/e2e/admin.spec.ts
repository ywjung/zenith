/**
 * 관리자 대시보드 E2E 테스트 (관리자 인증 필요)
 */
import { test, expect } from '@playwright/test';

test.describe('관리자 패널', () => {
  test('관리자 레이아웃이 접근 가능하다', async ({ page }) => {
    await page.goto('/admin');
    // 리다이렉트 허용 (권한 없으면 로그인 페이지로)
    const url = page.url();
    if (url.includes('/login')) {
      // 인증 설정이 안 된 경우 스킵
      test.skip();
      return;
    }
    await expect(page.locator('nav, aside, [role="navigation"]').first()).toBeVisible();
  });

  test('사용자 관리 페이지가 로드된다', async ({ page }) => {
    await page.goto('/admin/users');
    const url = page.url();
    if (url.includes('/login')) {
      test.skip();
      return;
    }
    await expect(page.locator('main')).toBeVisible();
  });

  test('SLA 정책 페이지가 로드된다', async ({ page }) => {
    await page.goto('/admin/sla-policies');
    const url = page.url();
    if (url.includes('/login')) {
      test.skip();
      return;
    }
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('접근성 기본 검사', () => {
  test('메인 페이지에 랜드마크가 있다', async ({ page }) => {
    await page.goto('/');
    // main, nav, header 중 하나 이상 존재
    const hasLandmark = await page.locator('main, [role="main"], nav, header').first().isVisible();
    expect(hasLandmark).toBeTruthy();
  });

  test('포털 페이지에 form이 있다', async ({ page }) => {
    await page.goto('/portal');
    const form = page.locator('form');
    await expect(form.first()).toBeVisible();
  });
});
