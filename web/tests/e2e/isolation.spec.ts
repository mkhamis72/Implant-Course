import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { adminClient, pendingLoginFor } from '../../scripts/users';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';
import { A, ACADEMY, B, companyB, purgeCompany, REFUSED, signIn, signInThroughApi, SKIP_REASON, tenantsFile, withPg } from './companies';
import { uniqueName } from './patients';
import { apiAs, placeImplant, seedDelegate, seedImplantStock } from './api';

// One database, two companies: academy on a.localhost, company B on b.localhost, from TENANTS_FILE (see
// companies.ts; add a paused.localhost entry with "status": "suspended" for the 503 test):
// TENANTS_FILE=<file> npx playwright test isolation --project=chromium
test.skip(!companyB, SKIP_REASON);

const USER_NOT_FOUND = 'User not found.';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

/** A login of the company with the test password, never signed in. */
async function newLogin(email: string, company: string, fullName: string, role: 'admin' | 'organizer' = 'organizer') {
  await pendingLoginFor(email, company);
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error) throw error;
  const id = data.user!.id;
  await withPg(async (pg) => {
    await pg.query('update public.profiles set full_name = $2 where user_id = $1', [id, fullName]);
    await pg.query('update public.company_members set role = $3 where company_id = $1 and user_id = $2', [company, id, role]);
  });
  return id;
}

/** Rewrites every server action the page posts to Users, so it names `to` wherever the form said `from`. */
async function postInstead(page: Page, from: string, to: string): Promise<{ count: number }> {
  const rewrites = { count: 0 };
  await page.route('**/admin/users**', async (route) => {
    const req = route.request();
    const body = req.postData();
    if (req.method() !== 'POST' || !req.headers()['next-action'] || !body?.includes(from)) return route.continue();
    rewrites.count++;
    await route.continue({ postData: body.split(from).join(to) });
  });
  return rewrites;
}

