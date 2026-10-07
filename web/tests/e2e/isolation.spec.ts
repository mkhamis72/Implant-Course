import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs } from './api';

// Runs only with a local two-company registry: TENANTS_FILE=tenants.local.json npx playwright test isolation
const file = process.env.TENANTS_FILE;
test.skip(!file || !existsSync(file), 'needs TENANTS_FILE (two dev companies)');

const tenants = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { slug: string; supabaseUrl: string; serviceRoleKey: string }[]) : [];
const dev2 = tenants.find((t) => t.slug === 'dev2');
const B = 'http://tenant2.localhost:3000';
const PASSWORD = `Dev2-${Date.now()}-pw`;

test.describe('company isolation', () => {
  let dev2Email = '';
  let dev2UserId = '';

  test.beforeAll(async () => {
    const admin = createClient(dev2!.supabaseUrl, dev2!.serviceRoleKey, { auth: { persistSession: false } });
    dev2Email = `icm-dev2-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email: dev2Email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    dev2UserId = data.user!.id;
    const upd = await admin.from('profiles').update({ full_name: 'Dev2 Admin', role: 'admin', active: true }).eq('user_id', dev2UserId);
    if (upd.error) throw upd.error;
  });

  test.afterAll(async () => {
    const admin = createClient(dev2!.supabaseUrl, dev2!.serviceRoleKey, { auth: { persistSession: false } });
    if (dev2UserId) await admin.auth.admin.deleteUser(dev2UserId);
  });

  test("company A's user cannot sign in on company B", async ({ page }) => {
    await page.goto(`${B}/login`);
    await page.getByLabel('Email').fill(TEST_USERS.organizer.email);
    await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
  });

  test("A's session cookie is not accepted on B", async ({ page, context }) => {
    await login(page, TEST_USERS.organizer.email);
    const cookies = await context.cookies('http://localhost:3000');
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: B })));
    await page.goto(`${B}/`);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("data created on A never appears on B", async ({ page }) => {
    const name = uniqueName('Isolation Patient');
    const api = await apiAs(TEST_USERS.organizer.email);
    const { error } = await api.from('patients').insert({ full_name: name });
    expect(error).toBeNull();
    await page.goto(`${B}/login`);
    await page.getByLabel('Email').fill(dev2Email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.goto(`${B}/patients?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('a browser-sent x-tenant header is ignored', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-tenant': 'dev2' });
    await login(page, TEST_USERS.organizer.email);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('an unknown host gets 404 and a suspended company 503, also for API calls', async ({ page, request }) => {
    expect((await page.goto('http://nobody.localhost:3000/login'))!.status()).toBe(404);
    const paused = await page.goto('http://paused.localhost:3000/login');
    expect(paused!.status()).toBe(503);
    await expect(page.getByRole('heading', { name: 'This site is temporarily unavailable' })).toBeVisible();
    // The 503 page's CSP (default-src 'none') blocks fetch from the page, and Node can't resolve *.localhost: call the server directly with the suspended company's Host.
    const api = await request.post('http://127.0.0.1:3000/api/activity', { headers: { host: 'paused.localhost:3000' } });
    expect(api.status()).toBe(503);
  });

  test('a company suspended while users are signed in gets 503 on the very next request', async ({ page, context, request }) => {
    await page.goto(B + '/login');
    await page.getByLabel('Email').fill(dev2Email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.goto(B + '/patients');
    await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
    const cookie = (await context.cookies(B)).map((c) => c.name + '=' + c.value).join('; ');

    const original = readFileSync(file!, 'utf8');
    const suspended = (JSON.parse(original) as { slug: string }[]).map((t) => (t.slug === 'dev2' ? { ...t, status: 'suspended' } : t));
    writeFileSync(file!, JSON.stringify(suspended, null, 2));
    try {
      const headers = { host: 'tenant2.localhost:3000', cookie };
      const next = await page.goto(B + '/patients');
      expect(next!.status()).toBe(503);
      await expect(page.getByRole('heading', { name: 'This site is temporarily unavailable' })).toBeVisible();
      const action = await request.post('http://127.0.0.1:3000/patients', { headers: { ...headers, 'next-action': '00', 'content-type': 'text/plain;charset=UTF-8' }, data: '[]' });
      expect(action.status()).toBe(503);
      const activity = await request.post('http://127.0.0.1:3000/api/activity', { headers });
      expect(activity.status()).toBe(503);
    } finally {
      writeFileSync(file!, original);
    }
  });
});
