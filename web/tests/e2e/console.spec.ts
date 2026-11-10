import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from 'otplib';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { closeNodeAuth, nodeAuth, nodeConsoleAuth } from '../../scripts/self-auth-node';
import { TEST_USERS } from '../support/test-users';
import { ACADEMY, signInThroughApi } from './companies';

// Runs only in local console mode: npm run console:local (writes .env.console), then run the tests with .env.console
// loaded next to .env.local: npx playwright test console
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

/** The first link to `path` (/auth/invite, /console/auth/reset) in the newest email to `to` (local Mailpit). */
async function emailedLink(to: string, path: string): Promise<string> {
  let link = '';
  await expect.poll(async () => {
    const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const id = (await res.json()).messages?.[0]?.ID;
    if (!id) return '';
    const msg = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
    link = (msg.HTML as string).match(new RegExp(`href="([^"]*${path}[^"]*)"`))?.[1]?.replace(/&amp;/g, '&') ?? '';
    return link;
  }, { timeout: 30_000 }).not.toBe('');
  return link;
}

/** Removes a company's Self-Auth account (and with it the profile and membership) by address; quiet when there is none. */
async function removeCompanyAccount(companyId: string, address: string) {
  const auth = await nodeAuth();
  const found = (await auth.admin.listUsers(companyId)).find((u) => u.email.toLowerCase() === address);
  if (found) await auth.admin.deleteUser(companyId, found.userId);
}

async function companyIdOf(slug: string): Promise<string | undefined> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    return (await pg.query('select id from public.companies where slug = $1', [slug])).rows[0]?.id;
  } finally {
    await pg.end();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // A console admin is a Self-Auth account of company 'console' in the control database, plus its console_admins row.
  const created = await (await nodeConsoleAuth()).admin.createUser({ companyId: 'console', email, password: PASSWORD });
  userId = created.userId;
  const { error } = await control().from('console_admins').insert({ user_id: userId, email });
  if (error) throw error;
});