test.describe('company isolation in one database', () => {
  const stamp = Date.now();
  const bAdminEmail = `icm-iso-b-admin-${stamp}@example.com`;
  const bOrganizerEmail = `icm-iso-b-organizer-${stamp}@example.com`;
  const targetEmail = `icm-iso-a-target-${stamp}@example.com`;
  const targetName = `E2E Iso A Target ${stamp}`;
  const bPatientName = uniqueName('Iso B Patient');
  const bBrand = uniqueName('Iso B Brand');
  const ids = { bAdmin: '', bOrganizer: '', target: '', bPatient: '', bLot: '' };

  test.beforeAll(async () => {
    await withPg(async (pg) => {
      await pg.query(`insert into public.companies (id, slug, name) values ($1, 'e2e-company-b', 'E2E Company B') on conflict (id) do nothing`, [companyB]);
      // A company's settings row (onboarding will create it): the signed-in pages need one.
      await pg.query('insert into public.settings (company_id) values ($1) on conflict do nothing', [companyB]);
    });
    ids.bAdmin = await newLogin(bAdminEmail, companyB!, 'E2E Iso B Admin', 'admin');
    ids.bOrganizer = await newLogin(bOrganizerEmail, companyB!, 'E2E Iso B Organizer');
    // Academy's throwaway target for the admin actions: 2FA set-up pending, so Reset 2FA is offered.
    ids.target = await newLogin(targetEmail, ACADEMY, targetName);
    await withPg((pg) => pg.query('update public.company_members set mfa_setup_required = true where company_id = $1 and user_id = $2', [ACADEMY, ids.target]));

    // Company B's data, written through the API by B's admin in a session bound to B.
    const api = await apiAs(bAdminEmail, companyB);
    const patient = await api.from('patients').insert({ full_name: bPatientName, file_no: `E2EB${stamp}` }).select('id').single();
    if (patient.error) throw patient.error;
    ids.bPatient = patient.data.id;
    const stock = await seedImplantStock(api, { brand: bBrand, qty: 2, lot: `E2E-ISO-B${stamp}`, expiry: null });
    ids.bLot = stock.lotId;
    const delegate = await seedDelegate(api, uniqueName('Iso B Delegate'));
    const supervisor = await api.from('supervisors').insert({ full_name: uniqueName('Iso B Supervisor') }).select('id').single();
    if (supervisor.error) throw supervisor.error;
    const placed = await placeImplant(api, {
      p_patient: ids.bPatient, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: supervisor.data.id,
    });
    expect(placed.error).toBeNull();
  });

  test.afterAll(async () => {
    await purgeCompany(companyB!);
    for (const id of [ids.bAdmin, ids.bOrganizer, ids.target]) if (id) await adminClient().auth.admin.deleteUser(id);
  });

  test("A's admin sees none of B's patients, users, stock, Statistics or exports", async ({ page, browser }) => {
    await signIn(page, TEST_USERS.admin.email);

    await page.goto(`${A}/patients?q=${encodeURIComponent(bPatientName)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
    await expect(page.getByText(bPatientName)).toHaveCount(0);
    await page.goto(`${A}/patients/${ids.bPatient}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await expect(page.getByText(bPatientName)).toHaveCount(0);

    await page.goto(`${A}/admin/users`);
    await expect(page.getByTestId(`user-row-${targetEmail}`)).toBeVisible();
    await expect(page.getByText(bAdminEmail)).toHaveCount(0);
    await expect(page.getByText(bOrganizerEmail)).toHaveCount(0);

    await page.goto(`${A}/inventory?all=1&q=${encodeURIComponent(bBrand)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
    await expect(page.getByText(bBrand)).toHaveCount(0);
    await page.goto(`${A}/inventory/lots/${ids.bLot}`);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
    await expect(page.getByText(bBrand)).toHaveCount(0);

    await page.goto(`${A}/statistics?course=all`);
    await expect(page.getByRole('heading', { level: 1, name: 'Statistics & data analysis' })).toBeVisible();
    await expect(page.locator('select[name="brand"] option', { hasText: bBrand })).toHaveCount(0);
    await page.goto(`${A}/statistics/drilldown?list=implants&course=all&brand=${encodeURIComponent(bBrand)}`);
    await expect(page.getByText(bPatientName)).toHaveCount(0);

    // The export filtered to B's brand holds no row on A; the same export on B holds B's implant.
    const exportQuery = `/statistics/export?format=csv&course=all&brand=${encodeURIComponent(bBrand)}`;
    const exportCounts = async (p: Page, company: string) => {
      expect(await p.evaluate((url) => fetch(url).then((r) => r.status), exportQuery)).toBe(200);
      return withPg(async (pg) => (await pg.query(
        `select row_counts from public.research_exports where company_id = $1 and filters ->> 'brand' = $2 order by exported_at desc limit 1`,
        [company, bBrand])).rows[0]?.row_counts as Record<string, number>);
    };
    const inA = await exportCounts(page, ACADEMY);
    expect(Object.values(inA).every((n) => n === 0), JSON.stringify(inA)).toBe(true);

    const bContext = await browser.newContext();
    try {
      const bPage = await bContext.newPage();
      await signInThroughApi(bContext, bAdminEmail, companyB!);
      await bPage.goto(`${B}/`);
      await expect(bPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      expect((await exportCounts(bPage, companyB!)).implants).toBe(1);
    } finally {
      await bContext.close();
    }
  });

  test(`A's admin posting B's user id to every admin action gets "${USER_NOT_FOUND}"`, async ({ page }) => {
    await signIn(page, TEST_USERS.admin.email);
    const rewrites = await postInstead(page, ids.target, ids.bOrganizer);
    const row = page.getByTestId(`user-row-${targetEmail}`);
    const refused = async (action: string, submit: () => Promise<void>) => {
      await page.goto(`${A}/admin/users`);
      const before = rewrites.count;
      await submit();
      await expect(row.getByRole('alert').filter({ hasText: USER_NOT_FOUND }), action).toBeVisible();
      expect(rewrites.count, `${action} posted the target's id`).toBe(before + 1);
    };

    await refused('editName', async () => {
      await row.getByRole('button', { name: `Edit name of ${targetName}` }).click();
      await row.getByLabel('Name').fill('E2E Iso Renamed');
      await row.getByRole('button', { name: 'Save name' }).click();
    });
    await refused('changeEmail', async () => {
      await row.getByRole('button', { name: `Change email of ${targetEmail}` }).click();
      await row.getByLabel('New email').fill(`icm-iso-renamed-${stamp}@example.com`);
      await row.getByRole('button', { name: 'Change email', exact: true }).click();
    });
    await refused('setUserRole', async () => {
      await row.getByRole('combobox', { name: 'Role' }).selectOption('admin');
      await row.getByRole('button', { name: 'Change role' }).click();
    });
    await refused('setUserActive', () => row.getByRole('button', { name: 'Deactivate' }).click());
    await refused('resetPassword', () => row.getByRole('button', { name: `Reset password for ${targetEmail}` }).click());
    await refused('resetTwoFactor', async () => {
      await row.getByRole('button', { name: `Reset 2FA for ${targetEmail}` }).click();
      await row.getByRole('button', { name: 'Reset 2FA', exact: true }).click();
    });
    await refused('resendInvite', () => row.getByRole('button', { name: `Resend invite to ${targetEmail}` }).click());
    await refused('savePermissions', async () => {
      await row.getByText('Permissions', { exact: true }).click();
      await row.getByRole('button', { name: 'Save permissions' }).click();
    });
    await refused('removeUser', async () => {
      await row.getByRole('button', { name: `Delete user ${targetEmail}` }).click();
      await row.getByLabel(`Type ${targetName} to confirm`).fill(targetName);
      await row.getByRole('button', { name: 'Delete user', exact: true }).click();
    });

    // B's organizer and A's target are both as they were.
    const state = (user: string) => withPg(async (pg) => (await pg.query(
      `select m.company_id, m.role, m.active, m.mfa_setup_required, p.full_name, u.email, u.banned_until
       from public.company_members m join public.profiles p on p.user_id = m.user_id join auth.users u on u.id = m.user_id
       where m.user_id = $1`, [user])).rows);
    expect(await state(ids.bOrganizer)).toEqual([{
      company_id: companyB, role: 'organizer', active: true, mfa_setup_required: false, full_name: 'E2E Iso B Organizer',
      email: bOrganizerEmail, banned_until: null,
    }]);
    expect(await state(ids.target)).toEqual([{
      company_id: ACADEMY, role: 'organizer', active: true, mfa_setup_required: true, full_name: targetName,
      email: targetEmail, banned_until: null,
    }]);
  });

  test("A's cookies are refused on B's host and B's on A's, and A's user can't sign in on B", async ({ page, context, browser }) => {
    await signIn(page, TEST_USERS.admin.email);
    await context.addCookies((await context.cookies(A)).map(({ name, value }) => ({ name, value, url: B })));
    await page.goto(`${B}/`);
    await expect(page).toHaveURL(/\/login\?error=company$/);
    await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();

    const bContext = await browser.newContext();
    try {
      const bPage = await bContext.newPage();
      await signInThroughApi(bContext, bAdminEmail, companyB!);
      await bPage.goto(`${B}/`);
      await expect(bPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await bContext.addCookies((await bContext.cookies(B)).map(({ name, value }) => ({ name, value, url: A })));
      await bPage.goto(`${A}/`);
      await expect(bPage).toHaveURL(/\/login\?error=company$/);
      await expect(bPage.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();
    } finally {
      await bContext.close();
    }

    await page.goto(`${B}/login`);
    await page.getByLabel('Email').fill(TEST_USERS.organizer.email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();
  });

  test('a browser-sent x-tenant header is ignored', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-tenant': 'zz-iso-b' });
    await signIn(page, TEST_USERS.organizer.email);
  });

  test("company B's branding never shows on company A", async ({ page }) => {
    const api = await apiAs(bAdminEmail, companyB);
    const { error } = await api.rpc('update_branding', { p_name: 'E2E Iso B Academy', p_brand_color: null, p_nav_color: null });
    expect(error).toBeNull();
    await page.goto(`${B}/login`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Iso B Academy');
    await page.goto(`${A}/login`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('E2E Iso B Academy');
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

  test('a company suspended while users are signed in gets 503 on the very next request; the other carries on', async ({ page, context, request }) => {
    await signInThroughApi(context, bAdminEmail, companyB!);
    await page.goto(`${B}/patients`);
    await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
    const cookie = (await context.cookies(B)).map((c) => `${c.name}=${c.value}`).join('; ');

    const original = readFileSync(tenantsFile!, 'utf8');
    const suspended = (JSON.parse(original) as { hosts: string[] }[]).map((t) => (t.hosts.includes('b.localhost') ? { ...t, status: 'suspended' } : t));
    writeFileSync(tenantsFile!, JSON.stringify(suspended, null, 2));
    try {
      const headers = { host: 'b.localhost:3000', cookie };
      const next = await page.goto(`${B}/patients`);
      expect(next!.status()).toBe(503);
      await expect(page.getByRole('heading', { name: 'This site is temporarily unavailable' })).toBeVisible();
      const action = await request.post('http://127.0.0.1:3000/patients', { headers: { ...headers, 'next-action': '00', 'content-type': 'text/plain;charset=UTF-8' }, data: '[]' });
      expect(action.status()).toBe(503);
      const activity = await request.post('http://127.0.0.1:3000/api/activity', { headers });
      expect(activity.status()).toBe(503);
      // Academy, on the same database, carries on.
      expect((await page.goto(`${A}/login`))!.status()).toBe(200);
    } finally {
      writeFileSync(tenantsFile!, original);
    }
  });
});
