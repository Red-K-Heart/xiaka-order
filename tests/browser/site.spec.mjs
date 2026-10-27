import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const responses = JSON.parse(await readFile(new URL('../fixtures/customer.json', import.meta.url), 'utf8'));
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-27T09:00:00+08:00'));
    // Deny external traffic, including production POSTs and side-effecting GETs.
    // Tests override individual requests with local synthetic responses only.
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173'
      ? route.continue() : route.abort('blockedbyclient'));
    await use(page);
    expect(errors, 'uncaught browser errors').toEqual([]);
  }
});

async function mockCustomer(page, { productsFail = false, closed = false } = {}) {
  const calls = [];
  await page.route('https://script.google.com/macros/s/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const api = url.searchParams.get('api');
    const callback = url.searchParams.get('callback');
    calls.push(api);
    if (request.method() !== 'GET' || !['storeSettings', 'catalogRules', 'products'].includes(api)) {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected backend operation: ${request.method()} ${api}`);
    }
    if (productsFail && api === 'products') return route.abort('failed');
    const value = api === 'storeSettings' && closed
      ? { ...responses.storeSettings, acceptingOrders: false, closedReason: '測試休息日' }
      : responses[api];
    await route.fulfill({ contentType: 'application/javascript', body: `${callback}(${JSON.stringify(value)});` });
  });
  // Only the visibility primitive is supplied; these are behavior tests, not CDN/visual tests.
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'const s=document.createElement("style");s.textContent=".hidden{display:none!important}";document.head.append(s);'
  }));
  return calls;
}

test('operator sample orders can be searched', async ({ page }) => {
  await page.goto('/operator.html');
  await page.locator('#ordersTab').click();
  await expect(page.locator('.order-card')).toHaveCount(3);
  await page.locator('#orderSearch').fill('林小姐');
  await expect(page.locator('.order-card')).toHaveCount(1);
  await expect(page.locator('.order-card')).toContainText('A1754222');
});

test('operator calculator saves a local-only demo order and retains it on reload', async ({ page }) => {
  await page.goto('/operator.html');
  await page.locator('#ordersTab').click();
  await page.locator('[data-filter="calculator"]').click();
  await page.locator('[data-calc-key="quick:30"]').click();
  await page.locator('[data-calc-key="quick:35"]').click();
  await expect(page.locator('#calculatorValue')).toHaveText('65');
  await page.locator('#saveOnsiteOrder').click();
  await page.reload();
  await page.locator('#ordersTab').click();
  await page.locator('[data-filter="completed"]').click();
  await expect(page.locator('.order-card')).toHaveCount(1);
  await expect(page.locator('.order-card')).toContainText('現場交易');
  await expect(page.locator('.order-card')).toContainText('$65');
});

test('customer renders JSONP catalog, cart totals and checkout from synthetic data', async ({ page }) => {
  const calls = await mockCustomer(page);
  await page.goto('/index.html');
  await expect(page.locator('#categoryNav')).toContainText('測試分類');
  await expect(page.locator('#productSections h3')).toHaveCount(2);
  await page.locator('#grid-TEST > div').first().getByRole('button', { name: '+', exact: true }).click();
  await page.locator('#grid-TEST > div').last().getByRole('button', { name: '+', exact: true }).click();
  await expect(page.locator('#totalItemsCount')).toHaveText('2');
  await expect(page.locator('#totalPrice')).toHaveText('65');
  await page.getByRole('button', { name: '確認結帳', exact: true }).click();
  await expect(page.locator('#checkoutModal')).toBeVisible();
  await expect(page.locator('#cartItemsList')).toContainText('測試豆干');
  await expect(page.locator('#modalTotalPrice')).toHaveText('65');
  expect(calls.sort()).toEqual(['catalogRules', 'products', 'storeSettings']);
});

test('customer shows product loading failure and can retry', async ({ page }) => {
  await mockCustomer(page, { productsFail: true });
  await page.goto('/index.html');
  await expect(page.locator('#errorState')).toBeVisible();
  await expect(page.locator('#errorMessage')).toContainText('讀取失敗');
  await page.unroute('https://script.google.com/macros/s/**');
  await mockCustomer(page);
  await page.getByRole('button', { name: '重新載入', exact: true }).click();
  await expect(page.locator('#errorState')).toBeHidden();
  await expect(page.locator('#productSections h3')).toHaveCount(2);
});

test('customer respects backend closed-store state', async ({ page }) => {
  await mockCustomer(page, { closed: true });
  await page.goto('/index.html');
  await expect(page.locator('#selectPickupTime')).toBeDisabled();
  await expect(page.locator('#selectPickupTime')).toContainText('測試休息日');
  await expect(page.locator('#btnSubmitOrder')).toBeDisabled();
});
