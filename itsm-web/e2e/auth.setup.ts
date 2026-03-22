/**
 * 인증 설정 (global setup)
 * 관리자 계정으로 로그인하고 쿠키 상태를 저장합니다.
 * 실제 GitLab OAuth 환경에서는 test 계정 자격증명을 환경 변수로 주입하세요.
 */
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/admin.json');

setup('관리자 로그인 설정', async ({ page }) => {
  const loginUrl = process.env.E2E_BASE_URL
    ? `${process.env.E2E_BASE_URL}/login`
    : 'http://localhost:8111/login';

  await page.goto(loginUrl);

  // GitLab OAuth 버튼 클릭 (실제 환경에서는 OAuth 플로우 완료 필요)
  // CI 환경에서는 직접 JWT 쿠키를 설정하는 방법 권장
  const adminToken = process.env.E2E_ADMIN_TOKEN;
  if (adminToken) {
    // 직접 토큰 주입 (CI 환경)
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
    await page.goto(loginUrl.replace('/login', '/'));
  } else {
    // 인터랙티브 로그인 (로컬 개발 환경)
    await page.getByRole('button', { name: /gitlab/i }).click();
    // GitLab 로그인 후 리다이렉트 대기
    await page.waitForURL('**/tickets**', { timeout: 30000 });
  }

  await page.context().storageState({ path: AUTH_FILE });
});
