import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { apiAs } from './api';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Branding is company-wide: always put the local company back to today's look.
test.afterEach(async () => {
  const admin = await apiAs(TEST_USERS.admin.email);
  await admin.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
  await admin.rpc('clear_branding_logo');
});

test('an admin brands the company; the app and the signed-out login page show it', async ({ page, browser }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const form = page.getByRole('region', { name: 'Branding' });
  await form.getByRole('textbox', { name: 'Name' }).fill('E2E Acme Implants');
  await form.getByRole('textbox', { name: 'Brand colour' }).fill('#7C2D12');
  await form.getByRole('textbox', { name: 'Navigation colour' }).fill('1e293b');
  await form.getByLabel('Logo (PNG, JPEG or WebP, up to 200 KB)').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Save branding' }).click();
  await expect(form.getByRole('status')).toHaveText('Branding saved.');

  await page.reload();
  await expect(page.locator('#main-nav')).toHaveCSS('background-color', 'rgb(30, 41, 59)');
  await expect(page.locator('#main-nav')).toContainText('E2E Acme Implants');
  await expect(form.getByRole('button', { name: 'Save branding' })).toHaveCSS('background-color', 'rgb(124, 45, 18)');
  await expect(page).toHaveTitle('E2E Acme Implants');

  const anon = await browser.newContext();
  const login2 = await anon.newPage();
  await login2.goto('/login');
  await expect(login2.getByRole('heading', { level: 1 })).toHaveText('E2E Acme Implants');
  const logo = login2.locator('main img').first();
  await expect(logo).toHaveAttribute('src', /\/brand\/logo\?v=\d+/);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await anon.close();
});

test('refuses a brand colour too light to read', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const form = page.getByRole('region', { name: 'Branding' });
  await form.getByRole('textbox', { name: 'Brand colour' }).fill('#fde68a');
  await form.getByRole('button', { name: 'Save branding' }).click();
  await expect(form.getByRole('alert')).toHaveText('This colour is too light to read on white. Choose a darker shade.');
});

test('Reset to defaults restores today’s look', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  await admin.rpc('update_branding', { p_name: 'E2E Reset Me', p_brand_color: '#7c2d12', p_nav_color: '#1e293b' });
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  await expect(page.locator('#main-nav')).toContainText('E2E Reset Me');
  await page.getByRole('region', { name: 'Branding' }).getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.locator('#main-nav')).toContainText('Implant Course Manager');
  await expect(page.locator('#main-nav')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});
