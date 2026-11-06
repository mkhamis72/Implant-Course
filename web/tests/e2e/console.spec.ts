import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';

// Runs only in local console mode: npm run console:local; set -a; source .env.console; set +a; npx playwright test console
test.skip(!process.env.CONSOLE_HOST, 'needs CONSOLE_HOST (npm run console:local)');

const C = 'http://console.localhost:3000';
const control = () => createClient(process.env.CONTROL_SUPABASE_URL!, process.env.CONTROL_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = `Console-${Date.now()}-pw`;
const email = `icm-console-${Date.now()}@example.com`;
let userId = '';
let secret = '';
let lastCode = '';

// A TOTP code works once per 30 s window: wait for the next one if the last code is still current.
async function freshCode(): Promise<string> {
  let code = authenticator.generate(secret);
  while (code === lastCode) {
    await new Promise((r) => setTimeout(r, 1000));
    code = authenticator.generate(secret);
  }
  lastCode = code;
  return code;
}

async function signIn(page: Page, who = email, password = PASSWORD) {
  await page.goto(`${C}/console/login`);
  await page.getByLabel('Email').fill(who);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const { data, error } = await control().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  userId = data.user!.id;
  const { error: e2 } = await control().from('console_admins').insert({ user_id: userId, email });
  if (e2) throw e2;
});

test.afterAll(async () => {
  if (userId) await control().auth.admin.deleteUser(userId);
  await control().rpc('console_set_status', { p_slug: 'dev2', p_status: 'active', p_reason: 'E2E cleanup', p_actor: 'e2e' });
});

test('the console host serves only the console, company hosts never serve it', async ({ page }) => {
  expect((await page.goto(`${C}/patients`))!.status()).toBe(404);
  expect((await page.goto('http://localhost:3000/console'))!.status()).toBe(404);
  expect((await page.goto('http://tenant2.localhost:3000/console/login'))!.status()).toBe(404);
});