test.afterAll(async () => {
  if (userId) {
    await control().from('console_admins').delete().eq('user_id', userId);
    await (await nodeConsoleAuth()).admin.deleteUser('console', userId);
  }
  await control().rpc('console_set_status', { p_slug: 'dev2', p_status: 'active', p_reason: 'E2E cleanup', p_actor: 'e2e' });
  await closeNodeAuth();
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

test('a console account that is not a console admin is refused', async ({ page }) => {
  const other = `icm-console-no-${Date.now()}@example.com`;
  const auth = await nodeConsoleAuth();
  const { userId: otherId } = await auth.admin.createUser({ companyId: 'console', email: other, password: PASSWORD });
  try {
    await signIn(page, other);
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
    expect((await page.context().cookies(C)).find((c) => c.name === 'icm_console_session')).toBeUndefined();
  } finally {
    await auth.admin.deleteUser('console', otherId);
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

test('a first admin invited from the console gets an email linking to the company’s own address', async ({ page }) => {
  test.setTimeout(120_000);
  await signInWith2fa(page);
  await page.goto(`${C}/console/companies/dev2`);
  const adminEmail = `icm-first-admin-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Full name').fill('E2E First Admin');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Invite sent to ${adminEmail}.` })).toBeVisible();
  // Company two is in the main stack (company console-e2e); dev2 is only the control project.
  const companyId = await companyIdOf('console-e2e');
  try {
    // The link is Self-Auth's, on the company's own host (the registry has no port for local hosts).
    expect(await emailedLink(adminEmail, '/auth/invite')).toMatch(/^http:\/\/tenant2\.localhost(:3000)?\/auth\/invite\?token=[^&]+$/);
    await expect(page.getByRole('table')).toContainText('first_admin_invited');
  } finally {
    if (companyId) await removeCompanyAccount(companyId, adminEmail);
  }
});

test('adding a company takes one form: name, address and first admin; the shared keys are copied', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!existsSync('.env.dev2') || !existsSync('.env.local'), 'needs the dev2 (control) and main stacks');
  const dev2 = parse(readFileSync('.env.dev2'));
  const company = parse(readFileSync('.env.local'));
  const slug = `zz-e2e-${Date.now().toString(36)}`;
  const adminEmail = `icm-onboard-${Date.now()}@example.com`;
  try {
    await signInWith2fa(page);
    await page.getByRole('link', { name: 'Add company' }).click();
    await expect(page.getByLabel(/key/i)).toHaveCount(0);
    // The dev server may still be hydrating the form, which drops an early fill: type again until the slug follows.
    await expect(async () => {
      await page.getByLabel('Company name').fill('');
      await page.getByLabel('Company name').fill('E2E Added Co');
      await expect(page.getByLabel('Slug')).toHaveValue('e2e-added-co', { timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
    await page.getByLabel('Slug').fill(slug);
    await expect(page.getByLabel('Address (one per line)')).toHaveValue(`${slug}.localhost`);
    await page.getByLabel('Full name').fill('E2E Onboard Admin');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByRole('button', { name: 'Add company' }).click();
    await expect(page.getByRole('heading', { name: 'Company added.' })).toBeVisible();
    await expect(page.getByText(`Invite sent to ${adminEmail}.`)).toBeVisible();
    await expect(page.getByText(/Vercel is not connected/)).toBeVisible();
    expect(await emailedLink(adminEmail, '/auth/invite')).toMatch(new RegExp(`^http://${slug}\\.localhost(:3000)?/auth/invite\\?token=`));
    await page.getByRole('link', { name: 'Open the company' }).click();
    await expect(page).toHaveURL(new RegExp(`/console/companies/${slug}$`));
    await expect(page.getByRole('heading', { name: 'Address' })).toBeVisible();
    await expect(page.getByText(/Add Existing/)).toBeVisible();
    // Adding it again is refused: the company exists.
    await page.goto(`${C}/console/companies/new`);
    await page.getByLabel('Company name').fill('E2E Added Co');
    await page.getByLabel('Slug').fill(slug);
    await page.getByLabel('Full name').fill('E2E Onboard Admin');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByRole('button', { name: 'Add company' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    await page.goto(`${C}/console`);
    await expect(page.getByTestId(`company-${slug}`)).toContainText('OK');
  } finally {
    const pg = await import('pg');
    const c = new pg.Client({ connectionString: dev2.DATABASE_URL });
    await c.connect();
    await c.query('delete from public.tenants where slug = $1', [slug]);
    await c.query("delete from vault.secrets where name like 'tenant/' || $1 || '/%'", [slug]);
    await c.end();
    // The check also provisioned the company in the main stack (provision_company): remove it and its rows, so
    // the DB tests that count rows per company don't see it. audit_log is append-only, so triggers are off.
    const main = new pg.Client({ connectionString: company.DATABASE_URL });
    await main.connect();
    try {
      await main.query('begin');
      await main.query('set local session_replication_role = replica');
      const id = (await main.query('select id from public.companies where slug = $1', [slug])).rows[0]?.id;
      if (id) {
        // The invited first admin is the company's only admin, which Self-Auth's delete refuses (last active admin):
        // with triggers off, remove the account rows by hand (the foreign-key cascades are off too), then the profile.
        const ids = (await main.query<{ id: string }>('select id from self_auth."user" where "companyId" = $1', [id])).rows.map((r) => r.id);
        for (const t of ['self_auth.account', 'self_auth.session']) await main.query(`delete from ${t} where "userId" = any($1::uuid[])`, [ids]);
        await main.query('delete from self_auth.totp_factor where user_id = any($1::uuid[])', [ids]);
        await main.query('delete from self_auth."user" where id = any($1::uuid[])', [ids]);
        await main.query('delete from public.profiles where user_id = any($1::uuid[])', [ids]);
        // Every company table (provision_company writes settings, branding, products, consent_form_versions,
        // file_no_counters and their audit rows; members, logins or sessions only if the run got that far).
        const tables = (await main.query<{ t: string }>('select x::text as t from app.company_tables() x')).rows.map((r) => r.t);
        for (const t of [...tables, 'app.session_companies']) await main.query(`delete from ${t} where company_id = $1`, [id]);
        await main.query('delete from public.companies where id = $1', [id]);
      }
      await main.query('commit');
    } catch (error) {
      // Leftovers make the per-company DB tests fail later: say so here instead of hiding it.
      console.warn(`console.spec teardown: company ${slug} was not removed from the main stack: ${(error as Error).message}`);
      await main.query('rollback').catch(() => {});
    } finally {
      await main.end();
    }
  }
});

test('console_session_not_valid_on_company_host: the two kinds of session never open each other\'s side', async ({ page, context }) => {
  test.setTimeout(180_000);
  await signInWith2fa(page);
  const consoleToken = (await context.cookies(C)).find((c) => c.name === 'icm_console_session')!.value;
  // The console cookie is host-only: the company host never receives it.
  expect((await context.cookies('http://localhost:3000')).find((c) => c.name === 'icm_console_session')).toBeUndefined();
  // Replayed as the company session cookie on a company host, it is signed out (and the cookie dropped).
  await context.addCookies([{ name: 'icm_session', value: consoleToken, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('http://localhost:3000/');
  await expect(page).toHaveURL('http://localhost:3000/login');
  expect((await context.cookies('http://localhost:3000')).find((c) => c.name === 'icm_session')).toBeUndefined();
  // And the other way round: a company session token as the console cookie opens nothing on the console host.
  const other = await context.browser()!.newContext();
  try {
    await signInThroughApi(other, TEST_USERS.organizer.email, ACADEMY, 'http://localhost:3000');
    const companyToken = (await other.cookies('http://localhost:3000')).find((c) => c.name === 'icm_session')!.value;
    const intruder = await context.browser()!.newContext();
    try {
      await intruder.addCookies([{ name: 'icm_console_session', value: companyToken, url: C, httpOnly: true, sameSite: 'Lax' }]);
      // (A browser page: Node's resolver does not know *.localhost.)
      const intruderPage = await intruder.newPage();
      await intruderPage.goto(`${C}/console`);
      await expect(intruderPage).toHaveURL(`${C}/console/login`);
      expect((await intruder.cookies(C)).find((c) => c.name === 'icm_console_session')).toBeUndefined();
    } finally {
      await intruder.close();
    }
  } finally {
    await other.close();
  }
});

test('a console admin changes their password through an emailed link and signs in with the new one', async ({ page }) => {
  test.setTimeout(180_000);
  await signInWith2fa(page);
  await page.getByRole('link', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  const newPassword = `${PASSWORD}-new`;
  await page.getByRole('button', { name: 'Email me a link to change my password' }).click();
  await expect(page.getByRole('status')).toContainText('We emailed a link');
  // The link opens the console's own page (the console host serves only /console…).
  const link = new URL(await emailedLink(email, '/console/auth/reset'));
  expect(link.pathname).toBe('/console/auth/reset');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/console\/login$/);
  await page.goto(`${C}${link.pathname}${link.search}`);
  await page.getByLabel('New password').fill(newPassword);
  await page.getByLabel('Confirm password').fill(newPassword);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/console\/login\?notice=password_reset$/);
  await expect(page.getByRole('status')).toContainText('Your password was changed');
  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
  await signInWith2fa(page, newPassword);
});
