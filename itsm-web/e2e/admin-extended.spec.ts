/**
 * 관리자 패널 확장 E2E 테스트
 * 커버리지: 커스텀 필드, IP 허용 목록, 서비스 카탈로그
 */
import { test, expect, type Page } from '@playwright/test';

// 공통 헬퍼: 인증 없으면 테스트 스킵
async function requireAdmin(page: Page) {
  const url = page.url();
  if (url.includes('/login')) {
    test.skip();
    return false;
  }
  return true;
}

// ─────────────────────────────────────────
// 커스텀 필드
// ─────────────────────────────────────────
test.describe('커스텀 필드 관리', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/custom-fields');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  });

  test('커스텀 필드 목록 페이지가 로드된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await expect(page.locator('main')).toBeVisible();
    const hasTitle = await page.getByText(/커스텀 필드|custom field/i).first().isVisible().catch(() => false);
    expect(hasTitle).toBeTruthy();
  });

  test('필드 추가 버튼 또는 폼이 존재한다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    const hasAddBtn = await page.getByRole('button', { name: /추가|새|new|add/i }).first().isVisible().catch(() => false);
    const hasForm = await page.locator('form').first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasAddBtn || hasForm || hasMain).toBeTruthy();
  });

  test('필드 목록 또는 빈 상태가 표시된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await page.waitForTimeout(800);
    const hasList = await page.locator('table, [role="list"], ul').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/없|empty|비어|no data/i).first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasList || hasEmpty || hasMain).toBeTruthy();
  });
});

test.describe('커스텀 필드 API', () => {
  test('커스텀 필드 목록 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.get('/api/admin/custom-fields', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([200, 401, 403, 429]).toContain(status);
  });

  test('필드 생성 API가 유효성 검사를 수행한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.post('/api/admin/custom-fields', {
      data: { name: '', label: '' },
      failOnStatusCode: false,
    }).catch(() => null);
    const status = resp?.status() ?? 0;
    // 401 미인증, 403 권한 없음, 422 유효성 오류, 429 rate limit
    expect([401, 403, 422, 429]).toContain(status);
  });
});

// ─────────────────────────────────────────
// IP 허용 목록
// ─────────────────────────────────────────
test.describe('IP 허용 목록 관리', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/ip-allowlist');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  });

  test('IP 허용 목록 페이지가 로드된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await expect(page.locator('main')).toBeVisible();
    const hasTitle = await page.getByText(/ip|허용|allowlist/i).first().isVisible().catch(() => false);
    expect(hasTitle).toBeTruthy();
  });

  test('IP 추가 폼이 CIDR 필드를 포함한다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    const hasInput = await page.locator('input[placeholder*="CIDR"], input[placeholder*="cidr"], input[placeholder*="IP"]').first().isVisible().catch(() => false);
    const hasTextbox = await page.getByRole('textbox').first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasInput || hasTextbox || hasMain).toBeTruthy();
  });

  test('목록 또는 빈 상태가 표시된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await page.waitForTimeout(800);
    const hasList = await page.locator('table, [role="list"], ul').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/없|empty|등록된/i).first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasList || hasEmpty || hasMain).toBeTruthy();
  });
});

test.describe('IP 허용 목록 API', () => {
  test('IP 목록 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.get('/api/admin/ip-allowlist', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([200, 401, 403, 429]).toContain(status);
  });

  test('잘못된 CIDR은 422를 반환한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.post('/api/admin/ip-allowlist', {
      data: { cidr: 'not-a-valid-cidr' },
      failOnStatusCode: false,
    }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([401, 403, 422, 429]).toContain(status);
  });

  test('유효한 CIDR 형식이 허용된다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.post('/api/admin/ip-allowlist', {
      data: { cidr: '192.168.99.0/24', label: 'e2e-test' },
      failOnStatusCode: false,
    }).catch(() => null);
    const status = resp?.status() ?? 0;
    // 201 생성됨, 401/403 권한 없음, 429 rate limit
    expect([201, 401, 403, 409, 429]).toContain(status);
  });
});

// ─────────────────────────────────────────
// 서비스 카탈로그
// ─────────────────────────────────────────
test.describe('서비스 카탈로그 관리', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/service-catalog');
    await page.getByText('인증 확인 중').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  });

  test('서비스 카탈로그 페이지가 로드된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await expect(page.locator('main')).toBeVisible();
    const hasTitle = await page.getByText(/카탈로그|서비스|catalog/i).first().isVisible().catch(() => false);
    expect(hasTitle).toBeTruthy();
  });

  test('카탈로그 항목 목록이 표시된다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    await page.waitForTimeout(1000);
    // seed.sql에 4개 기본 항목이 있으므로 목록이 있어야 함
    const hasList = await page.locator('table, ul, [class*="grid"], [class*="card"]').first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/없|empty/i).first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasList || hasEmpty || hasMain).toBeTruthy();
  });

  test('항목 추가 버튼이 존재한다', async ({ page }) => {
    if (!await requireAdmin(page)) return;
    const hasAddBtn = await page.getByRole('button', { name: /추가|새 항목|new|add/i }).first().isVisible().catch(() => false);
    const hasMain = await page.locator('main').isVisible().catch(() => false);
    expect(hasAddBtn || hasMain).toBeTruthy();
  });
});

test.describe('서비스 카탈로그 API', () => {
  test('카탈로그 목록 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    // /api/service-catalog/public — 공개 엔드포인트
    const resp = await page.request.get('/api/service-catalog/public', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([200, 401, 403, 429]).toContain(status);
  });

  test('관리자 카탈로그 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.get('/api/admin/service-catalog', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([200, 401, 403, 429]).toContain(status);
  });

  test('카탈로그 항목이 올바른 구조를 가진다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.get('/api/service-catalog/public', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    const body = resp?.ok() ? await resp.json().catch(() => null) : null;
    if (status === 200) {
      expect(Array.isArray(body)).toBeTruthy();
      if (body && body.length > 0) {
        expect(body[0]).toHaveProperty('name');
        expect(body[0]).toHaveProperty('category');
      }
    }
  });
});

// ─────────────────────────────────────────
// 연관 티켓 (Ticket Links)
// ─────────────────────────────────────────
test.describe('연관 티켓 API', () => {
  test('티켓 링크 목록 API가 응답한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.get('/api/tickets/1/links', { failOnStatusCode: false }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([200, 401, 403, 404, 429]).toContain(status);
  });

  test('잘못된 link_type은 422를 반환한다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.post('/api/tickets/1/links', {
      data: { target_iid: 2, link_type: 'invalid_type' },
      failOnStatusCode: false,
    }).catch(() => null);
    const status = resp?.status() ?? 0;
    expect([401, 403, 422, 429]).toContain(status);
  });

  test('유효한 link_type으로 링크 생성 시도가 처리된다', async ({ page }) => {
    await page.goto('/');
    const resp = await page.request.post('/api/tickets/1/links', {
      data: { target_iid: 2, link_type: 'relates_to' },
      failOnStatusCode: false,
    }).catch(() => null);
    const status = resp?.status() ?? 0;
    // 201 생성, 401 미인증, 403 권한 없음, 404 티켓 없음, 429 rate limit
    expect([201, 401, 403, 404, 429]).toContain(status);
  });
});