test('a console admin signs in with password and sets up 2FA, then sees healthy companies', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await expect(page).toHaveURL(/\/console\/mfa\/setup$/);
  // The dev server may still be hydrating the page, which swallows an early click: click again until the key shows.
  await expect(async () => {
    await page.getByRole('button', { name: 'Set up authenticator' }).click({ timeout: 2_000 });
    await expect(page.getByTestId('totp-secret')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Code from app').fill(await freshCode());
  await page.getByRole('button', { name: 'Activate' }).click();
  // Activating the factor raises the session to aal2, so the guard goes straight to the companies page.
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  for (const slug of ['dev', 'dev2']) {
    const row = page.getByTestId(`company-${slug}`);
    await expect(row).toContainText('OK');
    await expect(row.locator('td[data-label="Users"]')).toHaveText(/^\d+$/);
    await expect(row.locator('td[data-label="Patients"]')).toHaveText(/^\d+$/);
  }
});

test('a signed-in control user who is not a console admin is refused', async ({ page }) => {
  const other = `icm-console-no-${Date.now()}@example.com`;
  const { data } = await control().auth.admin.createUser({ email: other, password: PASSWORD, email_confirm: true });
  try {
    await signIn(page, other);
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
  } finally {
    await control().auth.admin.deleteUser(data.user!.id);
  }
});

async function signInWith2fa(page: Page, password = PASSWORD) {
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/console\/login\/mfa$/);
  await page.getByLabel('Authentication code').fill(await freshCode());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
}

test('suspending a company takes its site offline; reactivating brings it back', async ({ page }) => {
  test.setTimeout(240_000);
  await signInWith2fa(page);
  await page.goto(`${C}/console/companies/dev2`);
  await page.getByLabel('Reason').fill('E2E suspension');
  await page.getByLabel('Type the slug to confirm').fill('dev2');
  await page.getByRole('button', { name: 'Suspend company' }).click();
  await expect(page.getByRole('status')).toContainText('Suspended');
  await expect.poll(async () => (await page.request.get('http://127.0.0.1:3000/login', { headers: { host: 'tenant2.localhost:3000' } })).status(), { timeout: 90_000 }).toBe(503);
  await page.getByLabel('Reason').fill('E2E done');
  await page.getByLabel('Type the slug to confirm').fill('dev2');
  await page.getByRole('button', { name: 'Reactivate company' }).click();
  await expect.poll(async () => (await page.request.get('http://127.0.0.1:3000/login', { headers: { host: 'tenant2.localhost:3000' } })).status(), { timeout: 90_000 }).toBe(200);
  await expect(page.getByRole('table')).toContainText('E2E suspension');
});

test('a first admin created in the console can sign in on the company', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInWith2fa(page);
  await page.goto(`${C}/console/companies/dev2`);
  const adminEmail = `icm-first-admin-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Full name').fill('E2E First Admin');
  await page.getByRole('button', { name: 'Create admin login' }).click();
  const password = (await page.getByTestId('temporary-password').locator('code').textContent())!.trim();
  // Company two is in the main stack; dev2 is only the control project.
  const company = parse(readFileSync('.env.local'));
  const db = createClient(company.NEXT_PUBLIC_SUPABASE_URL, company.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto('http://tenant2.localhost:3000/login');
    await p2.getByLabel('Email').fill(adminEmail);
    await p2.getByLabel('Password').fill(password);
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await p2.waitForURL((u) => !u.pathname.startsWith('/login'));
    await ctx.close();
  } finally {
    const { data } = await db.from('profiles').select('user_id').eq('email', adminEmail).maybeSingle();
    if (data) await db.auth.admin.deleteUser(data.user_id);
  }
});

test('adding a company checks its keys first', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!existsSync('.env.dev2') || !existsSync('.env.local'), 'needs the dev2 (control) and main stacks');
  const dev2 = parse(readFileSync('.env.dev2'));
  const company = parse(readFileSync('.env.local'));
  const slug = `zz-e2e-${Date.now().toString(36)}`;
  try {
    await signInWith2fa(page);
    await page.getByRole('link', { name: 'Add company' }).click();
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Name', { exact: true }).fill('E2E Added Co');
    await page.getByLabel('Addresses (one per line)').fill(`${slug}.localhost`);
    // The local gateway answers /auth/v1/settings without checking the anon key, so the bad key here is the service key.
    const keys = async (service: string) => {
      await page.getByLabel('Supabase URL').fill(company.NEXT_PUBLIC_SUPABASE_URL);
      await page.getByLabel('Anon key').fill(company.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      await page.getByLabel('Service role key').fill(service);
      await page.getByLabel('Database URL (session pooler)').fill(company.DATABASE_URL);
    };
    await keys('not-a-real-key-not-a-real-key');
    await page.getByRole('button', { name: 'Check and add' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "didn't pass the check" })).toBeVisible();
    await keys(company.SUPABASE_SERVICE_ROLE_KEY);
    await page.getByRole('button', { name: 'Check and add' }).click();
    await expect(page).toHaveURL(new RegExp(`/console/companies/${slug}$`));
    await page.goto(`${C}/console`);
    await expect(page.getByTestId(`company-${slug}`)).toContainText('OK');
  } finally {
    const pg = await import('pg');
    const c = new pg.Client({ connectionString: dev2.DATABASE_URL });
    await c.connect();
    await c.query('delete from public.tenants where slug = $1', [slug]);
    await c.query("delete from vault.secrets where name like 'tenant/' || $1 || '/%'", [slug]);
    await c.end();
  }
});

test('a console admin changes their password and signs in with the new one', async ({ page }) => {
  test.setTimeout(180_000);
  await signInWith2fa(page);
  await page.getByRole('link', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  const newPassword = `${PASSWORD}-new`;
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toHaveText('Password changed.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/console\/login$/);
  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
  await signInWith2fa(page, newPassword);
});
