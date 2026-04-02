/**
 * 인증 설정 (global setup)
 * 관리자 계정으로 로그인하고 쿠키 상태를 저장합니다.
 * 실제 GitLab OAuth 환경에서는 test 계정 자격증명을 환경 변수로 주입하세요.
 */
import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(__dirname, '.auth/admin.json');

function getExistingToken(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    const cookie = (data.cookies || []).find((c: { name: string }) => c.name === 'itsm_token');
    if (!cookie) return null;
    // expires=-1 means session cookie (no expiry), always try to reuse
    // For JWT-expiry check we decode the payload
    const parts = (cookie.value as string).split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const exp: number = payload.exp ?? 0;
    // Valid if more than 5 minutes remaining
    if (exp > 0 && exp - Date.now() / 1000 < 300) return null;
    return cookie.value as string;
  } catch {
    return null;
  }
}

setup('관리자 로그인 설정', async ({ page }) => {
  const loginUrl = process.env.E2E_BASE_URL
    ? `${process.env.E2E_BASE_URL}/login`
    : 'http://localhost:8111/login';

  const adminToken = process.env.E2E_ADMIN_TOKEN || getExistingToken();
  if (adminToken) {
    // 직접 토큰 주입 (CI 환경 또는 기존 유효 토큰)
    await page.goto(loginUrl.replace('/login', '/'));
    await page.context().addCookies([
      {
        name: 'itsm_token',
        value: adminToken,
        domain: new URL(loginUrl).hostname,
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);
  } else {
    // 인터랙티브 로그인 (GitLab OAuth)
    await page.goto(loginUrl);
    await page.getByRole('button', { name: /gitlab/i }).click();
    await page.waitForURL('**/tickets**', { timeout: 30000 });
  }

  // OnboardingTour 비활성화 — 오버레이가 클릭을 차단하지 않도록
  await page.evaluate(() => localStorage.setItem('zenith_tour_done', '1'));
  await page.context().storageState({ path: AUTH_FILE });
});
