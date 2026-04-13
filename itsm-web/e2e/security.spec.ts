/**
 * 보안 회귀 E2E 테스트
 * IDOR, CSRF, CSP 등 보안 패치의 프론트엔드 측 검증
 */
import { test, expect } from '@playwright/test';

test.describe('CSP 헤더', () => {
  test('CSP 헤더에 외부 도메인이 없다 (폐쇄망 호환)', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';
    // 외부 CDN/도메인이 없어야 함
    expect(csp).not.toContain('cdn.jsdelivr.net');
    expect(csp).not.toContain('gravatar.com');
    expect(csp).not.toContain('fastapi.tiangolo.com');
    // nonce가 포함되어야 함
    expect(csp).toContain('nonce-');
  });

  test('X-XSS-Protection 헤더가 제거되었다', async ({ page }) => {
    const response = await page.goto('/');
    const xss = response?.headers()['x-xss-protection'];
    expect(xss).toBeUndefined();
  });

  test('X-Frame-Options DENY가 설정되어 있다', async ({ page }) => {
    const response = await page.goto('/');
    const frame = response?.headers()['x-frame-options'] ?? '';
    expect(frame).toContain('DENY');
  });
});

test.describe('인증 필수 페이지', () => {
  test('비인증 상태로 /admin API 접근 시 401을 반환한다', async ({ request }) => {
    // API 엔드포인트로 직접 확인 (브라우저 redirect 대신 HTTP 레벨 검증)
    const response = await request.fetch('http://localhost:8111/api/admin/filter-options', {
      headers: { Cookie: '' },  // 인증 쿠키 없이
    });
    // 401 또는 redirect가 반환되어야 함
    expect([401, 307, 302, 403].includes(response.status())).toBeTruthy();
  });
});

test.describe('보안 헤더 확인', () => {
  test('API 응답에 X-Content-Type-Options: nosniff가 있다', async ({ page }) => {
    const response = await page.goto('/');
    const nosniff = response?.headers()['x-content-type-options'] ?? '';
    expect(nosniff).toContain('nosniff');
  });

  test('Referrer-Policy 헤더가 설정되어 있다', async ({ page }) => {
    const response = await page.goto('/');
    const referrer = response?.headers()['referrer-policy'];
    expect(referrer).toContain('strict-origin');
  });
});
